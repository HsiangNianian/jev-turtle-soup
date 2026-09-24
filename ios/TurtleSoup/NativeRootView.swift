import SwiftUI

struct NativeRootView: View {
  @StateObject private var store = SoupStore()
  @StateObject private var community = CommunityStore()
  @AppStorage("native.appearance") private var appearance = "system"
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    TabView(selection: $store.selectedTab) {
      NavigationStack { CommunityScreen() }
        .tabItem { Label("广场", systemImage: "person.2").environment(\.symbolVariants, .none) }.tag(
          0)
      NavigationStack { DailyScreen() }
        .tabItem { Label("每日", systemImage: "calendar").environment(\.symbolVariants, .none) }.tag(
          1)
      NavigationStack { ActivityScreen() }
        .id("activity-\(store.user?.uid ?? "guest")")
        .tabItem { Label("动态", systemImage: "text.bubble").environment(\.symbolVariants, .none) }
        .badge(community.unread).tag(2)
      NavigationStack { AccountScreen() }
        .id("account-\(store.user?.uid ?? "guest")")
        .tabItem {
          Label("我的", systemImage: "person.crop.square").environment(\.symbolVariants, .none)
        }.tag(3)
    }
    .font(SoupFont.body).foregroundStyle(SoupTheme.ink).tint(SoupTheme.ink)
    .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
    .environmentObject(store)
    .environmentObject(community)
    .fullScreenCover(item: $store.activeCase) { route in
      NavigationStack { InvestigationScreen(caseID: route.id) }
        .environmentObject(store).environmentObject(community).tint(SoupTheme.ink)
    }
    .task {
      await store.bootstrap()
      await SoupAPI.shared.trackEngagement("entry_view")
    }
    .onChange(of: store.user?.uid, initial: true) { _, uid in
      community.activate(uid)
      Task { await community.refreshUnread() }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        Task {
          if store.daily?.today?.date != DailyPuzzle.utcToday {
            await store.refreshHome()
          }
          await store.refreshAccount()
          await community.refreshUnread()
        }
      }
    }
  }
}

struct SurfaceQuote: View {
  let text: String
  var body: some View {
    Text(text).font(SoupFont.prose).lineSpacing(9)
      .foregroundStyle(SoupTheme.ink.opacity(0.88))
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 14)
      .overlay(alignment: .leading) { Rectangle().fill(SoupTheme.line).frame(width: 2) }
  }
}

struct PuzzleMetadata: View {
  let difficulty: String
  var language: String? = nil
  var genre: Double? = nil
  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 12) { contents }
      VStack(alignment: .leading, spacing: 8) { contents }
    }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
  }
  @ViewBuilder private var contents: some View {
    Text(difficulty).padding(.horizontal, 7).padding(.vertical, 3)
      .overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 1))
    if let language { Text(language) }
    if let label = genreText(genre) { Text(label).foregroundStyle(SoupTheme.red) }
  }
}

struct DailyScreen: View {
  @EnvironmentObject private var store: SoupStore
  private var history: [DailyPuzzle] {
    (store.daily?.history ?? []).filter { $0.date < DailyPuzzle.utcToday }
  }
  var body: some View {
    PaperPage {
      PageHeading(
        eyebrow: "官方汤", title: "每日官方汤",
        subtitle: "每天零点（UTC）由砚熬一碗，所有人都拿到同一道题。当天只能问，过了午夜便能回看汤底。")
      if let today = store.daily?.today {
        VStack(alignment: .leading, spacing: 0) {
          HStack {
            Text("今日 · \(today.date)").font(SoupFont.mono(10))
              .tracking(0.5).foregroundStyle(SoupTheme.muted)
            Spacer(minLength: 6)
            Stamp(text: "明日解锁", icon: "lock", tilted: true)
          }.padding(.horizontal, 16).padding(.vertical, 18)
          PaperRule(strong: true)
          VStack(alignment: .leading, spacing: 18) {
            Text(today.title).font(SoupFont.serif(23, weight: .semibold, relativeTo: .title2))
              .fixedSize(horizontal: false, vertical: true)
            PuzzleMetadata(
              difficulty: today.difficulty, language: today.language, genre: today.genreScore)
            SurfaceQuote(text: today.surface ?? "")
            ViewThatFits(in: .horizontal) {
              HStack(spacing: 16) { todayActions(today) }
              VStack(alignment: .leading, spacing: 12) { todayActions(today) }
            }
          }.padding(18)
        }
        .background(SoupTheme.sheet)
        .overlay(Rectangle().stroke(SoupTheme.ink.opacity(0.85), lineWidth: 1))
      }
      VStack(spacing: 0) {
        SectionCaption(title: "往期", detail: String(format: "%02d 碗", history.count))
        ForEach(history) { item in
          NavigationLink {
            DailyDetailScreen(date: item.date, initial: nil)
          } label: {
            VStack(alignment: .leading, spacing: 10) {
              HStack {
                Text(item.date)
                Spacer()
                Text("\(item.language) · \(item.difficulty)")
              }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
              HStack {
                Text(item.title).font(SoupFont.serif(20, relativeTo: .title3))
                Spacer()
                Image(systemName: "arrow.right").font(.system(size: 15, weight: .light))
                  .foregroundStyle(SoupTheme.muted)
              }
            }.padding(.vertical, 18).overlay(alignment: .bottom) { PaperRule(dashed: true) }
          }.buttonStyle(.plain)
        }
      }.padding(.top, 8)
      if let error = store.homeError {
        if store.daily != nil {
          HStack(spacing: 12) {
            Text(error).frame(maxWidth: .infinity, alignment: .leading)
            Button("重试") { Task { await store.refreshHome() } }.frame(minHeight: 44)
          }.font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
        } else {
          ErrorNote(message: "暂时未能取到每日官汤") { Task { await store.refreshHome() } }
        }
      }
      if store.loadingHome && store.daily == nil { ProgressView().frame(maxWidth: .infinity) }
    }
    .navigationTitle("每日官汤").refreshable { await store.refreshHome() }
    .task { if store.daily == nil { await store.refreshHome() } }
  }
  @ViewBuilder private func todayActions(_ today: DailyPuzzle) -> some View {
    InkButton(title: store.games.contains(where: { $0.id == today.puzzleId }) ? "继续调查" : "开始推理") {
      store.start(today)
    }.accessibilityIdentifier("startDaily")
    NavigationLink {
      DailyDetailScreen(date: today.date, initial: today)
    } label: {
      Text("查看案卷").font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted).frame(minHeight: 44)
    }
  }
}

