import Foundation
import SwiftUI

@MainActor
final class SoupStore: ObservableObject {
  @Published var daily: DailyIndex?
  @Published var homeError: String?
  @Published var loadingHome = false
  @Published private(set) var games: [CaseFile] = []
  @Published private(set) var user: SoupUser?
  @Published private(set) var pending: Set<String> = []
  @Published var syncMessage: String?
  @Published private(set) var syncing = false
  @Published var activeCase: CaseRoute?
  @Published var selectedTab = 0

  struct CaseRoute: Identifiable { let id: String }
  private var owner: String { user?.uid ?? "guest" }
  private var dirtyIDs: Set<String> = []
  private var syncTask: Task<Void, Never>?
  private var syncRequested = false
  private var authGeneration = 0
  private let archive: CaseArchive
  private let api: SoupAPI
  private let defaults: UserDefaults
  private let playerKey: String
  private var booted = false
  private var archiveWritable = true

  init(
    api: SoupAPI = .shared, archive: CaseArchive = CaseArchive(), defaults: UserDefaults = .standard
  ) {
    self.api = api
    self.archive = archive
    self.defaults = defaults
    playerKey = NativeIdentity.playerKey
    if let data = defaults.data(forKey: "native.user") {
      user = try? JSONDecoder().decode(SoupUser.self, from: data)
    }
    loadArchive()
  }

  var activeGames: [CaseFile] { games.filter { !$0.isFinished } }
  var finishedGames: [CaseFile] { games.filter(\.isFinished) }

  func bootstrap() async {
    guard !booted else { return }
    booted = true
    async let home: Void = refreshHome()
    async let account: Void = refreshAccount()
    _ = await (home, account)
  }

  func refreshHome() async {
    guard !loadingHome else { return }
    loadingHome = true
    defer { loadingHome = false }
    homeError = nil
    do {
      let result: DailyIndex = try await api.request("/api/daily")
      daily = result
    } catch {
      if !isRequestCancellation(error) { homeError = "暂时未能更新，已保留当前内容" }
    }
  }

  func refreshAccount() async {
    let generation = authGeneration
    do {
      let result: UserReply = try await api.request("/api/auth/me")
      guard generation == authGeneration else { return }
      activate(result.user)
      await sync()
    } catch let error as SoupAPIError where error.status == 401 {
      if generation == authGeneration { activate(nil) }
    } catch {
      if generation == authGeneration, user != nil { syncMessage = "进度已保存在本机，联网后可再次同步" }
    }
  }

  func signIn(email: String, code: String, includeGuest: Bool) async throws {
    authGeneration += 1
    let guestGames = user == nil && includeGuest ? games : []
    let result: UserReply = try await api.send(
      "/api/auth/verify", body: ["email": email, "code": code, "locale": "zh-CN"])
    guard let account = result.user else { throw SoupAPIError(status: 401, message: "登录状态无效，请重试") }
    activate(account)
    if !guestGames.isEmpty {
      games = CaseFile.merge(games, guestGames)
      dirtyIDs.formUnion(guestGames.map(\.id))
      persist()
    }
    await sync()
  }

  func signOut() async throws {
    guard pending.isEmpty else { throw SoupAPIError(status: 0, message: "请等待砚回复后再退出账号") }
    authGeneration += 1
    let _: OKReply = try await api.request("/api/auth/logout", method: "POST")
    activate(nil)
  }

  private func activate(_ account: SoupUser?) {
    let changed = account?.uid != user?.uid
    if changed {
      authGeneration += 1
      syncTask?.cancel()
      activeCase = nil
      pending = []
    }
    user = account
    if let account, let data = try? JSONEncoder().encode(account) {
      defaults.set(data, forKey: "native.user")
    } else {
      defaults.removeObject(forKey: "native.user")
    }
    if changed { loadArchive() }
  }

  func open(_ game: CaseFile) { activeCase = CaseRoute(id: game.id) }

  func start(_ daily: DailyPuzzle) {
    guard archiveWritable else { return }
    guard let id = daily.puzzleId, let surface = daily.surface else { return }
    Task { await api.trackEngagement("puzzle_open", puzzleId: id) }
    if let existing = games.first(where: { $0.id == id }) {
      open(existing)
      return
    }
    var game = makeCase(
      id: id, title: daily.title, surface: surface, difficulty: daily.difficulty, source: "daily")
    game.dailyDate = daily.date
    update(game)
    open(game)
  }

  func start(_ puzzle: LibraryPuzzle) {
    guard archiveWritable else { return }
    Task { await api.trackEngagement("puzzle_open", puzzleId: puzzle.id) }
    if let existing = games.first(where: { $0.libraryId == puzzle.id && !$0.isFinished }) {
      open(existing)
      return
    }
    var game = makeCase(
      id: UUID().uuidString, title: puzzle.title, surface: puzzle.surface,
      difficulty: puzzle.difficulty, source: "library")
    game.libraryId = puzzle.id
    update(game)
    open(game)
  }

  private func makeCase(
    id: String, title: String, surface: String, difficulty: String, source: String
  ) -> CaseFile {
    let greeting = "汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。"
    return CaseFile(
      id: id, title: title, surface: surface, difficulty: difficulty, source: source,
      hostGreeting: greeting, messages: [SoupMessage(role: "host", text: greeting)])
  }

