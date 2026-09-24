import SwiftUI

private enum CommunitySearchHistory {
  static let key = "turtle-soup.community.recent-searches"

  static func load() -> [String] {
    Array((UserDefaults.standard.stringArray(forKey: key) ?? []).prefix(8))
  }

  static func add(_ term: String, to history: [String]) -> [String] {
    let value = term.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return history }
    return Array(([value] + history.filter { $0.caseInsensitiveCompare(value) != .orderedSame }).prefix(8))
  }
}

struct CommunitySearchScreen: View {
  @State private var query = ""
  @State private var recent = CommunitySearchHistory.load()
  @State private var results: [LibraryPuzzle] = []
  @State private var loading = false
  @State private var hasMore = false
  @State private var offset = 0
  @State private var error: String?
  @State private var requestID = UUID()
  @State private var didFocusOnOpen = false
  @FocusState private var searchFocused: Bool

  private var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    PaperPage {
      VStack(alignment: .leading, spacing: 9) {
        Text("汤友广场 · 搜索").font(SoupFont.mono(10)).tracking(2)
          .foregroundStyle(SoupTheme.muted)
        Text("找一碗汤").font(SoupFont.serif(28, weight: .semibold, relativeTo: .title))
          .accessibilityAddTraits(.isHeader)
        Text("搜标题、汤面、标签或作者，找一碗想推理的汤。")
          .font(SoupFont.serif(12)).foregroundStyle(SoupTheme.muted)
      }

      HStack(spacing: 10) {
        Image(systemName: "magnifyingglass").foregroundStyle(SoupTheme.muted)
        TextField(
          "搜索汤面", text: $query, prompt: Text("输入线索或作者").foregroundStyle(SoupTheme.muted)
        )
        .font(SoupFont.prose).autocorrectionDisabled().textInputAutocapitalization(.never)
        .submitLabel(.search).focused($searchFocused)
        .onSubmit { rememberSearch(); searchFocused = false }
        .accessibilityIdentifier("communitySearchField")
        if !query.isEmpty {
          Button {
            query = ""
            searchFocused = true
          } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(SoupTheme.muted)
              .frame(width: 32, height: 44)
          }.accessibilityLabel("清空输入").accessibilityIdentifier("communitySearchClearQuery")
        }
        Button("搜索") {
          rememberSearch()
          searchFocused = false
        }
        .font(SoupFont.mono(11)).foregroundStyle(SoupTheme.red)
        .disabled(term.isEmpty).accessibilityIdentifier("communitySearchSubmit")
      }
      .padding(.leading, 14).padding(.trailing, 10)
      .background(SoupTheme.sheet)
      .overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 0.75))

      if term.isEmpty { historySection } else { resultsSection }
    }
    .navigationTitle("搜索")
    .task {
      guard !didFocusOnOpen else { return }
      didFocusOnOpen = true
      try? await Task.sleep(for: .milliseconds(250))
      if !Task.isCancelled { searchFocused = true }
    }
    .task(id: query) {
      let searched = term
      guard !searched.isEmpty else { return }
      do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
      await load(searched)
    }
    .onChange(of: query) { _, next in
      if next.count > 80 {
        query = String(next.prefix(80))
        return
      }
      requestID = UUID()
      results = []
      offset = 0
      hasMore = false
      error = nil
      loading = !term.isEmpty
    }
  }

  private var historySection: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("最近搜索").tracking(2)
        Spacer()
        if !recent.isEmpty {
          Button("清空记录") {
            recent = []
            UserDefaults.standard.removeObject(forKey: CommunitySearchHistory.key)
          }
          .foregroundStyle(SoupTheme.red)
          .accessibilityIdentifier("communitySearchClearHistory")
        }
      }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      PaperRule().padding(.top, 12)
      if recent.isEmpty {
        CommunityEmpty(title: "还没有搜索记录", message: "试试汤名、故事里的细节，或者一位汤友的名字。")
      } else {
        ForEach(recent, id: \.self) { value in
          Button {
            query = value
            searchFocused = false
          } label: {
            HStack(spacing: 12) {
              Image(systemName: "clock.arrow.circlepath").font(.system(size: 14))
                .foregroundStyle(SoupTheme.muted)
              Text(value).font(SoupFont.prose).lineLimit(1)
              Spacer(minLength: 8)
              Image(systemName: "arrow.up.left").font(.system(size: 11))
                .foregroundStyle(SoupTheme.muted)
            }.frame(minHeight: 52).contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("communitySearchHistory.\(value)")
          .overlay(alignment: .bottom) { PaperRule(dashed: true) }
        }
      }
      Text("记录只保存在这台 iPhone，可随时清空。")
        .font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted).padding(.top, 14)
    }
  }

  private var resultsSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      SectionCaption(title: "搜索结果", detail: loading ? "查找中" : "\(results.count) 碗")
      if loading && results.isEmpty {
        ProgressView("正在翻找汤友来稿…")
          .font(SoupFont.mono(11)).frame(maxWidth: .infinity).padding(.vertical, 28)
      }
      if let error {
        ErrorNote(message: error) { Task { await load(term) } }
      }
      if results.isEmpty && !loading && error == nil {
        CommunityEmpty(title: "还没找到这碗汤", message: "换个线索、汤名或作者，再找找看。")
      }
      LazyVStack(spacing: 0) {
        ForEach(results) { puzzle in
          NavigationLink {
            PuzzleDetailScreen(puzzle: puzzle).onAppear { rememberSearch() }
          } label: {
            VStack(alignment: .leading, spacing: 10) {
              HStack {
                Text(puzzle.official == true ? "每日官汤归档" : "@\(puzzle.owner.displayName)")
                  .foregroundStyle(SoupTheme.red)
                Spacer()
                Text(puzzle.difficulty).foregroundStyle(SoupTheme.muted)
              }.font(SoupFont.mono(10))
              HStack(alignment: .firstTextBaseline) {
                Text(puzzle.title).font(SoupFont.serif(21, weight: .semibold))
                Spacer(minLength: 8)
                Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
              }.foregroundStyle(SoupTheme.ink)
              Text(puzzle.surface).font(SoupFont.serif(13)).lineLimit(2)
                .foregroundStyle(SoupTheme.ink.opacity(0.8))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 18).contentShape(Rectangle())
            .overlay(alignment: .bottom) { PaperRule(dashed: true) }
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("communitySearchResult.\(puzzle.id)")
        }
      }
      if hasMore && !loading {
        Button("再看一些结果") { Task { await load(term, more: true) } }
          .font(SoupFont.prose).frame(maxWidth: .infinity, minHeight: 48)
      }
    }
  }

  private func rememberSearch() {
    guard !term.isEmpty else { return }
    recent = CommunitySearchHistory.add(term, to: recent)
    UserDefaults.standard.set(recent, forKey: CommunitySearchHistory.key)
  }

  private func load(_ searched: String, more: Bool = false) async {
    guard term == searched else { return }
    let id = UUID()
    requestID = id
    loading = true
    error = nil
    let start = more ? offset : 0
    defer { if requestID == id { loading = false } }
    do {
      let fetched = try await SoupAPI.shared.library(sort: "new", query: searched, offset: start)
      guard requestID == id, term == searched, !Task.isCancelled else { return }
      results = more
        ? results + fetched.filter { next in !results.contains(where: { $0.id == next.id }) }
        : fetched
      offset = start + fetched.count
      hasMore = fetched.count == 30
    } catch {
      if requestID == id && !isRequestCancellation(error) {
        self.error = "搜索暂时不可用，请稍后再试"
      }
    }
  }
}