struct DailyDetailScreen: View {
  let date: String
  let initial: DailyPuzzle?
  @EnvironmentObject private var store: SoupStore
  @State private var daily: DailyPuzzle?
  @State private var error: String?
  @State private var showTruth = false
  var body: some View {
    PaperPage {
      if let item = daily ?? initial {
        SectionCaption(title: "官方案卷", detail: item.date)
        Text(item.title).font(SoupFont.title)
        PuzzleMetadata(difficulty: item.difficulty, language: item.language, genre: item.genreScore)
        SurfaceQuote(text: item.surface ?? "")
          .textSelection(.enabled)
        if !item.isLocked {
          SolveTurnRecordsView(shortest: item.shortestSolveTurns, longest: item.longestSolveTurns)
        }
        InkButton(title: "开始推理") { store.start(item) }
        if item.isLocked {
          Label("明日解锁汤底，今天只管大胆提问。", systemImage: "lock")
            .font(SoupFont.serif(14)).foregroundStyle(SoupTheme.muted)
        } else {
          DisclosureGroup("查看汤底", isExpanded: $showTruth) {
            VStack(alignment: .leading, spacing: 20) {
              Text(item.truth ?? "汤底暂不可用").lineSpacing(7)
              if let story = item.story, !story.isEmpty {
                Divider()
                Text(story).lineSpacing(7)
              }
            }.font(SoupFont.body).padding(.top, 16).textSelection(.enabled)
          }.tint(SoupTheme.red)
        }
        ShareLink(item: URL(string: "https://hgt.mmstudio.games/daily/\(date)")!) {
          Label("分享这桩案件", systemImage: "square.and.arrow.up")
        }.font(SoupFont.serif(14))
        if !item.isLocked, let id = item.puzzleId {
          SocialPanel(target: SocialTarget(kind: .puzzle, id: id))
        }
      } else if error == nil {
        ProgressView("正在调取案卷…").frame(maxWidth: .infinity)
      }
      if let error { ErrorNote(message: error) { Task { await load() } } }
    }.navigationTitle("案卷详情").task { await load() }
  }
  private func load() async {
    error = nil
    do {
      let result: DailyReply = try await SoupAPI.shared.request("/api/daily/\(date)")
      daily = result.daily
    } catch { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
}

struct PuzzleRow: View {
  let puzzle: LibraryPuzzle
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        Text(puzzle.difficulty)
        if puzzle.official == true { Text("官方").foregroundStyle(SoupTheme.red) }
        Spacer()
        if let genre = genreText(puzzle.genreScore) { Text(genre).foregroundStyle(SoupTheme.red) }
      }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      HStack(alignment: .firstTextBaseline, spacing: 14) {
        Text(puzzle.title).font(SoupFont.serif(21, relativeTo: .title3))
        Spacer(minLength: 0)
        Image(systemName: "arrow.up.right").font(.system(size: 14, weight: .light))
          .foregroundStyle(SoupTheme.muted)
      }
      Text(puzzle.surface).font(SoupFont.serif(14)).foregroundStyle(SoupTheme.ink.opacity(0.72))
        .lineSpacing(6).lineLimit(2)
      HStack(spacing: 8) {
        Text("@\(puzzle.owner.displayName)").lineLimit(1)
        Spacer(minLength: 4)
        Text("\(puzzle.plays) 人问过").fixedSize()
      }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted).padding(.top, 3)
    }.padding(.vertical, 20).frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .bottom) { PaperRule(dashed: true) }.contentShape(Rectangle())
  }
}

