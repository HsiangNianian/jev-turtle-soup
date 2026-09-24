import Foundation

struct DailyIndex: Codable {
  let today: DailyPuzzle?
  let history: [DailyPuzzle]
}

struct DailyPuzzle: Codable, Identifiable {
  var id: String { date }
  let date: String
  let title: String
  let difficulty: String
  let tags: [String]
  let locale: String?
  let genreScore: Double?
  let plays: Int
  let solves: Int?
  let puzzleId: String?
  let surface: String?
  let locked: Bool?
  let truth: String?
  let story: String?
  let hint: String?
  let shortestSolveTurns: Int?
  let longestSolveTurns: Int?

  var language: String {
    switch locale {
    case "zh-CN": return "中文"
    case "en": return "英文"
    case "ja": return "日文"
    default: return "原文"
    }
  }

  // A detail loaded before midnight must not remain locked by its stale flag.
  // The server remains authoritative for every reveal request.
  var isLocked: Bool { date >= Self.utcToday }

  static var utcToday: String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
  }
}

struct PuzzleAuthor: Codable {
  let handle: String
  let displayName: String
}

struct LibraryPuzzle: Codable, Identifiable {
  let id: String
  let title: String
  let surface: String
  let difficulty: String
  let tags: [String]
  let plays: Int
  let solves: Int
  let owner: PuzzleAuthor
  let genreScore: Double?
  let official: Bool?
  let featured: Bool?
  let featuredNote: String?
  let ownerBio: String?
  var createdAt: Double? = nil
  var shortestSolveTurns: Int? = nil
  var longestSolveTurns: Int? = nil
}

struct SoupUser: Codable, Equatable {
  let uid: String
  let email: String
  let name: String?
  let handle: String?
  var displayName: String { name?.isEmpty == false ? name! : email.components(separatedBy: "@")[0] }
}

// Keep the web client's optional turn diagnostics when round-tripping cloud saves.
enum JSONValue: Codable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let box = try decoder.singleValueContainer()
    if box.decodeNil() {
      self = .null
    } else if let value = try? box.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? box.decode(Double.self) {
      self = .number(value)
    } else if let value = try? box.decode(String.self) {
      self = .string(value)
    } else if let value = try? box.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      self = .array(try box.decode([JSONValue].self))
    }
  }

  func encode(to encoder: Encoder) throws {
    var box = encoder.singleValueContainer()
    switch self {
    case .string(let value): try box.encode(value)
    case .number(let value): try box.encode(value)
    case .bool(let value): try box.encode(value)
    case .object(let value): try box.encode(value)
    case .array(let value): try box.encode(value)
    case .null: try box.encodeNil()
    }
  }
}

struct SoupMessage: Codable, Identifiable {
  var id = UUID().uuidString
  let role: String
  let text: String
  var tone: String? = nil
  var verdict: String? = nil
  var replyLocale: String? = nil
  var closeness: Double? = nil
  var debug: JSONValue? = nil
  var model: String? = nil

  var verdictLabel: String? {
    switch verdict {
    case "yes": return "是"
    case "no": return "不是"
    case "partly": return "部分正确"
    case "irrelevant": return "无关"
    default: return nil
    }
  }
}

struct CaseFile: Codable, Identifiable {
  var id: String
  var title: String
  var surface: String
  var difficulty: String
  var source: String
  var hostGreeting: String
  var hint: String = ""
  var libraryId: String? = nil
  var dailyDate: String? = nil
  var createdAt: Double = Date().timeIntervalSince1970 * 1000
  var updatedAt: Double = Date().timeIntervalSince1970 * 1000
  var messages: [SoupMessage]
  var revealed = false
  var truth: String? = nil
  var solved = false
  var closeness: Double? = nil
  var turnCount = 0
  var status = "active"

  var isLocked: Bool { dailyDate.map { $0 >= DailyPuzzle.utcToday } ?? false }
  var isFinished: Bool { status != "active" }
  var statusLabel: String {
    switch status {
    case "solved": return "已结案"
    case "revealed": return "已揭晓"
    case "abandoned": return "已中止"
    default: return "调查中"
    }
  }
  var shareURL: URL? {
    if let date = dailyDate { return URL(string: "https://hgt.mmstudio.games/daily/\(date)") }
    if let id = libraryId { return URL(string: "https://hgt.mmstudio.games/library/\(id)") }
    return nil
  }

  static func merge(_ local: [CaseFile], _ remote: [CaseFile]) -> [CaseFile] {
    var records = Dictionary(
      local.map { ($0.id, $0) },
      uniquingKeysWith: { a, b in
        a.updatedAt >= b.updatedAt ? a : b
      })
    for item in remote where item.updatedAt > (records[item.id]?.updatedAt ?? -.infinity) {
      records[item.id] = item
    }
    return records.values.sorted { $0.updatedAt > $1.updatedAt }
  }
}

struct HostReply: Decodable {
  let reply: String
  let verdict: String
  let solved: Bool
  let revealed: Bool
  let truth: String?
  let closeness: Double?
  let replyLocale: String?
  let model: String?
  let debug: JSONValue?
}

struct RevealReply: Decodable {
  let title: String
  let truth: String
  let hint: String
}

struct AskPayload: Encodable {
  struct Turn: Encodable {
    let role: String
    let text: String
  }
  let puzzleId: String
  let message: String
  let history: [Turn]
  let locale = "zh-CN"
  let playerKey: String
  let seq: Int

  init(game: CaseFile, message: String, playerKey: String) {
    puzzleId = game.id
    self.message = message
    history = game.messages.filter { $0.tone != "error" }.suffix(20).map {
      Turn(role: $0.role, text: $0.text)
    }
    self.playerKey = playerKey
    seq = game.turnCount + 1
  }
}

func genreText(_ score: Double?) -> String? {
  guard let score else { return nil }
  return score >= 50 ? "变格度 \(Int(score))" : "本格度 \(100 - Int(score))"
}
