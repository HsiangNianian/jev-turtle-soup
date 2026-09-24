#if DEBUG && targetEnvironment(simulator)
  import Foundation

  // An opt-in, closed-network server for UI tests. Never compiled into a device
  // build. Unknown routes fail locally instead of falling through to production.
  final class CommunityPreviewProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var liked = false
    private static var comments: [[String: Any]] = []
    private static var works: [[String: Any]] = []
    private static var signedIn = true
    private static var unread = 1
    private static let author: [String: Any] = ["handle": "native-fixture", "displayName": "林间"]
    private static let user: [String: Any] = [
      "uid": "native-fixture-user", "email": "native@example.test", "name": "林间",
      "handle": "native-fixture",
    ]
    private static let puzzle: [String: Any] = [
      "id": "fixture-puzzle", "title": "窗边的第四封信", "surface": "她每天都收到一封没有署名的信。第四天，她读完信，把一直开着的窗关上了。",
      "difficulty": "中等", "tags": ["日常", "悬念"], "plays": 12, "solves": 3,
      "owner": author, "genreScore": 10, "official": false, "featured": true,
      "featuredNote": "第四封信，让一扇窗有了答案。",
      "createdAt": Date().timeIntervalSince1970 * 1000 - 3_600_000,
    ]
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
      Self.lock.lock()
      let (status, value) = Self.response(request)
      Self.lock.unlock()
      let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"])!
      let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    private static func response(_ request: URLRequest) -> (Int, [String: Any]) {
      let path = request.url!.path
      let method = request.httpMethod ?? "GET"
      let ok: [String: Any] = ["ok": true]
      if path == "/api/engagement" { return (202, ok) }
      if path == "/api/auth/me" { return (200, ["user": signedIn ? user : NSNull()]) }
      if path == "/api/auth/logout" {
        signedIn = false
        return (200, ok)
      }
      if path == "/api/auth/request" { return (200, ok) }
      if path == "/api/auth/verify" {
        signedIn = true
        return (200, ["user": user])
      }
      if path == "/api/me/saves" { return (200, method == "GET" ? ["items": []] : ok) }
      if path == "/api/me/notifications" { return (200, ["unread": unread]) }
      if path == "/api/me/notifications/seen" {
        unread = 0
        return (200, ok)
      }
      if path == "/api/me/activity" {
        return (
          200,
          [
            "items": [
              [
                "kind": "comment", "target": "puzzle", "at": Date().timeIntervalSince1970 * 1000,
                "puzzleId": "fixture-puzzle", "puzzleTitle": "窗边的第四封信", "body": "我一直在想，为什么偏偏是第四天？",
                "actor": "小满",
              ]
            ]
          ]
        )
      }
      if path == "/api/me/puzzles" { return (200, ["items": works]) }
      if path == "/api/daily" {
        return (
          200,
          [
            "today": [
              "date": DailyPuzzle.utcToday, "title": "八点半的电梯", "difficulty": "中等", "tags": [],
              "locale": "zh-CN", "plays": 5, "solves": 0,
              "puzzleId": "fixture-daily", "surface": "每天八点半出门，电梯总空停在十六层。", "locked": true,
            ], "history": [],
          ]
        )
      }
      if path == "/api/u/native-fixture" {
        return (
          200,
          [
            "profile": [
              "handle": "native-fixture", "displayName": "林间", "bio": "把日常里的一点古怪，慢慢熬成故事。",
              "profilePublic": true,
              "createdAt": 1_780_000_000_000, "puzzles": [puzzle],
              "recognition": [
                "puzzles": 1, "plays": 12, "solves": 3, "likes": 2, "comments": 1, "badges": ["首汤"],
              ],
            ]
          ]
        )
      }
      if path == "/api/library/puzzles" && method == "GET" {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
          .queryItems?.first(where: { $0.name == "q" })?.value ?? ""
        let matches = query.isEmpty || "窗边的第四封信 林间 日常 悬念".localizedCaseInsensitiveContains(query)
        return (200, ["items": matches ? [puzzle] : []])
      }
      if path == "/api/library/puzzles/fixture-puzzle" { return (200, puzzle) }
      if path == "/api/library/puzzles" && method == "POST" {
        var work = body(request)
        work["id"] = "fixture-published"
        work["createdAt"] = Date().timeIntervalSince1970 * 1000
        work["plays"] = 0
        work["solves"] = 0
        works = [work]
        return (200, ["id": "fixture-published", "review": []])
      }
      if path.hasPrefix("/api/social/comments/") {
        if path.hasSuffix("/report") { return (200, ["id": "fixture-report"]) }
        if method == "DELETE" {
          comments = []
          return (200, ok)
        }
      }
      if path.hasPrefix("/api/social/") {
        if path.hasSuffix("/like") {
          liked = method == "POST"
          return (200, ["likes": liked ? 3 : 2, "liked": liked])
        }
        if path.hasSuffix("/comments") && method == "POST" {
          let comment: [String: Any] = [
            "id": "fixture-comment", "body": body(request)["body"] ?? "",
            "createdAt": Date().timeIntervalSince1970 * 1000,
            "author": author, "mine": true, "canDelete": true,
          ]
          comments = [comment]
          return (200, ["comment": comment])
        }
        return (
          200,
          [
            "likes": liked ? 3 : 2, "liked": liked, "comments": comments, "canModerate": signedIn,
            "signedIn": signedIn,
          ]
        )
      }
      return (500, ["error": "Unstubbed UI test route: \(method) \(path)"])
    }
    private static func body(_ request: URLRequest) -> [String: Any] {
      var data = request.httpBody ?? Data()
      if data.isEmpty, let stream = request.httpBodyStream {
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
          let count = stream.read(&buffer, maxLength: buffer.count)
          if count <= 0 { break }
          data.append(contentsOf: buffer.prefix(count))
        }
      }
      return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
  }
#endif
