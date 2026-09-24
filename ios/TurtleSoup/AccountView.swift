import SwiftUI

struct AccountScreen: View {
  @EnvironmentObject private var store: SoupStore
  @AppStorage("native.appearance") private var appearance = "system"
  @State private var showLogin = false
  @State private var archiveFilter = "active"
  @State private var confirmLogout = false
  @State private var error: String?

  var body: some View {
    PaperPage {
      VStack(alignment: .leading, spacing: 16) {
        PageHeading(eyebrow: "汤友档案", title: store.user?.displayName ?? "故事里，等你入座")
        if let user = store.user {
          Text(user.email).font(SoupFont.prose).foregroundStyle(SoupTheme.muted)
          Label(store.syncMessage ?? "进度保存在本机", systemImage: "icloud")
            .font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
          Button {
            Task { await store.sync() }
          } label: {
            HStack {
              if store.syncing { ProgressView() }
              Text(store.syncing ? "同步中…" : "同步案卷")
            }
          }.font(SoupFont.prose).disabled(store.syncing)
        } else {
          Text("和汤友聊推理，也把自己的故事熬成一碗汤。登录后，作品与案卷随账号保存。")
            .font(SoupFont.prose).foregroundStyle(SoupTheme.muted).lineSpacing(5)
          InkButton(title: "邮箱登录", icon: "arrow.right") { showLogin = true }
            .disabled(!store.pending.isEmpty).accessibilityIdentifier("emailLogin")
          if let note = store.syncMessage {
            Text(note).font(SoupFont.mono(11)).foregroundStyle(SoupTheme.red)
          }
        }
      }
      if let user = store.user {
        VStack(spacing: 0) {
          if let handle = user.handle, !handle.isEmpty {
            NavigationLink {
              AuthorProfileScreen(handle: handle)
            } label: {
              accountLink("我的主页", detail: "让汤友认识你", icon: "person.crop.square")
            }.buttonStyle(.plain)
          }
          NavigationLink {
            MySoupsScreen()
          } label: {
            accountLink("我熬的汤", detail: "作品与私藏", icon: "square.and.pencil")
          }.buttonStyle(.plain).accessibilityIdentifier("mySoups")
        }
      }
      HStack(spacing: 0) {
        statistic("在办", count: store.activeGames.count)
        Divider().frame(height: 36)
        statistic("已破案", count: store.games.filter(\.solved).count)
        Divider().frame(height: 36)
        statistic("提问", count: store.games.reduce(0) { $0 + $1.turnCount })
      }.padding(.vertical, 20).overlay(alignment: .top) { PaperRule() }.overlay(alignment: .bottom)
      { PaperRule() }
      VStack(alignment: .leading, spacing: 16) {
        SectionCaption(title: "我的案卷", detail: "\(store.games.count) 份")
        PaperFilters(options: [("active", "调查中"), ("finished", "已归档")], selection: $archiveFilter)
        let items = archiveFilter == "active" ? store.activeGames : store.finishedGames
        if items.isEmpty {
          VStack(spacing: 12) {
            Text(archiveFilter == "active" ? "案头还很安静" : "结案之后，在这里重读").font(
              SoupFont.serif(17))
            Text("去广场或每日，选一碗让你好奇的汤。")
              .font(SoupFont.mono(11)).multilineTextAlignment(.center)
          }.foregroundStyle(SoupTheme.muted).frame(maxWidth: .infinity).padding(.vertical, 24)
        }
        ForEach(items) { game in
          Button {
            store.open(game)
          } label: {
            CaseRow(game: game)
          }.buttonStyle(.plain)
        }
      }
      VStack(alignment: .leading, spacing: 18) {
        SectionCaption(title: "偏好与帮助")
        Picker("外观", selection: $appearance) {
          Text("跟随系统").tag("system")
          Text("纸白").tag("light")
          Text("夜读").tag("dark")
        }.pickerStyle(.menu)
        NavigationLink {
          GuideScreen()
        } label: {
          Label("调查员手册", systemImage: "book.closed")
        }
        if store.user != nil {
          Button("退出登录", role: .destructive) { confirmLogout = true }.disabled(
            !store.pending.isEmpty)
        }
        Text(
          "海龟汤 · iOS \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")\n一人熬汤，众人寻味。"
        )
        .font(SoupFont.mono(10)).lineSpacing(5).foregroundStyle(SoupTheme.muted)
        .padding(.top, 8)
      }.font(SoupFont.prose)
    }.navigationTitle("我的")
      .sheet(isPresented: $showLogin) {
        NavigationStack { LoginScreen() }.environmentObject(store).tint(SoupTheme.ink)
      }
      .confirmationDialog(
        "退出后，账号案卷仍会保留，再次登录即可恢复。", isPresented: $confirmLogout, titleVisibility: .visible
      ) {
        Button("退出登录", role: .destructive) {
          Task {
            do { try await store.signOut() } catch { self.error = error.localizedDescription }
          }
        }
      }
      .alert("暂时无法退出", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } }))
    {
      Button("好", role: .cancel) { error = nil }
    } message: {
      Text(error ?? "")
    }
      .refreshable { await store.refreshAccount() }
  }
  private func accountLink(_ title: String, detail: String, icon: String) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon).font(.system(size: 18, weight: .light))
      Text(title).font(SoupFont.serif(16))
      Spacer()
      Text(detail).font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(SoupTheme.muted)
    }.frame(minHeight: 58).overlay(alignment: .bottom) { PaperRule() }
  }
  private func statistic(_ label: String, count: Int) -> some View {
    VStack(spacing: 8) {
      Text(String(format: "%02d", count)).font(SoupFont.mono(25)).monospacedDigit()
      Text(label).font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
    }.frame(maxWidth: .infinity)
  }
}

