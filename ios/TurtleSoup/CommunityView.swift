import SwiftUI

struct CommunityScreen: View {
  @EnvironmentObject private var store: SoupStore
  @EnvironmentObject private var community: CommunityStore
  @State private var items: [LibraryPuzzle] = []
  @State private var curated: [LibraryPuzzle] = []
  @State private var sort = "new"
  @State private var error: String?
  @State private var loading = false
  @State private var hasMore = false
  @State private var offset = 0
  @State private var requestID = UUID()
  @State private var showCompose = false

  var body: some View {
    PaperPage {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        Text("汤友广场").font(SoupFont.serif(26, weight: .semibold, relativeTo: .title))
          .accessibilityAddTraits(.isHeader)
        Spacer(minLength: 0)
        Text("一人熬汤，众人寻味")
          .font(SoupFont.serif(11)).foregroundStyle(SoupTheme.muted)
      }
      if let daily = store.daily?.today {
        Button {
          store.selectedTab = 1
        } label: {
          HStack(spacing: 14) {
            Text("今日官汤").font(SoupFont.serif(11, weight: .semibold)).foregroundStyle(SoupTheme.red)
              .fixedSize()
            Text(daily.title).font(SoupFont.serif(15, weight: .semibold)).lineLimit(2)
            Spacer(minLength: 0)
            Image(systemName: "arrow.up.right").font(.system(size: 14, weight: .light))
          }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(SoupTheme.sheet).overlay(
              Rectangle().stroke(SoupTheme.line, lineWidth: 0.75))
        }.buttonStyle(.plain).accessibilityIdentifier("communityDaily")
      }
      if !curated.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          SectionCaption(title: "编辑精选", detail: "汤友原创")
          ForEach(curated) { puzzle in
            NavigationLink {
              PuzzleDetailScreen(puzzle: puzzle)
            } label: {
              VStack(alignment: .leading, spacing: 8) {
                HStack {
                  Text("@\(puzzle.owner.displayName)").font(SoupFont.mono(10))
                    .foregroundStyle(SoupTheme.red)
                  Spacer()
                  Text("编辑荐").font(SoupFont.mono(9)).foregroundStyle(SoupTheme.muted)
                }
                Text(puzzle.title).font(SoupFont.serif(21, weight: .semibold))
                  .foregroundStyle(SoupTheme.ink)
                Text(puzzle.surface).font(SoupFont.serif(13)).lineLimit(2)
                  .foregroundStyle(SoupTheme.ink.opacity(0.8))
                if let note = puzzle.featuredNote {
                  Text("编者按：\(note)").font(SoupFont.serif(12)).foregroundStyle(SoupTheme.muted)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) { Rectangle().fill(SoupTheme.red.opacity(0.6)).frame(width: 2) }
                }
              }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16)
                .overlay(alignment: .bottom) { PaperRule() }
            }.buttonStyle(.plain).accessibilityIdentifier("curated.\(puzzle.id)")
          }
        }
      }
      VStack(spacing: 4) {
        PaperFilters(options: [("new", "最新"), ("featured", "精选"), ("hot", "热门")], selection: $sort)
        LazyVStack(spacing: 0) {
          ForEach(items) { puzzle in CommunityPuzzleCard(puzzle: puzzle) }
        }
      }
      if loading { ProgressView("汤友的来稿正在路上…").font(SoupFont.mono(11)).frame(maxWidth: .infinity) }
      if let error { ErrorNote(message: error) { Task { await load() } } }
      if items.isEmpty && !loading && error == nil {
        CommunityEmpty(
          title: "这里等着第一碗汤",
          message: "把你的奇思妙想，留给汤友来解。")
      }
      if hasMore && !loading {
        Button("再看一些汤") { Task { await load(more: true) } }
          .font(SoupFont.prose).frame(maxWidth: .infinity, minHeight: 44)
      }
    }
    .navigationTitle("海龟汤")
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        NavigationLink {
          CommunitySearchScreen()
        } label: {
          Image(systemName: "magnifyingglass")
        }
        .accessibilityLabel("搜索汤面")
        .accessibilityIdentifier("communitySearchButton")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          showCompose = true
        } label: {
          Label("写汤", systemImage: "square.and.pencil").font(SoupFont.serif(13))
        }.tint(SoupTheme.red).accessibilityIdentifier("writeSoup")
      }
    }
    .sheet(isPresented: $showCompose) { NavigationStack { WriteSoupSheet() } }
    .scrollDismissesKeyboard(.interactively)
    .task(id: "\(sort):\(community.publicationRevision)") { await load(reset: true) }
    .task(id: community.publicationRevision) { await loadCurated() }
    .refreshable {
      await load()
      await loadCurated()
      await store.refreshHome()
      await community.refreshUnread()
    }
  }

  private func loadCurated() async {
    do {
      curated = try await SoupAPI.shared.curated()
    } catch {
      // Keep the last curated selection if a refresh is cancelled or offline.
    }
  }

  private func load(more: Bool = false, reset: Bool = false) async {
    let id = UUID()
    requestID = id
    loading = true
    error = nil
    if reset {
      items = []
      offset = 0
    }
    defer { if requestID == id { loading = false } }
    do {
      let fetched = try await SoupAPI.shared.library(
        sort: sort, offset: more ? offset : 0)
      guard requestID == id, !Task.isCancelled else { return }
      hasMore = fetched.count == 30
      offset = (more ? offset : 0) + fetched.count
      items =
        more
        ? items + fetched.filter { next in !items.contains(where: { $0.id == next.id }) } : fetched
    } catch {
      if requestID == id && !isRequestCancellation(error) { self.error = "暂时未能取到新汤，请稍后再试" }
    }
  }
}

