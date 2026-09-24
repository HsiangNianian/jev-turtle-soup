import Foundation

enum NativeIdentity {
  static let playerKey: String = {
    let defaults = UserDefaults.standard
    let key = defaults.string(forKey: "native.playerKey") ?? UUID().uuidString
    defaults.set(key, forKey: "native.playerKey")
    return key
  }()
}

struct SocialTarget: Hashable {
  enum Kind: String { case puzzle, profile }
  let kind: Kind
  let id: String

  var path: String { "/api/social/\(kind.rawValue)/\(apiSegment(id))" }
  func path(playerKey: String, action: String = "") -> String {
    var url = URLComponents()
    url.percentEncodedPath = path + action
    url.queryItems = [URLQueryItem(name: "playerKey", value: playerKey)]
    return url.string!
  }
}

func apiSegment(_ value: String) -> String {
  value.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
}

struct SocialComment: Decodable, Identifiable {
  let id: String
  let body: String
  let createdAt: Double
  let author: PuzzleAuthor
  let mine: Bool
  let canDelete: Bool
}

struct SocialSnapshot: Decodable {
  var likes: Int
  var liked: Bool
  var comments: [SocialComment]
  let canModerate: Bool
  let signedIn: Bool
}
struct LikeReply: Decodable {
  let likes: Int
  let liked: Bool
}
struct CommentReply: Decodable { let comment: SocialComment }
struct ReportReply: Decodable { let id: String }

struct AuthorRecognition: Decodable {
  let puzzles: Int
  let plays: Int
  let solves: Int
  let likes: Int
  let comments: Int
  let badges: [String]
}

struct PublicAuthor: Decodable {
  let handle: String
  let displayName: String
  let bio: String
  let profilePublic: Bool
  let createdAt: Double
  let puzzles: [LibraryPuzzle]
  let recognition: AuthorRecognition?
}
struct ProfileReply: Decodable { let profile: PublicAuthor }

struct AuthorActivity: Decodable {
  let kind: String
  let target: String
  let at: Double
  let puzzleId: String?
  let puzzleTitle: String
  let body: String
  let actor: String

  var description: String {
    switch kind {
    case "comment": return "\(actor.isEmpty ? "一位汤友" : actor) 留了言"
    case "like": return target == "profile" ? "一位汤友赞了你的主页" : "一位汤友赞了这碗汤"
    case "solve": return "一位汤友解开了这碗汤"
    default: return "一位汤友开始了推理"
    }
  }
  var symbol: String {
    switch kind {
    case "comment": return "text.bubble"
    case "like": return "heart"
    case "solve": return "checkmark.seal"
    default: return "magnifyingglass"
    }
  }
}
struct NotificationsReply: Decodable { let unread: Int }

struct OwnPuzzle: Decodable, Identifiable {
  let id: String
  let title: String
  let surface: String
  let truth: String
  let hint: String
  let difficulty: String
  let tags: [String]
  let visibility: String
  let plays: Int
  let solves: Int
  let reveals: Int
  let createdAt: Double

  func publicView(author: PuzzleAuthor) -> LibraryPuzzle {
    LibraryPuzzle(
      id: id, title: title, surface: surface, difficulty: difficulty, tags: tags,
      plays: plays, solves: solves, owner: author, genreScore: nil, official: false,
      featured: false, featuredNote: nil, ownerBio: nil, createdAt: createdAt)
  }
}

struct SoupDraft: Codable, Equatable {
  var title = ""
  var surface = ""
  var truth = ""
  var hint = ""
  var difficulty = "中等"
  var tagsText = ""
  var visibility = "public"

  var tags: [String] {
    var seen = Set<String>()
    return tagsText.components(separatedBy: CharacterSet(charactersIn: ",，、\n"))
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && seen.insert($0).inserted }
  }
  var validationError: String? {
    for (name, text, limit) in [("标题", title, 40), ("汤面", surface, 200), ("汤底", truth, 2000)] {
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "请写下\(name)" }
      if text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > limit {
        return "\(name)最多 \(limit) 字"
      }
    }
    if hint.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 200 {
      return "提示最多 200 字"
    }
    if tags.count > 5 || tags.contains(where: { $0.utf16.count > 12 }) {
      return "最多 5 个标签，每个不超过 12 字"
    }
    return nil
  }

  func save(owner: String, defaults: UserDefaults = .standard) {
    if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key(owner)) }
  }
  static func load(owner: String, defaults: UserDefaults = .standard) -> SoupDraft {
    guard let data = defaults.data(forKey: key(owner)),
      let draft = try? JSONDecoder().decode(Self.self, from: data)
    else { return SoupDraft() }
    return draft
  }
  static func remove(owner: String, defaults: UserDefaults = .standard) {
    defaults.removeObject(forKey: key(owner))
  }
  private static func key(_ owner: String) -> String { "native.soupDraft.\(owner)" }
}

struct PublishSoupBody: Encodable {
  let title: String
  let surface: String
  let truth: String
  let hint: String
  let difficulty: String
  let tags: [String]
  let visibility: String
  let locale = "zh-CN"

  init(draft: SoupDraft) {
    title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
    surface = draft.surface.trimmingCharacters(in: .whitespacesAndNewlines)
    truth = draft.truth.trimmingCharacters(in: .whitespacesAndNewlines)
    hint = draft.hint.trimmingCharacters(in: .whitespacesAndNewlines)
    difficulty = draft.difficulty
    tags = draft.tags
    visibility = draft.visibility
  }
}
struct PublishSoupReply: Decodable {
  struct Review: Decodable {
    let kind: String
    let detail: String
  }
  let id: String
  let review: [Review]?
}

extension SoupAPI {
  func social(_ target: SocialTarget, playerKey: String) async throws -> SocialSnapshot {
    try await request(target.path(playerKey: playerKey))
  }
  func setLike(_ liked: Bool, target: SocialTarget, playerKey: String) async throws -> LikeReply {
    try await request(
      target.path(playerKey: playerKey, action: "/like"), method: liked ? "POST" : "DELETE")
  }
  func comment(_ body: String, target: SocialTarget) async throws -> SocialComment {
    let reply: CommentReply = try await send(target.path + "/comments", body: ["body": body])
    return reply.comment
  }
  func publish(_ draft: SoupDraft) async throws -> PublishSoupReply {
    if let message = draft.validationError { throw SoupAPIError(status: 0, message: message) }
    return try await send("/api/library/puzzles", body: PublishSoupBody(draft: draft))
  }
}

func communityDate(_ timestamp: Double?) -> String {
  guard let timestamp else { return "" }
  let date = Date(timeIntervalSince1970: timestamp / 1000)
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "zh_CN")
  formatter.dateFormat = Calendar.current.isDateInToday(date) ? "今天 HH:mm" : "M月d日"
  return formatter.string(from: date)
}