  func ask(caseID: String, text: String, retry: Bool = false) async {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.utf16.count <= 600, !pending.contains(caseID),
      var game = games.first(where: { $0.id == caseID }), !game.isFinished
    else { return }
    let requestOwner = owner
    if retry, game.messages.last?.tone == "error", game.messages.dropLast().last?.role == "player" {
      game.messages.removeLast(2)
      game.turnCount = max(0, game.turnCount - 1)
    }
    let context = game
    game.messages.append(SoupMessage(role: "player", text: text))
    game.turnCount += 1
    update(game)
    pending.insert(caseID)
    defer { if owner == requestOwner { pending.remove(caseID) } }
    do {
      let turn = try await api.ask(game: context, message: text, playerKey: playerKey)
      guard owner == requestOwner else { return }
      game.messages.append(
        SoupMessage(
          role: "host", text: turn.reply, tone: turn.solved ? "celebrate" : "verdict",
          verdict: turn.verdict, replyLocale: turn.replyLocale, closeness: turn.closeness,
          debug: turn.debug, model: turn.model))
      if let score = turn.closeness { game.closeness = max(game.closeness ?? 0, score) }
      game.solved = turn.solved
      game.revealed = turn.revealed || turn.solved
      game.truth = turn.truth ?? game.truth
      game.status = turn.solved ? "solved" : turn.revealed ? "revealed" : "active"
      update(game)
      if context.turnCount == 0, let id = context.libraryId ?? (context.dailyDate != nil ? context.id : nil) {
        Task { await api.trackEngagement("first_question", puzzleId: id) }
      }
      if game.revealed && game.truth == nil && !game.isLocked {
        do {
          let result = try await api.reveal(game: game)
          guard owner == requestOwner else { return }
          game.truth = result.truth
          game.hint = result.hint
          update(game)
        } catch {
          // The report retains an explicit fetch-answer action.
        }
      }
    } catch {
      guard owner == requestOwner else { return }
      game.messages.append(
        SoupMessage(role: "host", text: error.localizedDescription, tone: "error"))
      update(game)
    }
  }

  func reveal(caseID: String) async throws {
    guard var game = games.first(where: { $0.id == caseID }), !pending.contains(caseID) else {
      return
    }
    guard !game.isLocked else { throw SoupAPIError(status: 403, message: "今日官汤要到 UTC 零点后才会揭晓") }
    let requestOwner = owner
    pending.insert(caseID)
    defer { if owner == requestOwner { pending.remove(caseID) } }
    let result = try await api.reveal(game: game, manual: !game.solved && !game.revealed)
    guard owner == requestOwner else { return }
    game.truth = result.truth
    game.hint = result.hint
    game.revealed = true
    game.status = game.solved ? "solved" : "revealed"
    update(game)
  }

  func abandon(caseID: String) {
    guard !pending.contains(caseID), var game = games.first(where: { $0.id == caseID }) else {
      return
    }
    game.status = "abandoned"
    update(game)
    activeCase = nil
  }

  private func update(_ value: CaseFile) {
    var value = value
    value.updatedAt = max(Date().timeIntervalSince1970 * 1000, value.updatedAt + 1)
    games = CaseFile.merge(games.filter { $0.id != value.id }, [value])
    dirtyIDs.insert(value.id)
    persist()
    syncTask?.cancel()
    syncTask = Task {
      do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
      await sync()
    }
  }

  func sync() async {
    guard let account = user, archiveWritable else { return }
    if syncing {
      syncRequested = true
      return
    }
    let scope = account.uid
    syncing = true
    defer {
      syncing = false
      if syncRequested {
        syncRequested = false
        Task { await sync() }
      }
    }
    do {
      let remote: ItemsReply<CaseFile> = try await api.request("/api/me/saves", owner: scope)
      guard owner == scope, !Task.isCancelled else { return }
      games = CaseFile.merge(games, remote.items)
      persist()
      for id in Array(dirtyIDs) {
        guard owner == scope, !Task.isCancelled else { return }
        guard let game = games.first(where: { $0.id == id }) else { continue }
        let _: OKReply = try await api.send(
          "/api/me/saves/\(id)", body: SaveBody(game: game), method: "PUT", owner: scope)
        guard owner == scope else { return }
        if games.first(where: { $0.id == id })?.updatedAt == game.updatedAt { dirtyIDs.remove(id) }
        persist()
      }
      if owner == scope { syncMessage = dirtyIDs.isEmpty ? "已与云端同步" : "本机进度等待同步" }
    } catch {
      if owner == scope, !Task.isCancelled { syncMessage = "进度已保存在本机，同步失败时可稍后重试" }
    }
  }

  private func loadArchive() {
    games = []
    dirtyIDs = []
    archiveWritable = true
    syncMessage = nil
    do {
      let saved = try archive.load(owner: owner)
      games = saved.games.sorted { $0.updatedAt > $1.updatedAt }
      dirtyIDs = saved.dirtyIDs
    } catch {
      archiveWritable = false
      syncMessage = "本机案卷读取失败，原文件已保留。请暂时不要开始新调查。"
    }
  }

  private func persist() {
    guard archiveWritable else { return }
    do {
      try archive.save(CaseEnvelope(games: games, dirtyIDs: dirtyIDs), owner: owner)
    } catch { syncMessage = "本机存储失败：\(error.localizedDescription)" }
  }
}