struct AuthorAvatar: View {
  let name: String
  var official = false
  var size: CGFloat = 34
  var body: some View {
    Text(official ? "官" : String(name.prefix(1)).uppercased())
      .font(SoupFont.serif(size * 0.47, weight: .semibold))
      .foregroundStyle(official ? SoupTheme.red : SoupTheme.ink.opacity(0.75))
      .frame(width: size, height: size).background(SoupTheme.ink.opacity(0.035))
      .overlay(
        Rectangle().stroke(official ? SoupTheme.red.opacity(0.5) : SoupTheme.line, lineWidth: 0.75)
      )
      .accessibilityHidden(true)
  }
}

struct PuzzleAuthorLink: View {
  let puzzle: LibraryPuzzle
  var body: some View {
    if puzzle.official != true && !puzzle.owner.handle.isEmpty {
      NavigationLink {
        AuthorProfileScreen(handle: puzzle.owner.handle)
      } label: {
        label
      }
      .buttonStyle(.plain).accessibilityIdentifier("author.\(puzzle.id)")
    } else {
      label
    }
  }
  private var label: some View {
    HStack(spacing: 10) {
      AuthorAvatar(name: puzzle.owner.displayName, official: puzzle.official == true)
      VStack(alignment: .leading, spacing: 4) {
        Text(puzzle.official == true ? "海龟汤 · 官方" : puzzle.owner.displayName)
          .font(SoupFont.serif(13, weight: .semibold)).lineLimit(1)
        Text(
          puzzle.official == true
            ? "每日官汤归档"
            : "\(communityDate(puzzle.createdAt)) 熬了一碗汤".trimmingCharacters(in: .whitespaces)
        )
        .font(SoupFont.mono(9)).foregroundStyle(SoupTheme.muted)
      }
      Spacer(minLength: 0)
      if puzzle.featured == true {
        Text("精选").font(SoupFont.mono(9)).foregroundStyle(SoupTheme.red)
      }
    }.frame(minHeight: 44).contentShape(Rectangle())
  }
}

