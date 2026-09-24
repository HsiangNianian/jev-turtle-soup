import Foundation

private enum CheckFailure: Error { case failed(String) }
private func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
  if try !condition() { throw CheckFailure.failed(message) }
  print("PASS \(message)")
}

private final class StubProtocol: URLProtocol {
  static var response: (URLRequest) throws -> (Int, String) = { _ in (200, "{}") }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let (status, body) = try Self.response(request)
      let reply = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: reply, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data(body.utf8))
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}

@main
struct NativeContractChecks {
  @MainActor static func main() async throws {
    let decoder = JSONDecoder()
    let english =
      #"{"date":"2026-09-23","title":"Signed Rose","difficulty":"中等","tags":[],"locale":"en","genreScore":10,"plays":5,"solves":1}"#
    let daily = try decoder.decode(DailyPuzzle.self, from: Data(english.utf8))
    try check(daily.language == "英文", "English daily metadata survives decoding")
    try check(daily.puzzleId == nil, "History summaries do not require detail-only fields")
    try check(genreText(daily.genreScore) == "本格度 90", "Genre scale agrees with the web client")
    let future = english.replacingOccurrences(of: "2026-09-23", with: "2999-01-01")
    try check(
      try decoder.decode(DailyPuzzle.self, from: Data(future.utf8)).isLocked,
      "Future and current dailies cannot reveal early")

    var game = CaseFile(
      id: "case-1", title: "测试案卷", surface: "汤面", difficulty: "中等", source: "library",
      hostGreeting: "请提问", messages: [SoupMessage(role: "host", text: "请提问")])
    game.libraryId = "puzzle-1"
    game.turnCount = 3
    game.messages.append(SoupMessage(role: "host", text: "网络失败", tone: "error"))
    let payload = AskPayload(game: game, message: "她认识他吗？", playerKey: "native-device")
    try check(
      payload.seq == 4 && payload.history.count == 1,
      "Retry errors stay out of judge history and next sequence is correct")
    try check(
      !payload.history.contains { $0.text == payload.message },
      "New question is not duplicated in prior history")
    let bytes = try JSONEncoder().encode(game)
    let roundTrip = try decoder.decode(CaseFile.self, from: bytes)
    try check(
      roundTrip.libraryId == "puzzle-1" && roundTrip.messages.count == 2,
      "Cloud-compatible archives retain original puzzle routing")
    var newer = game
    newer.updatedAt = game.updatedAt + 1
    newer.title = "新进度"
    try check(
      CaseFile.merge([newer], [game])[0].title == "新进度",
      "Late cloud replies cannot overwrite newer local progress")
    try check(CaseFile.merge([game], [newer])[0].title == "新进度", "Newer cloud progress is restored")

    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "turtle-native-checks-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: directory) }
    let archive = CaseArchive(directory: directory)
    try archive.save(CaseEnvelope(games: [game], dirtyIDs: [game.id]), owner: "account-a")
    try check(
      try archive.load(owner: "account-b").games.isEmpty,
      "Different accounts never share local archives")
    try check(
      try archive.load(owner: "guest").games.isEmpty,
      "Guest records are isolated from signed-in accounts")
    try check(
      try archive.load(owner: "account-a").dirtyIDs == [game.id],
      "Pending cloud writes survive app restarts")
    let brokenURL = try archive.fileURL(owner: "broken")
    try Data("broken archive".utf8).write(to: brokenURL)
    do {
      _ = try archive.load(owner: "broken")
      throw CheckFailure.failed("corrupt archive accepted")
    } catch is DecodingError {}
    try check(
      try String(contentsOf: brokenURL, encoding: .utf8) == "broken archive",
      "Unreadable archives are preserved for recovery")

    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    let api = SoupAPI(session: URLSession(configuration: config))
    StubProtocol.response = { request in
      try check(request.url?.path == "/api/me/saves", "Native requests use the existing API path")
      try check(
        request.value(forHTTPHeaderField: "X-Save-Owner") == "account-a",
        "Cloud requests carry the account-isolation header")
      return (200, "{\"items\":[]}")
    }
    let _: ItemsReply<CaseFile> = try await api.request("/api/me/saves", owner: "account-a")
    StubProtocol.response = { _ in (403, "{\"error\":\"今日官汤尚未解锁\"}") }
    do {
      let _: RevealReply = try await api.reveal(game: game)
      throw CheckFailure.failed("server lock ignored")
    } catch let error as SoupAPIError {
      try check(
        error.status == 403 && error.message == "今日官汤尚未解锁",
        "Server lock and error text are preserved")
    }
    do {
      let _: OKReply = try await api.request("https://example.com/api")
      throw CheckFailure.failed("cross-origin request allowed")
    } catch let error as SoupAPIError {
      try check(error.status == 0, "API client rejects cross-origin credential requests")
    }
    let suite = "native-contracts-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = SoupStore(api: api, archive: archive, defaults: defaults)
    StubProtocol.response = { _ in (200, "{\"today\":\(english),\"history\":[]}") }
    await store.refreshHome()
    try check(store.daily?.today?.title == "Signed Rose", "Daily refresh keeps usable content")
    StubProtocol.response = { _ in throw URLError(.cancelled) }
    await store.refreshHome()
    try check(
      store.homeError == nil && store.daily?.today?.title == "Signed Rose",
      "Cancelled URLSession refreshes never display a cancellation error or remove content")
    StubProtocol.response = { _ in throw URLError(.notConnectedToInternet) }
    await store.refreshHome()
    try check(
      store.homeError != nil && store.daily?.today != nil,
      "Real offline errors keep the current daily visible")
    try check(
      isRequestCancellation(CancellationError()) && isRequestCancellation(URLError(.cancelled)),
      "Both Swift and URLSession cancellation are recognized")
    try check(!isRequestCancellation(URLError(.timedOut)), "Timeouts remain retryable failures")

    let socialJSON =
      #"{"likes":2,"liked":false,"comments":[{"id":"c1","body":"一个细节","createdAt":1790137773593,"author":{"handle":"lin","displayName":"林间"},"mine":false,"canDelete":true}],"canModerate":true,"signedIn":true}"#
    StubProtocol.response = { request in
      let url = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
      try check(
        url.percentEncodedPath == "/api/social/profile/a%2Fb%3Fx",
        "Social target IDs are encoded as one path segment")
      try check(
        url.queryItems?.first?.value == "device&key",
        "Anonymous interaction identity is safely encoded")
      return (200, socialJSON)
    }
    let social = try await api.social(
      SocialTarget(kind: .profile, id: "a/b?x"), playerKey: "device&key")
    try check(
      social.comments[0].canDelete && !social.comments[0].mine,
      "Moderation follows server permission, not inferred authorship")
    let target = SocialTarget(kind: .puzzle, id: "p1")
    let community = CommunityStore(api: api, playerKey: "test-device")
    community.activate("account-a")
    StubProtocol.response = { _ in (200, socialJSON) }
    await community.load(target)
    StubProtocol.response = { request in
      try check(request.httpMethod == "POST", "A new like uses the existing POST endpoint")
      return (200, #"{"likes":3,"liked":true}"#)
    }
    await community.toggleLike(target)
    try check(
      community.snapshots[target]?.liked == true,
      "Like state is updated from the server acknowledgement")
    StubProtocol.response = { request in
      try check(request.httpMethod == "DELETE", "Removing a like uses DELETE")
      return (200, #"{"likes":2,"liked":false}"#)
    }
    await community.toggleLike(target)
    community.activate("account-b")
    try check(
      community.snapshots.isEmpty, "Switching accounts clears interaction permissions and likes")
    StubProtocol.response = { _ in
      Thread.sleep(forTimeInterval: 0.12)
      return (200, socialJSON)
    }
    let lateLoad = Task { await community.load(target) }
    try await Task.sleep(for: .milliseconds(30))
    community.activate("account-c")
    await lateLoad.value
    try check(
      community.snapshots.isEmpty,
      "A late social response cannot leak the previous account's permissions")

    var draft = SoupDraft()
    draft.title = String(repeating: "😀", count: 21)
    draft.surface = "一段汤面"
    draft.truth = "完整汤底"
    try check(draft.validationError != nil, "Publish limits match the server's UTF-16 count")
    draft.title = "新汤"
    draft.tagsText = "悬念， 日常,悬念"
    try check(
      draft.validationError == nil && draft.tags == ["悬念", "日常"],
      "Tags are trimmed and deduplicated before publishing")
    draft.save(owner: "account-a", defaults: defaults)
    try check(
      SoupDraft.load(owner: "account-a", defaults: defaults) == draft,
      "Closing the composer preserves the draft")
    try check(
      SoupDraft.load(owner: "account-b", defaults: defaults).title.isEmpty,
      "Drafts do not leak across accounts")
    let publishedBody =
      try JSONSerialization.jsonObject(with: JSONEncoder().encode(PublishSoupBody(draft: draft)))
      as! [String: Any]
    try check(
      publishedBody["visibility"] as? String == "public"
        && publishedBody["truth"] as? String == draft.truth,
      "Publishing carries visibility and truth in the existing API contract")
    StubProtocol.response = { request in
      try check(
        request.httpMethod == "POST" && request.url?.path == "/api/library/puzzles",
        "Native composer uses the existing publish endpoint")
      return (200, #"{"id":"new-puzzle","review":[{"kind":"unexplained","detail":"补充一个细节"}]}"#)
    }
    let published = try await api.publish(draft)
    try check(
      published.id == "new-puzzle" && published.review?.count == 1,
      "Advisory review is decoded alongside an already-published puzzle")
    let privateProfile =
      #"{"profile":{"handle":"private","displayName":"汤友","bio":"","profilePublic":false,"createdAt":1,"puzzles":[],"recognition":null}}"#
    let profile = try decoder.decode(ProfileReply.self, from: Data(privateProfile.utf8)).profile
    try check(
      !profile.profilePublic && profile.recognition == nil && profile.puzzles.isEmpty,
      "Private profiles retain their privacy signal without fabricated statistics")
    print("All native contract checks passed")
  }
}
