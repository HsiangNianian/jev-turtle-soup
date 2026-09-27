import SwiftUI

struct TableEntryLink: View {
  var puzzleID: String? = nil
  var body: some View {
    NavigationLink {
      TableLobbyScreen(puzzleID: puzzleID)
    } label: {
      Label(puzzleID == nil ? "凭邀请入座" : "邀朋友同桌", systemImage: "person.2")
        .font(SoupFont.mono(11)).padding(.horizontal, 14).frame(minHeight: 44)
        .overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 1))
    }.buttonStyle(.plain)
  }
}
struct TableLobbyScreen: View {
  var puzzleID: String? = nil
  @EnvironmentObject private var store: SoupStore
  @State private var code = ""
  @State private var requestID = UUID().uuidString.lowercased()
  @State private var busy = false
  @State private var error: String?
  var body: some View {
    PaperPage {
      PageHeading(
        eyebrow: "同桌", title: puzzleID == nil ? "朋友留了一桌给你" : "为这碗汤，留几个座位",
        subtitle: "2—6 人围坐一桌。各自提问，一起讨论，由砚主持；想提前看答案，需要全体同意。")
      if store.user == nil {
        Text("登录后入座，提问和讨论都会留在你们共同的案卷里。").font(SoupFont.prose).foregroundStyle(SoupTheme.muted)
        NavigationLink {
          LoginScreen()
        } label: {
          Label("登录后入座", systemImage: "arrow.right")
        }
      } else {
        if puzzleID == nil {
          VStack(alignment: .leading, spacing: 12) {
            Text("邀请码或邀请链接").font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
            TextField("ABCD EFGH 2345", text: $code).textInputAutocapitalization(.characters)
              .autocorrectionDisabled()
              .font(SoupFont.body).padding(14).background(SoupTheme.sheet).overlay(
                Rectangle().stroke(SoupTheme.line))
            PasteButton(payloadType: String.self) {
              if let text = $0.first { code = String(text.prefix(512)) }
            }.labelStyle(.titleOnly).tint(SoupTheme.ink)
          }
        }
        InkButton(title: busy ? "正在入座…" : puzzleID == nil ? "入座" : "开一桌，邀请朋友", icon: "person.2") {
          Task { await enter() }
        }.disabled(busy)
      }
      if let error { Text(error).font(SoupFont.prose).foregroundStyle(SoupTheme.red) }
    }.navigationTitle("同桌")
  }
  private func enter() async {
    guard let owner = store.user?.uid else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      let room: TableSnapshot
      if let puzzleID {
        room = try await SoupAPI.shared.send(
          "/api/rooms", body: TableCreate(puzzleId: puzzleID, requestId: requestID))
      } else {
        guard let valid = tableInvitationCode(code) else {
          throw SoupAPIError(status: 400, message: "请输入有效的邀请码或海龟汤邀请链接")
        }
        room = try await SoupAPI.shared.send("/api/rooms/join", body: TableJoin(code: valid))
      }
      guard store.user?.uid == owner, room.meId == owner else { return }
      store.activeTable = TableRoute(id: room.roomId)
    } catch { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
}
struct MyTablesScreen: View {
  @EnvironmentObject private var store: SoupStore
  @State private var items: [TableSummary] = []
  @State private var error: String?
  var body: some View {
    PaperPage {
      PageHeading(eyebrow: "共同案卷", title: "我的同桌", subtitle: "那天的提问、讨论和结案，都留在这里。")
      TableEntryLink()
      if items.isEmpty {
        Text("还没有同桌案卷。去广场选一碗汤，邀请朋友一起玩吧。").font(SoupFont.prose).foregroundStyle(SoupTheme.muted)
      }
      ForEach(items) { item in
        VStack(alignment: .leading, spacing: 10) {
          Button {
            store.activeTable = TableRoute(id: item.roomId)
          } label: {
            VStack(alignment: .leading, spacing: 10) {
              Text("\(tablePhaseLabel(item.phase)) · \(item.turns) 轮").font(SoupFont.mono(10))
                .foregroundStyle(SoupTheme.muted)
              HStack {
                Text(item.title).font(SoupFont.serif(21))
                Spacer()
                Image(systemName: "arrow.right").font(.system(size: 14))
              }
            }.frame(maxWidth: .infinity, alignment: .leading)
          }.buttonStyle(.plain)
          Button("从我的列表隐藏") { Task { await hide(item.id) } }.font(SoupFont.mono(10))
            .foregroundStyle(SoupTheme.muted).frame(minHeight: 36)
          PaperRule(dashed: true)
        }
      }
      if let error { ErrorNote(message: error) { Task { await load() } } }
    }.navigationTitle("我的同桌").task(id: store.user?.uid) { await load() }.refreshable {
      await load()
    }
  }
  private func load() async {
    guard let owner = store.user?.uid else {
      items = []
      return
    }
    do {
      let reply: ItemsReply<TableSummary> = try await SoupAPI.shared.request("/api/me/rooms")
      guard store.user?.uid == owner else { return }
      items = reply.items
      error = nil
    } catch { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
  private func hide(_ id: String) async {
    do {
      let _: OKReply = try await SoupAPI.shared.send(
        "/api/me/rooms/\(id)/hide", body: [String: String]())
      items.removeAll { $0.id == id }
    } catch { self.error = error.localizedDescription }
  }
}

struct TableScreen: View {
  let owner: String
  @StateObject private var table: TableStore
  @EnvironmentObject private var store: SoupStore
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  @State private var tab = "ask"
  @State private var question = ""
  @State private var discussion = ""
  @State private var reference: TableQuestion?
  @State private var showMembers = false
  @State private var showSurface = false
  @State private var showFeedback = false
  @State private var feedback = ""
  @State private var feedbackSent = false
  @State private var confirmation: TableCommand?
  @State private var confirmationText = ""
  init(roomID: String, owner: String) {
    self.owner = owner
    _table = StateObject(wrappedValue: TableStore(owner: owner, roomID: roomID))
  }
  private var available: Bool { table.online && table.snapshot?.readOnly == false }
  private var draft: Binding<String> { tab == "ask" ? $question : $discussion }
  var body: some View {
    VStack(spacing: 0) {
      if let s = table.snapshot {
        VStack(alignment: .leading, spacing: 9) {
          HStack {
            Text("\(s.phaseLabel) · \(s.turns) 轮").font(SoupFont.mono(10)).foregroundStyle(
              SoupTheme.muted)
            Spacer()
            Button {
              showMembers = true
            } label: {
              Label("\(s.seats.count)/6", systemImage: "person.2").font(SoupFont.mono(11))
            }
          }
          Text(s.puzzle.title).font(SoupFont.serif(20, weight: .semibold)).lineLimit(2)
          DisclosureGroup("汤面", isExpanded: $showSurface) {
            ScrollView {
              Text(s.puzzle.surface).font(SoupFont.prose).lineSpacing(6).frame(
                maxWidth: .infinity, alignment: .leading)
            }.frame(maxHeight: 150)
          }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
        }.padding(.horizontal, 20).padding(.vertical, 12)
        PaperRule()
        if let vote = s.vote { voteView(vote) }
      }
      if !table.online {
        HStack(spacing: 8) {
          if table.status.contains("连接") { ProgressView().controlSize(.mini) }
          Text(table.status).font(SoupFont.mono(10))
          Spacer()
        }.foregroundStyle(SoupTheme.muted).padding(.horizontal, 20).padding(.vertical, 8)
      }
      HStack {
        PaperFilters(options: [("ask", "问砚"), ("discuss", "桌内讨论")], selection: $tab)
        Spacer()
        Button {
          showFeedback = true
        } label: {
          Image(systemName: "flag").font(.system(size: 14))
        }.accessibilityLabel("反馈").frame(width: 44, height: 44)
      }.padding(.horizontal, 20)
      PaperRule()
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            if let s = table.snapshot, s.phase == "waiting" { waitingView(s).padding(.bottom, 20) }
            if table.hasEarlier {
              Button("查看更早的记录 ↑") { Task { await table.earlier() } }.font(SoupFont.mono(11)).frame(
                maxWidth: .infinity, minHeight: 44)
            }
            ForEach(
              table.events.filter {
                $0.type == "system"
                  || (tab == "ask" ? $0.type != "discussion" : $0.type == "discussion")
              }
            ) { event in eventView(event).id(event.id) }
            if tab == "discuss", !table.events.contains(where: { $0.type == "discussion" }) {
              VStack(spacing: 10) {
                Text("把你的猜想说给同桌听。").font(SoupFont.prose)
                Text("讨论不计轮数，也不会作为正式提问交给砚。").font(SoupFont.mono(10)).multilineTextAlignment(.center)
              }.foregroundStyle(SoupTheme.muted).frame(maxWidth: .infinity).padding(.vertical, 36)
            }
            if let s = table.snapshot, let report = s.report { reportView(report, snapshot: s) }
            Color.clear.frame(height: 1).id("table-bottom")
          }.padding(20)
        }.scrollDismissesKeyboard(.interactively)
          .onChange(of: table.events.last?.id) { _, _ in
            if !table.hasEarlier {
              withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo("table-bottom", anchor: .bottom)
              }
            }
          }
      }
      if let error = table.error {
        HStack {
          Text(error).font(SoupFont.mono(11)).frame(maxWidth: .infinity, alignment: .leading)
          Button {
            table.error = nil
          } label: {
            Image(systemName: "xmark").font(.system(size: 11))
          }.frame(width: 32, height: 32)
        }.foregroundStyle(SoupTheme.red).padding(.horizontal, 20).padding(.vertical, 4)
      }
      if feedbackSent {
        Text("反馈已收到，谢谢。").font(SoupFont.mono(10)).foregroundStyle(SoupTheme.green).padding(6)
      }
      if let s = table.snapshot, !s.readOnly {
        composer(s)
      } else if let s = table.snapshot, s.members.first(where: { $0.uid == owner })?.seat == "left",
        let code = s.inviteCode
      {
        InkButton(title: "再次入座") {
          Task {
            do {
              let _: TableSnapshot = try await SoupAPI.shared.send(
                "/api/rooms/join", body: TableJoin(code: code))
              table.resume()
            } catch {
              if !isRequestCancellation(error) { table.error = error.localizedDescription }
            }
          }
        }.padding(16)
      }
    }.background { PaperBackground() }.foregroundStyle(SoupTheme.ink).tint(SoupTheme.ink)
      .navigationTitle("同桌").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button {
            dismiss()
          } label: {
            Image(systemName: "chevron.down")
          }.accessibilityLabel("回到案卷")
        }
      }
      .task { table.start() }
      .onChange(of: table.snapshot?.phase) { old, phase in
        if old == nil && phase == "waiting" {
          showSurface = true
          tab = "discuss"
        }
      }
      .onChange(of: table.requiresLogin) { _, required in
        if required { Task { await store.refreshAccount() } }
      }
      .onDisappear { table.stop() }
      .onChange(of: scenePhase) { _, phase in if phase == .active { table.resume() } }
      .onChange(of: store.user?.uid) { _, uid in
        if uid != owner {
          table.stop()
          dismiss()
        }
      }
      .onChange(of: table.rejected?.commandId) { _, _ in
        if let cmd = table.rejected, let text = cmd.text {
          if cmd.type == "ask", question.isEmpty { question = text }
          if cmd.type == "discuss", discussion.isEmpty { discussion = text }
        }
      }
      .sheet(isPresented: $showMembers) {
        NavigationStack { membersView }.presentationDetents([.medium, .large])
      }
      .alert(
        "同桌操作",
        isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } })
      ) {
        Button("确认", role: .destructive) {
          if let command = confirmation { table.send(command) }
          confirmation = nil
        }
        Button("取消", role: .cancel) { confirmation = nil }
      } message: {
        Text(confirmationText)
      }
      .sheet(isPresented: $showFeedback) {
        NavigationStack {
          PaperPage {
            Text("这桌遇到了什么问题？").font(SoupFont.title)
            TextEditor(text: $feedback).font(SoupFont.prose).frame(minHeight: 160)
              .scrollContentBackground(.hidden).padding(10).background(SoupTheme.sheet)
            InkButton(title: "提交反馈") {
              Task {
                do {
                  let _: TableFeedbackReply = try await SoupAPI.shared.send(
                    "/api/rooms/\(table.roomID)/report", body: TableFeedback(note: feedback))
                  feedbackSent = true
                  showFeedback = false
                  feedback = ""
                } catch {
                  if !isRequestCancellation(error) { table.error = error.localizedDescription }
                }
              }
            }.disabled(feedback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }.navigationTitle("反馈").toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("关闭") { showFeedback = false } }
          }
        }
      }
  }
  private func waitingView(_ s: TableSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("入座后就开汤").font(SoupFont.mono(10)).foregroundStyle(SoupTheme.red)
      Text("空着的座位，留给朋友").font(SoupFont.serif(23))
      HStack(spacing: 8) {
        ForEach(0..<6) { i in
          VStack(spacing: 10) {
            Text(i < s.seats.count ? String(s.seats[i].name.prefix(1)) : "＋").font(
              SoupFont.serif(16)
            ).frame(width: 30, height: 30).background(
              i < s.seats.count ? SoupTheme.ink : Color.clear
            ).foregroundStyle(i < s.seats.count ? SoupTheme.paper : SoupTheme.muted.opacity(0.4))
            Text(i < s.seats.count ? s.seats[i].name : "空位").font(SoupFont.mono(9)).lineLimit(1)
            PaperRule()
          }.frame(maxWidth: .infinity)
        }
      }
      Text("把邀请发给朋友。至少两人在线，房主就可以开始。").font(SoupFont.prose).foregroundStyle(SoupTheme.muted)
        .lineSpacing(6)
      if let invitation = s.invitation {
        ShareLink(item: invitation) {
          Label("邀请朋友", systemImage: "square.and.arrow.up").font(SoupFont.mono(11)).frame(
            minHeight: 40)
        }
      }
      if let code = s.inviteCode {
        Text(code).font(SoupFont.mono(12)).tracking(2).textSelection(.enabled)
      }
      if s.hostId == owner {
        InkButton(title: "开始同桌") { table.send(TableCommand(type: "start")) }.disabled(
          !available || s.seats.filter { $0.disconnectedAt == nil }.count < 2)
      }
    }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(SoupTheme.sheet)
      .overlay(Rectangle().stroke(SoupTheme.line))
  }
  @ViewBuilder private func eventView(_ e: TableEvent) -> some View {
    if e.type == "system" {
      Text(e.text).font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted).multilineTextAlignment(
        .center
      ).frame(maxWidth: .infinity).padding(.vertical, 12)
    } else {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Text(
            e.type == "answer"
              ? "砚" : table.snapshot?.members.first(where: { $0.uid == e.actorId })?.name ?? "汤友"
          ).foregroundStyle(e.type == "answer" ? SoupTheme.red : SoupTheme.muted)
          if e.type != "answer", e.actorId == owner { Text("· 你") }
          Spacer()
          Text(Date(timeIntervalSince1970: e.at / 1000), style: .time)
        }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
        if let id = e.referenceId {
          Text(
            "↳ \(table.events.first(where:{$0.type=="question" && $0.questionId==id})?.text ?? "接着前面的问题")"
          ).font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted).lineLimit(2)
        }
        Text(e.text).font(SoupFont.prose).lineSpacing(7).textSelection(.enabled).frame(
          maxWidth: .infinity, alignment: .leading)
        if e.type == "question", available, let id = e.questionId {
          Button("引用提问 ↳") {
            reference = TableQuestion(
              id: id, uid: e.actorId ?? "", text: e.text, locale: "zh-CN", at: e.at, reference: nil,
              error: nil)
            tab = "ask"
          }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted).frame(minHeight: 32)
        }
        PaperRule(dashed: true)
      }.padding(.vertical, 14).padding(.leading, e.type == "answer" ? 16 : 0)
    }
  }
  private func voteView(_ vote: TableVote) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("这碗汤，一起揭晓吗？").font(SoupFont.prose)
        Spacer()
        Text(Date(timeIntervalSince1970: vote.expiresAt / 1000), style: .timer).monospacedDigit()
          .font(SoupFont.mono(11))
      }
      HStack {
        Text("需全员同意 · \(vote.agreed.count)/\(vote.members.count)").font(SoupFont.mono(10))
          .foregroundStyle(SoupTheme.muted)
        Spacer()
        Button("继续推理") { table.send(TableCommand(type: "vote", voteId: vote.id, agree: false)) }
        Button(vote.agreed.contains(owner) ? "已同意" : "同意揭晓") {
          table.send(TableCommand(type: "vote", voteId: vote.id, agree: true))
        }.disabled(vote.agreed.contains(owner))
      }.font(SoupFont.mono(11)).disabled(!available)
    }.padding(16).background(SoupTheme.sheet).overlay(alignment: .bottom) { PaperRule() }
  }
  private func composer(_ s: TableSnapshot) -> some View {
    let mine = s.queue.first { $0.uid == owner }
    let failed = s.failed.first { $0.uid == owner }
    let disabled =
      !available
      || (tab == "ask"
        && (s.phase != "playing" || mine != nil || s.processing?.uid == owner || s.vote != nil
          || s.revealPending || s.seats.count < 2))
    return VStack(alignment: .leading, spacing: 8) {
      PaperRule()
      if let q = s.processing {
        Text("砚正在回答 · \(s.members.first(where:{$0.uid==q.uid})?.name ?? "汤友")").font(
          SoupFont.mono(10)
        ).foregroundStyle(SoupTheme.muted)
      }
      if let mine {
        HStack {
          Text("你的问题正在排队")
          Spacer()
          Button("撤回") { table.send(TableCommand(type: "cancel", questionId: mine.id)) }
        }.font(SoupFont.mono(10))
      }
      if let failed {
        HStack {
          Text(failed.error ?? "这次回答未能完成")
          Spacer()
          Button("重试问题") { table.send(TableCommand(type: "retry", questionId: failed.id)) }
        }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.red)
      }
      if let reference, tab == "ask" {
        HStack {
          Text("↳ \(reference.text)").lineLimit(1)
          Spacer()
          Button {
            self.reference = nil
          } label: {
            Image(systemName: "xmark")
          }
        }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      }
      HStack(alignment: .bottom, spacing: 10) {
        TextField(tab == "ask" ? "把你的问题交给砚……" : "和同桌说说你的猜想……", text: draft, axis: .vertical)
          .accessibilityIdentifier("tableQuestion").lineLimit(1...4).font(SoupFont.body).padding(
            .vertical, 6
          )
          .onChange(of: draft.wrappedValue) { _, value in
            if value.count > 600 { draft.wrappedValue = String(value.prefix(600)) }
          }
        Button {
          submit()
        } label: {
          Image(systemName: "arrow.up").frame(width: 38, height: 38).background(SoupTheme.ink)
            .foregroundStyle(SoupTheme.paper)
        }.disabled(
          disabled || draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ).opacity(disabled ? 0.3 : 1).accessibilityLabel("发送").accessibilityIdentifier("tableSend")
      }.padding(10).background(SoupTheme.sheet).overlay(
        Rectangle().stroke(SoupTheme.ink.opacity(0.4)))
      HStack {
        Text(table.pendingCount > 0 ? "等待服务器确认" : tab == "ask" ? "正式提问按顺序回答" : "讨论仅在这一桌可见")
        Spacer()
        if s.phase == "playing" {
          Button("提议揭晓") { table.send(TableCommand(type: "reveal")) }.disabled(
            !available || s.vote != nil || s.revealPending || s.dailyLocked)
        }
      }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
    }.padding(.horizontal, 16).padding(.bottom, 8)
  }
  private func submit() {
    let text = draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if table.send(
      TableCommand(
        type: tab == "ask" ? "ask" : "discuss", text: text, locale: tab == "ask" ? "zh-CN" : nil,
        referenceId: tab == "ask" ? reference?.id : nil))
    {
      draft.wrappedValue = ""
      reference = nil
    }
  }
  private var membersView: some View {
    PaperPage {
      if let s = table.snapshot {
        SectionCaption(title: "在座成员", detail: "\(s.seats.count)/6")
        ForEach(s.seats) { m in
          HStack {
            Circle().fill(m.disconnectedAt == nil ? SoupTheme.green : SoupTheme.muted.opacity(0.4))
              .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 6) {
              Text(m.name).font(SoupFont.prose)
              Text(
                "\(m.uid==s.hostId ? "房主":m.disconnectedAt==nil ? "在座":"暂时离线") · \(m.questions) 轮"
              ).font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
            }
            Spacer()
            if s.hostId == owner, m.uid != owner, available {
              Menu("管理") {
                Button("转交房主") {
                  confirmationText = "把房主交给 \(m.name)？"
                  confirmation = TableCommand(type: "transfer", uid: m.uid)
                  showMembers = false
                }
                Button("移出同桌", role: .destructive) {
                  confirmationText = "移出后，这位汤友不能重新进入这一桌。"
                  confirmation = TableCommand(type: "kick", uid: m.uid)
                  showMembers = false
                }
              }.font(SoupFont.mono(11))
            }
          }.padding(.vertical, 8)
        }
        if let invitation = s.invitation {
          ShareLink(item: invitation) { Label("邀请朋友", systemImage: "square.and.arrow.up") }
        }
        if let code = s.inviteCode { Text(code).font(SoupFont.mono(12)).textSelection(.enabled) }
        if available, s.hostId == owner {
          Button(s.invitationsOpen ? "停止新成员入座" : "开放新成员入座") {
            table.send(TableCommand(type: "invitations", open: !s.invitationsOpen))
          }
        }
        if available {
          Button("离座", role: .destructive) {
            confirmationText = "离座后保留共同案卷；有空位时可以再次入座。"
            confirmation = TableCommand(type: "leave")
            showMembers = false
          }
        }
      }
    }.navigationTitle("同桌成员").toolbar {
      ToolbarItem(placement: .confirmationAction) { Button("完成") { showMembers = false } }
    }
  }
  private func reportView(_ report: TableReport, snapshot: TableSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      PaperRule(strong: true)
      SectionCaption(title: "共同结案报告", detail: "\(report.turns) 轮")
      Text(tablePhaseLabel(report.outcome)).font(SoupFont.title)
      Text(snapshot.members.filter { $0.seat != "removed" }.map(\.name).joined(separator: "、"))
        .font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
      if let truth = report.truth {
        Text("汤底").font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
        Text(truth).font(SoupFont.prose).lineSpacing(8).textSelection(.enabled)
      }
      if let story = report.story {
        Text("完整背景故事").font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
        Text(story).font(SoupFont.prose).lineSpacing(8).textSelection(.enabled)
      }
      Text(report.authorParticipated ? "作者参与过这一桌，不计入同桌轮数纪录。" : "同桌轮数单独记录，不影响单人纪录。").font(
        SoupFont.mono(10)
      ).foregroundStyle(SoupTheme.muted)
    }.padding(.vertical, 24)
  }
}