struct CommunityPuzzleCard: View {
  let puzzle: LibraryPuzzle
  @EnvironmentObject private var store: SoupStore
  @EnvironmentObject private var community: CommunityStore
  private var target: SocialTarget { SocialTarget(kind: .puzzle, id: puzzle.id) }
  private var snapshot: SocialSnapshot? { community.snapshots[target] }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      PuzzleAuthorLink(puzzle: puzzle)
      NavigationLink {
        PuzzleDetailScreen(puzzle: puzzle)
      } label: {
        VStack(alignment: .leading, spacing: 12) {
          Text(puzzle.title).font(SoupFont.serif(23, weight: .semibold, relativeTo: .title2))
            .fixedSize(horizontal: false, vertical: true)
          Text(puzzle.surface).font(SoupFont.serif(15)).lineSpacing(7).lineLimit(3)
            .foregroundStyle(SoupTheme.ink.opacity(0.82))
          Text(
            ([puzzle.difficulty] + puzzle.tags.prefix(2).map { "#\($0)" }).joined(
              separator: "  ·  ")
          )
          .font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted).lineLimit(1)
        }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
      }.buttonStyle(.plain).accessibilityIdentifier("puzzleRow.\(puzzle.id)")
      HStack(spacing: 22) {
        Button {
          Task { await community.toggleLike(target) }
        } label: {
          Label(
            snapshot.map { String($0.likes) } ?? "赞",
            systemImage: snapshot?.liked == true ? "heart.fill" : "heart"
          )
          .foregroundStyle(snapshot?.liked == true ? SoupTheme.red : SoupTheme.muted)
        }.disabled(snapshot == nil || community.busy.contains(target))
          .accessibilityLabel(snapshot?.liked == true ? "取消赞" : "赞这碗汤")
        NavigationLink {
          PuzzleDetailScreen(puzzle: puzzle, discussionOpen: true)
        } label: {
          Label(snapshot.map { String($0.comments.count) } ?? "讨论", systemImage: "text.bubble")
            .foregroundStyle(SoupTheme.muted)
        }.accessibilityLabel("讨论\(snapshot.map { "，\($0.comments.count) 条留言" } ?? "")")
        Spacer(minLength: 0)
        Button {
          store.start(puzzle)
        } label: {
          HStack(spacing: 6) {
            Text("去推理")
            Image(systemName: "arrow.up.right")
          }
          .foregroundStyle(SoupTheme.ink)
        }
      }.font(SoupFont.mono(11)).buttonStyle(.plain).frame(minHeight: 44)
      if let error = community.errors[target] {
        Button {
          Task { await community.load(target, force: true) }
        } label: {
          Text(snapshot == nil ? "互动暂未更新 · 轻点重试" : error).font(SoupFont.mono(10)).foregroundStyle(
            SoupTheme.muted)
        }.frame(minHeight: 30)
      }
    }.padding(.vertical, 22).overlay(alignment: .bottom) { PaperRule() }
      .task(id: community.generation) { await community.load(target) }
  }
}

