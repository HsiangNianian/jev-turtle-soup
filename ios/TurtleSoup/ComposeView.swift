import SwiftUI

struct WriteSoupSheet: View {
  @EnvironmentObject private var store: SoupStore
  var body: some View {
    if let user = store.user {
      ComposeSoupScreen(user: user).id(user.uid)
    } else {
      LoginScreen(afterSignIn: {})
    }
  }
}

struct ComposeSoupScreen: View {
  let user: SoupUser
  @EnvironmentObject private var store: SoupStore
  @EnvironmentObject private var community: CommunityStore
  @Environment(\.dismiss) private var dismiss
  @State private var draft = SoupDraft()
  @State private var loaded = false
  @State private var busy = false
  @State private var error: String?
  @State private var published: PublishSoupReply?
  @State private var confirmPublish = false

  var body: some View {
    PaperPage {
      if let published {
        Stamp(text: draft.visibility == "public" ? "新汤出锅" : "已私藏", icon: "checkmark", tilted: true)
        Text(draft.title).font(SoupFont.title)
        Text(draft.visibility == "public" ? "你的故事已来到广场，等汤友们来解。" : "已保存到「我的汤」，只有你能看到。")
          .font(SoupFont.prose).lineSpacing(7)
        if let review = published.review, !review.isEmpty {
          SectionCaption(title: "下次熬汤的小建议")
          ForEach(Array(review.enumerated()), id: \.offset) { _, note in
            Text(note.detail).font(SoupFont.prose).lineSpacing(7)
          }
        }
        InkButton(title: "回到大家中间") { dismiss() }.accessibilityIdentifier("publishDone")
      } else {
        VStack(alignment: .leading, spacing: 10) {
          Text("把故事藏进汤里").font(SoupFont.serif(27, weight: .semibold, relativeTo: .title))
          Text("汤面留悬念，汤底藏真相。让大家来问出你的故事。")
            .font(SoupFont.prose).foregroundStyle(SoupTheme.muted).lineSpacing(6)
        }
        draftField(
          "标题", hint: "给这碗汤起个名字", text: $draft.title, limit: 40, lines: 1...2, id: "soupTitle")
        draftField(
          "汤面", hint: "大家最先读到的故事，不要泄露答案。", text: $draft.surface, limit: 200, lines: 4...8,
          id: "soupSurface")
        draftField(
          "汤底", hint: "完整的真相与因果，供主持人回答问题。", text: $draft.truth, limit: 2000, lines: 6...15,
          id: "soupTruth")
        draftField(
          "提示 · 可选", hint: "卡住时，可以递给大家的一点线索。", text: $draft.hint, limit: 200, lines: 2...5,
          id: "soupHint")
        VStack(alignment: .leading, spacing: 15) {
          SectionCaption(title: "这一碗的味道")
          Picker("难度", selection: $draft.difficulty) {
            Text("简单").tag("简单")
            Text("中等").tag("中等")
            Text("困难").tag("困难")
          }.pickerStyle(.segmented)
          TextField(
            "标签", text: $draft.tagsText,
            prompt: Text("标签，用逗号隔开，最多 5 个").foregroundStyle(SoupTheme.muted)
          )
          .font(SoupFont.prose).padding(14).background(SoupTheme.sheet)
          .overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 0.75))
          Picker("谁能看到", selection: $draft.visibility) {
            Text("公开给汤友").tag("public")
            Text("仅自己可见").tag("private")
          }.font(SoupFont.prose)
        }
        if let error {
          Text(error).font(SoupFont.prose).foregroundStyle(SoupTheme.red).lineSpacing(6)
        }
        InkButton(
          title: busy ? "正在熬这一碗…" : draft.visibility == "public" ? "发布到广场" : "保存到我的汤",
          expanded: true
        ) {
          if let message = draft.validationError { error = message } else { confirmPublish = true }
        }.disabled(busy).accessibilityIdentifier("publishSoup")
        Text(busy ? "发布可能需要一点时间，请留在这一页。" : "草稿自动留在本机，下次可以接着写。")
          .font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      }
    }
    .disabled(busy)
    .navigationTitle("写一碗汤").navigationBarTitleDisplayMode(.inline)
    .scrollDismissesKeyboard(.interactively)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button(published == nil ? "收起" : "完成") { dismiss() }.disabled(busy)
      }
      ToolbarItemGroup(placement: .keyboard) {
        Spacer()
        Button("收起键盘") {
          UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
      }
    }
    .interactiveDismissDisabled(busy)
    .task {
      guard !loaded else { return }
      draft = SoupDraft.load(owner: user.uid)
      loaded = true
    }
    .onChange(of: draft) { _, value in if loaded && published == nil { value.save(owner: user.uid) }
    }
    .confirmationDialog(
      draft.visibility == "public" ? "把这碗汤公开给所有汤友？" : "仅保存到自己的作品中？", isPresented: $confirmPublish,
      titleVisibility: .visible
    ) {
      Button(draft.visibility == "public" ? "确认发布" : "确认保存") { Task { await publish() } }
    }
  }

  private func draftField(
    _ title: String, hint: String, text: Binding<String>, limit: Int, lines: ClosedRange<Int>,
    id: String
  ) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(title).font(SoupFont.serif(15, weight: .semibold))
        Spacer()
        Text("\(text.wrappedValue.utf16.count)/\(limit)").font(SoupFont.mono(10))
          .foregroundStyle(text.wrappedValue.utf16.count > limit ? SoupTheme.red : SoupTheme.muted)
      }
      TextField(
        title, text: text, prompt: Text(hint).foregroundStyle(SoupTheme.muted), axis: .vertical
      )
      .font(SoupFont.prose).lineSpacing(6).lineLimit(lines).padding(14).background(SoupTheme.sheet)
      .overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 0.75)).disabled(busy)
      .accessibilityIdentifier(id)
    }
  }
  private func publish() async {
    guard user.uid == store.user?.uid, !busy else { return }
    busy = true
    error = nil
    let submitted = draft
    defer { busy = false }
    do {
      let result = try await SoupAPI.shared.publish(submitted)
      guard user.uid == store.user?.uid else { return }
      draft = submitted
      published = result
      SoupDraft.remove(owner: user.uid)
      community.publicationRevision += 1
    } catch {
      if let failure = error as? SoupAPIError, (400..<500).contains(failure.status) {
        self.error = failure.message
      } else {
        self.error = "暂时没收到发布结果，草稿已保留。请先去「我的汤」确认是否已发布，再决定是否重试。"
      }
    }
  }
}