struct PuzzleDetailScreen: View {
  let puzzle: LibraryPuzzle
  var discussionOpen = false
  @EnvironmentObject private var store: SoupStore
  @State private var latestPuzzle: LibraryPuzzle?
  private var item: LibraryPuzzle { latestPuzzle ?? puzzle }
  var body: some View {
    PaperPage {
      PuzzleAuthorLink(puzzle: item)
      Text(item.title).font(SoupFont.title)
      PuzzleMetadata(difficulty: item.difficulty, genre: item.genreScore)
      SurfaceQuote(text: item.surface).textSelection(
        .enabled)
      if !item.tags.isEmpty {
        Text(item.tags.map { "#\($0)" }.joined(separator: "  ")).font(SoupFont.mono(11))
          .foregroundStyle(
            .secondary)
      }
      SolveTurnRecordsView(shortest: item.shortestSolveTurns, longest: item.longestSolveTurns)
      InkButton(title: "开始推理") { store.start(item) }.accessibilityIdentifier("startLibrary")
      HStack {
        Label("\(item.plays) 人问过", systemImage: "bubble.left.and.bubble.right")
        Spacer()
        Text("\(item.solves) 人解开")
      }.font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
      ShareLink(item: URL(string: "https://hgt.mmstudio.games/library/\(puzzle.id)")!) {
        Label("分享这桩案件", systemImage: "square.and.arrow.up")
      }.font(SoupFont.serif(14))
      SocialPanel(target: SocialTarget(kind: .puzzle, id: puzzle.id), expanded: discussionOpen)
    }.navigationTitle("这碗汤")
      .task(id: puzzle.id) {
        latestPuzzle = try? await SoupAPI.shared.request("/api/library/puzzles/\(puzzle.id)")
      }
  }
}

private struct SolveTurnRecordsView: View {
  let shortest: Int?
  let longest: Int?
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 20) {
        turnRecord("最短解开", turns: shortest)
        turnRecord("最长解开", turns: longest)
      }.frame(maxWidth: .infinity, alignment: .leading)
      Text("仅统计已解开对局，作者账号不计入")
        .font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
    }.padding(.vertical, 15)
      .overlay(alignment: .top) { PaperRule() }
      .overlay(alignment: .bottom) { PaperRule() }
  }

  private func turnRecord(_ title: String, turns: Int?) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      Text(turns.map { "\($0) 轮" } ?? "暂无纪录")
        .font(SoupFont.serif(21)).foregroundStyle(SoupTheme.ink)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct CaseRow: View {
  let game: CaseFile
  var body: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 9) {
        Text(game.title).font(SoupFont.serif(20, relativeTo: .title3))
        Text("\(game.statusLabel) · 已问 \(game.turnCount) 轮").font(SoupFont.mono(11))
          .foregroundStyle(
            .secondary)
      }
      Spacer()
      Image(systemName: game.solved ? "checkmark.seal" : "arrow.up.right")
        .foregroundStyle(game.solved ? SoupTheme.red : SoupTheme.muted)
    }.padding(.vertical, 18).contentShape(Rectangle()).overlay(alignment: .bottom) {
      Rectangle().fill(SoupTheme.line).frame(height: 0.5)
    }
  }
}

struct GuideScreen: View {
  private let steps = [
    ("01", "先读汤面", "表面上说不通的故事，背后有一条完整的因果链。注意时间、人物和不寻常的细节。"),
    ("02", "一次确认一件事", "向主持人砚提问，例如「她认识那个人吗？」。优先提出能用是或不是回答的问题。"),
    ("03", "把线索连起来", "确认动机、手法和转折，最后直接说出你的完整推理。需要帮助时，可以请砚给一点提示。"),
    ("04", "让案件留在案头", "随时返回，调查进度会保存在本机。登录同一账号后，可与网页端同步案卷。今日官汤在 UTC 零点后揭晓。"),
  ]
  var body: some View {
    PaperPage {
      Text("调查员手册").font(SoupFont.title)
      ForEach(steps, id: \.0) { number, title, text in
        VStack(alignment: .leading, spacing: 12) {
          SectionCaption(title: number, detail: title)
          Text(text).font(SoupFont.body).lineSpacing(7)
        }
      }
    }.navigationTitle("玩法指南")
  }
}
