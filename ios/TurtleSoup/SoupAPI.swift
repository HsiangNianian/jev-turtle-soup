import Foundation

// SwiftUI cancels view tasks on navigation and refresh gestures. That is not a
// service failure; URLSession may report it as URLError rather than CancellationError.
func isRequestCancellation(_ error: Error) -> Bool {
  error is CancellationError || (error as? URLError)?.code == .cancelled || Task.isCancelled
}

struct SoupAPIError: LocalizedError {
  let status: Int
  let message: String
  var errorDescription: String? { message }
}

struct ItemsReply<Item: Decodable>: Decodable { let items: [Item] }
struct UserReply: Decodable { let user: SoupUser? }
struct DailyReply: Decodable { let daily: DailyPuzzle }
struct OKReply: Decodable { let ok: Bool }
struct SaveBody: Encodable { let game: CaseFile }
private struct RevealBody: Encodable {
  let puzzleId: String
  let locale = "zh-CN"
  let manual: Bool
  let playerKey: String
}
private struct EngagementBody: Encodable {
  let event: String
  let actorKey: String
  let puzzleId: String
  let platform = "ios"
  let source: String
  let `internal`: Bool
}
private struct APIFailure: Decodable { let error: String? }

final class SoupAPI {
  static let shared = SoupAPI()
  private let baseURL = URL(string: "https://hgt.mmstudio.games")!
  private let session: URLSession

  init(session: URLSession? = nil) {
    let config = URLSessionConfiguration.default
    config.httpCookieStorage = .shared
    config.httpShouldSetCookies = true
    config.timeoutIntervalForRequest = 120
    config.timeoutIntervalForResource = 150
    config.httpAdditionalHeaders = [
      "Accept": "application/json", "User-Agent": "TurtleSoup-iOS/0.4.2",
    ]
    #if DEBUG && targetEnvironment(simulator)
      if ProcessInfo.processInfo.environment["NATIVE_UI_FIXTURE"] == "community" {
        config.protocolClasses = [CommunityPreviewProtocol.self]
        SoupDraft.remove(owner: "native-fixture-user")
      }
    #endif
    self.session = session ?? URLSession(configuration: config)
  }

  func request<Result: Decodable>(
    _ path: String, method: String = "GET", body: Data? = nil, owner: String? = nil
  ) async throws -> Result {
    guard let url = URL(string: path, relativeTo: baseURL), url.host == baseURL.host,
      url.scheme == "https"
    else { throw SoupAPIError(status: 0, message: "请求地址无效") }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.httpMethod = method
    request.httpBody = body
    if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    if let owner { request.setValue(owner, forHTTPHeaderField: "X-Save-Owner") }
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    guard (200..<300).contains(response.statusCode) else {
      let failure = try? JSONDecoder().decode(APIFailure.self, from: data)
      throw SoupAPIError(
        status: response.statusCode, message: failure?.error ?? "暂时无法连接调查局（\(response.statusCode)）")
    }
    return try JSONDecoder().decode(Result.self, from: data)
  }

  func send<Result: Decodable, Body: Encodable>(
    _ path: String, body: Body, method: String = "POST", owner: String? = nil
  ) async throws -> Result {
    try await request(path, method: method, body: JSONEncoder().encode(body), owner: owner)
  }

  func library(sort: String, query: String = "", offset: Int = 0) async throws -> [LibraryPuzzle] {
    var url = URLComponents()
    url.path = "/api/library/puzzles"
    url.queryItems = [
      URLQueryItem(name: "sort", value: sort), URLQueryItem(name: "q", value: query),
      URLQueryItem(name: "limit", value: "30"), URLQueryItem(name: "offset", value: String(offset)),
    ]
    let result: ItemsReply<LibraryPuzzle> = try await request(url.string!)
    return result.items
  }

  func curated() async throws -> [LibraryPuzzle] {
    let result: ItemsReply<LibraryPuzzle> = try await request(
      "/api/library/puzzles?scope=community&featuredOnly=1&limit=3")
    return result.items
  }

  func trackEngagement(_ event: String, puzzleId: String = "") async {
    let internalQA = ProcessInfo.processInfo.arguments.contains("--internal-qa")
      || ProcessInfo.processInfo.environment["NATIVE_UI_FIXTURE"] != nil
    let body = EngagementBody(
      event: event, actorKey: NativeIdentity.playerKey, puzzleId: puzzleId,
      source: event == "entry_view" ? "app" : "internal", internal: internalQA)
    let _: OKReply? = try? await send("/api/engagement", body: body)
  }

  func ask(game: CaseFile, message: String, playerKey: String) async throws -> HostReply {
    let path = game.libraryId.map { "/api/library/puzzles/\($0)/ask" } ?? "/api/game/ask"
    return try await send(
      path, body: AskPayload(game: game, message: message, playerKey: playerKey))
  }

  func reveal(game: CaseFile, manual: Bool = false) async throws -> RevealReply {
    let path = game.libraryId.map { "/api/library/puzzles/\($0)/reveal" } ?? "/api/game/reveal"
    return try await send(
      path, body: RevealBody(puzzleId: game.id, manual: manual, playerKey: NativeIdentity.playerKey))
  }
}