struct MySoupsScreen: View {
  @EnvironmentObject private var store: SoupStore
  @EnvironmentObject private var community: CommunityStore
  @State private var items: [OwnPuzzle] = []
  @State private var error: String?
  @State private var loading = false
  @State private var showCompose = false
  var body: some View {
    PaperPage {
      PageHeading(eyebrow: "我的作品", title: "我熬的汤")
      if store.user == nil {
        CommunityEmpty(title: "请先登录", message: "作品和草稿跟着各自的账号保存。")
      } else {
        if items.isEmpty && !loading && error == nil {
          CommunityEmpty(title: "轮到你讲故事了", message: "那些不合常理的细节，也许就是下一碗好汤的开始。")
        }
        ForEach(items) { item in
          NavigationLink {
            if item.visibility == "public", let user = store.user {
              PuzzleDetailScreen(
                puzzle: item.publicView(
                  author: PuzzleAuthor(handle: user.handle ?? "", displayName: user.displayName)))
            } else {
              PrivateSoupScreen(puzzle: item)
            }
          } label: {
            VStack(alignment: .leading, spacing: 10) {
              HStack {
                Text(item.visibility == "public" ? "公开" : "仅自己可见")
                Spacer()
                Text(communityDate(item.createdAt))
              }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
              Text(item.title).font(SoupFont.serif(22, weight: .semibold))
              Text("\(item.plays) 人问过 · \(item.solves) 人解开").font(SoupFont.mono(10))
                .foregroundStyle(SoupTheme.muted)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 18)
              .overlay(alignment: .bottom) { PaperRule(dashed: true) }
          }.buttonStyle(.plain)
        }
      }
      if loading { ProgressView().frame(maxWidth: .infinity) }
      if let error { ErrorNote(message: error) { Task { await load() } } }
    }.navigationTitle("我的汤")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("写汤") { showCompose = true }.tint(SoupTheme.red)
        }
      }
      .sheet(isPresented: $showCompose) { NavigationStack { WriteSoupSheet() } }
      .task(id: "\(store.user?.uid ?? "guest"):\(community.publicationRevision)") {
        items = []
        await load()
      }
      .refreshable { await load() }
  }
  private func load() async {
    guard let uid = store.user?.uid else { return }
    loading = true
    error = nil
    defer { loading = false }
    do {
      let result: ItemsReply<OwnPuzzle> = try await SoupAPI.shared.request("/api/me/puzzles")
      guard store.user?.uid == uid, !Task.isCancelled else { return }
      items = result.items
    } catch {
      if store.user?.uid == uid && !isRequestCancellation(error) {
        self.error = error.localizedDescription
      }
    }
  }
}

private struct PrivateSoupScreen: View {
  let puzzle: OwnPuzzle
  var body: some View {
    PaperPage {
      Stamp(text: "仅自己可见", icon: "lock")
      Text(puzzle.title).font(SoupFont.title)
      SurfaceQuote(text: puzzle.surface)
      SectionCaption(title: "汤底")
      Text(puzzle.truth).font(SoupFont.prose).lineSpacing(7).textSelection(.enabled)
      if !puzzle.hint.isEmpty {
        SectionCaption(title: "提示")
        Text(puzzle.hint).font(SoupFont.prose).lineSpacing(7)
      }
    }.navigationTitle("我的私藏")
  }
}