struct SocialPanel: View {
  let target: SocialTarget
  var spoilers = true
  @State var expanded = false
  @EnvironmentObject private var store: SoupStore
  @EnvironmentObject private var community: CommunityStore
  @State private var text = ""
  @State private var error: String?
  @State private var showLogin = false
  @State private var deleting: SocialComment?
  @State private var reporting: SocialComment?
  @State private var reportSent = false
  @State private var sending = false
  @FocusState private var commenting: Bool
  private var snapshot: SocialSnapshot? { community.snapshots[target] }

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      PaperRule(strong: true)
      HStack {
        Text(spoilers ? "汤友讨论" : "给作者留言").font(SoupFont.serif(21, weight: .semibold))
        Spacer()
        Button {
          Task { await community.toggleLike(target) }
        } label: {
          Label(
            snapshot.map { "\($0.likes)" } ?? "赞",
            systemImage: snapshot?.liked == true ? "heart.fill" : "heart")
        }.font(SoupFont.mono(12)).foregroundStyle(
          snapshot?.liked == true ? SoupTheme.red : SoupTheme.muted
        )
        .disabled(snapshot == nil || community.busy.contains(target)).frame(minHeight: 44)
      }
      if spoilers && !expanded {
        Button {
          withAnimation { expanded = true }
          if target.kind == .puzzle {
            Task { await SoupAPI.shared.trackEngagement("discussion_open", puzzleId: target.id) }
          }
        } label: {
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text(snapshot.map { "查看讨论 · \($0.comments.count) 条留言" } ?? "查看讨论")
              Spacer()
              Image(systemName: "chevron.down").font(.system(size: 12))
            }
            Text("可能涉及汤底，想先推理的话，晚点再来。")
              .font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
          }.font(SoupFont.serif(14)).padding(.vertical, 12).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("showDiscussion")
      } else {
        if spoilers { Text("以下讨论可能涉及汤底").font(SoupFont.mono(10)).foregroundStyle(SoupTheme.red) }
        if let snapshot {
          ForEach(snapshot.comments) { comment in commentRow(comment) }
          if snapshot.comments.isEmpty {
            Text("还没有留言。聊聊你发现的细节？").font(SoupFont.prose).foregroundStyle(SoupTheme.muted)
              .padding(.vertical, 8)
          }
          if store.user != nil && snapshot.signedIn {
            VStack(alignment: .leading, spacing: 10) {
              TextField(
                "写下你的想法", text: $text, prompt: Text("写下你的想法…").foregroundStyle(SoupTheme.muted),
                axis: .vertical
              )
              .font(SoupFont.prose).lineLimit(3...6).padding(14).background(SoupTheme.sheet)
              .focused($commenting)
              .overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 0.75)).accessibilityIdentifier(
                "commentInput")
              HStack {
                Text("\(text.utf16.count)/300").font(SoupFont.mono(10)).foregroundStyle(
                  SoupTheme.muted)
                Spacer()
                Button(sending ? "寄出中…" : "发布留言 →") { Task { await send() } }
                  .font(SoupFont.serif(13, weight: .semibold)).frame(minHeight: 44)
                  .disabled(
                    sending || community.busy.contains(target)
                      || !(2...300).contains(
                        text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)
                  )
                  .accessibilityIdentifier("postComment")
              }
            }
          } else {
            Button {
              showLogin = true
            } label: {
              HStack {
                Text("登录，加入这场讨论")
                Spacer()
                Image(systemName: "arrow.right")
              }
              .font(SoupFont.serif(14)).frame(minHeight: 48)
            }.accessibilityIdentifier("joinDiscussion")
          }
        } else if community.errors[target] == nil {
          ProgressView("正在读汤友的留言…").font(SoupFont.mono(11))
        }
      }
      if let message = error ?? community.errors[target] {
        Text(message).font(SoupFont.mono(11)).foregroundStyle(SoupTheme.red)
        if snapshot == nil { Button("再试一次") { Task { await community.load(target, force: true) } } }
      }
    }
    .task(id: community.generation) {
      text = ""
      error = nil
      await community.load(target, force: true)
      if expanded && target.kind == .puzzle {
        await SoupAPI.shared.trackEngagement("discussion_open", puzzleId: target.id)
      }
    }
    .sheet(isPresented: $showLogin) { NavigationStack { LoginScreen() } }
    .confirmationDialog(
      "删除这条留言？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible
    ) {
      Button("删除留言", role: .destructive) {
        guard let comment = deleting else { return }
        deleting = nil
        Task {
          do { try await community.delete(comment, on: target) } catch {
            if !isRequestCancellation(error) { self.error = error.localizedDescription }
          }
        }
      }
    }
    .confirmationDialog(
      "举报这条留言包含不当内容？",
      isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } }),
      titleVisibility: .visible
    ) {
      Button("提交举报", role: .destructive) {
        guard let comment = reporting else { return }
        reporting = nil
        Task { await report(comment) }
      }
    }
    .alert("举报已收到", isPresented: $reportSent) { Button("好", role: .cancel) {} }
  }

  private func commentRow(_ comment: SocialComment) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        NavigationLink {
          AuthorProfileScreen(handle: comment.author.handle)
        } label: {
          HStack(spacing: 10) {
            AuthorAvatar(name: comment.author.displayName, size: 28)
            Text(comment.author.displayName).font(SoupFont.serif(13, weight: .semibold))
          }
        }.buttonStyle(.plain).disabled(comment.author.handle.isEmpty)
        Spacer()
        Text(communityDate(comment.createdAt)).font(SoupFont.mono(9)).foregroundStyle(
          SoupTheme.muted)
        Menu {
          if comment.canDelete { Button("删除留言", role: .destructive) { deleting = comment } }
          if !comment.mine { Button("举报留言", role: .destructive) { reporting = comment } }
        } label: {
          Image(systemName: "ellipsis").frame(minWidth: 36, minHeight: 44)
        }.disabled(community.busy.contains(target)).accessibilityLabel("留言操作")
      }
      Text(comment.body).font(SoupFont.prose).lineSpacing(6).textSelection(.enabled)
      PaperRule(dashed: true)
    }
  }
  private func send() async {
    commenting = false
    sending = true
    error = nil
    defer { sending = false }
    do {
      try await community.comment(text, on: target)
      text = ""
    } catch { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
  private func report(_ comment: SocialComment) async {
    do {
      let _: ReportReply = try await SoupAPI.shared.send(
        "/api/social/comments/\(apiSegment(comment.id))/report",
        body: ["note": "举报留言包含不当内容，请审核。", "locale": "zh-CN", "playerKey": NativeIdentity.playerKey])
      reportSent = true
    } catch { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
}

struct AuthorProfileScreen: View {
  let handle: String
  @State private var author: PublicAuthor?
  @State private var error: String?
  var body: some View {
    PaperPage {
      if let author {
        HStack(alignment: .top, spacing: 18) {
          AuthorAvatar(name: author.displayName, size: 58)
          VStack(alignment: .leading, spacing: 9) {
            Text(author.displayName).font(SoupFont.title)
            Text("@\(author.handle)").font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
          }
        }
        if author.profilePublic {
          if !author.bio.isEmpty { Text(author.bio).font(SoupFont.prose).lineSpacing(7) }
          if let recognition = author.recognition {
            HStack(spacing: 22) {
              Text("\(recognition.puzzles) 碗汤")
              Text("\(recognition.plays) 人问过")
              Text("\(recognition.likes) 份喜欢")
            }.font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
          }
          VStack(spacing: 0) {
            SectionCaption(title: "TA 熬的汤", detail: "\(author.puzzles.count) 碗")
            ForEach(author.puzzles) { puzzle in
              NavigationLink {
                PuzzleDetailScreen(puzzle: puzzle)
              } label: {
                PuzzleRow(puzzle: puzzle)
              }.buttonStyle(.plain)
            }
            if author.puzzles.isEmpty {
              CommunityEmpty(title: "下一碗，还在酝酿", message: "这位汤友还没有公开的作品。")
            }
          }
          SocialPanel(
            target: SocialTarget(kind: .profile, id: handle), spoilers: false, expanded: true)
        } else {
          CommunityEmpty(title: "这位汤友暂未公开主页", message: "这位汤友选择暂时收起主页。")
        }
      } else if error == nil {
        ProgressView("正在拜访这位汤友…").frame(maxWidth: .infinity)
      }
      if let error { ErrorNote(message: error) { Task { await load() } } }
    }.navigationTitle("汤友主页").task { await load() }.refreshable { await load() }
  }
  private func load() async {
    error = nil
    do {
      let result: ProfileReply = try await SoupAPI.shared.request("/api/u/\(apiSegment(handle))")
      guard !Task.isCancelled else { return }
      author = result.profile
    } catch { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
}

struct ActivityScreen: View {
  @EnvironmentObject private var store: SoupStore
  @EnvironmentObject private var community: CommunityStore
  @State private var events: [AuthorActivity] = []
  @State private var loading = false
  @State private var error: String?
  @State private var showLogin = false

  var body: some View {
    PaperPage {
      PageHeading(eyebrow: "汤友之间", title: "有了回响", subtitle: "你熬的汤，有人来问；你留下的故事，有人记得。")
      if store.user == nil {
        CommunityEmpty(title: "让每份好奇，都找到你", message: "登录后，在这里收到作品的留言、喜欢和推理动态。")
        InkButton(title: "登录，看看回响") { showLogin = true }.accessibilityIdentifier("activityLogin")
      } else {
        if loading && events.isEmpty { ProgressView().frame(maxWidth: .infinity) }
        if !loading && events.isEmpty && error == nil {
          CommunityEmpty(title: "第一声回响，值得等待", message: "写下一碗汤，邀请大家来解。有人参与时，就会出现在这里。")
        }
        LazyVStack(spacing: 0) {
          ForEach(Array(events.enumerated()), id: \.offset) { index, event in
            NavigationLink {
              if let id = event.puzzleId {
                CommunityPuzzleLoader(id: id)
              } else if let handle = store.user?.handle {
                AuthorProfileScreen(handle: handle)
              }
            } label: {
              activityRow(event)
            }.buttonStyle(.plain)
              .accessibilityIdentifier("activityEvent.\(index)")
              .disabled(event.puzzleId == nil && store.user?.handle == nil)
          }
        }
        if let error { ErrorNote(message: error) { Task { await load() } } }
      }
    }.navigationTitle("动态")
      .sheet(isPresented: $showLogin) { NavigationStack { LoginScreen() } }
      .task(id: store.user?.uid) {
        events = []
        error = nil
        await load()
      }
      .refreshable { await load() }
  }
  private func activityRow(_ event: AuthorActivity) -> some View {
    HStack(alignment: .top, spacing: 15) {
      Image(systemName: event.symbol).font(.system(size: 18, weight: .light))
        .foregroundStyle(SoupTheme.red).frame(width: 26).padding(.top, 3)
      VStack(alignment: .leading, spacing: 10) {
        Text(event.description).font(SoupFont.serif(15, weight: .semibold))
        if !event.body.isEmpty { Text(event.body).font(SoupFont.prose).lineSpacing(5).lineLimit(3) }
        if !event.puzzleTitle.isEmpty {
          Text("《\(event.puzzleTitle)》").font(SoupFont.prose).foregroundStyle(SoupTheme.muted)
        }
        Text(communityDate(event.at)).font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      }
      Spacer(minLength: 0)
    }.padding(.vertical, 22).frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .bottom) { PaperRule(dashed: true) }
  }
  private func load() async {
    guard let uid = store.user?.uid else { return }
    loading = true
    error = nil
    defer { loading = false }
    do {
      let result: ItemsReply<AuthorActivity> = try await SoupAPI.shared.request(
        "/api/me/activity?limit=30")
      guard uid == store.user?.uid, !Task.isCancelled else { return }
      events = result.items
      if store.selectedTab == 2 { await community.markSeen() }
    } catch {
      if uid == store.user?.uid && !isRequestCancellation(error) {
        self.error = error.localizedDescription
      }
    }
  }
}

struct CommunityPuzzleLoader: View {
  let id: String
  @State private var puzzle: LibraryPuzzle?
  @State private var error: String?
  var body: some View {
    Group {
      if let puzzle {
        PuzzleDetailScreen(puzzle: puzzle, discussionOpen: true)
      } else {
        PaperPage {
          if let error {
            ErrorNote(message: error) { Task { await load() } }
          } else {
            ProgressView("正在取来这碗汤…").frame(maxWidth: .infinity)
          }
        }
      }
    }.task { await load() }
  }
  private func load() async {
    error = nil
    do { puzzle = try await SoupAPI.shared.request("/api/library/puzzles/\(apiSegment(id))") } catch
    { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
}

struct CommunityEmpty: View {
  let title: String
  let message: String
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title).font(SoupFont.serif(19, weight: .semibold)).foregroundStyle(SoupTheme.ink)
      Text(message).font(SoupFont.prose).lineSpacing(7).foregroundStyle(SoupTheme.muted)
    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 24)
  }
}