struct LoginScreen: View {
  var afterSignIn: (() -> Void)? = nil
  @EnvironmentObject private var store: SoupStore
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var code = ""
  @State private var sent = false
  @State private var busy = false
  @State private var error: String?
  @State private var includeGuest = true
  @State private var resendAt = Date.distantPast
  var body: some View {
    PaperPage {
      PageHeading(
        eyebrow: "账号", title: "加入汤友之间",
        subtitle: "用同一个邮箱，接着推理、熬汤和聊天。")
      VStack(alignment: .leading, spacing: 12) {
        Text("邮箱地址").font(SoupFont.mono(11)).tracking(2).foregroundStyle(SoupTheme.muted)
        TextField(
          "邮箱", text: $email,
          prompt: Text(verbatim: "you@example.com").foregroundStyle(SoupTheme.muted)
        ).textContentType(.emailAddress).accessibilityIdentifier("emailInput")
          .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
          .font(SoupFont.mono(14)).padding(.horizontal, 14).frame(minHeight: 50)
          .background(SoupTheme.sheet).overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 0.75))
          .disabled(busy || sent)
        if sent {
          HStack {
            Text("验证码已寄出，请查收邮箱。")
            Spacer()
            Button("更换") {
              sent = false
              code = ""
              error = nil
            }.disabled(busy)
          }.font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
        }
      }
      if sent {
        VStack(alignment: .leading, spacing: 18) {
          Text("邮件验证码").font(SoupFont.mono(11)).tracking(2).foregroundStyle(SoupTheme.muted)
          TextField("6 位邮件验证码", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
            .font(SoupFont.mono(20)).padding(14).background(SoupTheme.sheet)
            .overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 0.75))
          if !store.games.isEmpty && store.user == nil {
            Toggle("将本机游客案卷并入账号", isOn: $includeGuest).font(SoupFont.serif(14))
          }
          InkButton(title: busy ? "正在登录…" : "登录并同步案卷", expanded: true) { Task { await verify() } }
            .disabled(busy || code.filter(\.isNumber).count != 6)
          TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = max(0, Int(resendAt.timeIntervalSince(context.date).rounded(.up)))
            Button(seconds > 0 ? "\(seconds) 秒后可重新发送" : "重新发送验证码") { Task { await requestCode() } }
              .font(SoupFont.mono(11)).frame(minHeight: 44).disabled(busy || seconds > 0)
          }
        }
      } else {
        InkButton(title: busy ? "正在寄出…" : "发送验证码", expanded: true) { Task { await requestCode() } }
          .disabled(busy || !email.contains("@"))
      }
      if let error {
        Text(error).foregroundStyle(SoupTheme.red).font(SoupFont.prose).lineSpacing(6)
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .navigationTitle("登录海龟汤").navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(busy) }
    }
    .interactiveDismissDisabled(busy)
  }
  private func requestCode() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      let _: OKReply = try await SoupAPI.shared.send(
        "/api/auth/request",
        body: ["email": email.trimmingCharacters(in: .whitespacesAndNewlines), "locale": "zh-CN"])
      sent = true
      resendAt = Date().addingTimeInterval(60)
    } catch { self.error = error.localizedDescription }
  }
  private func verify() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await store.signIn(
        email: email.trimmingCharacters(in: .whitespacesAndNewlines), code: code.filter(\.isNumber),
        includeGuest: includeGuest)
      if let afterSignIn { afterSignIn() } else { dismiss() }
    } catch { self.error = error.localizedDescription }
  }
}
