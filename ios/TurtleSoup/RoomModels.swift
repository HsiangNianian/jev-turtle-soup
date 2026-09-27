import Foundation

struct TablePuzzle: Codable {
  let id, title, surface, difficulty: String
  let dailyDate: String?
}
struct TableMember: Codable, Identifiable {
  let uid, name, handle, seat: String
  let joinedAt: Double
  let disconnectedAt: Double?
  let questions: Int
  let cutoffSeq: Int?
  var id: String { uid }
}
struct TableReference: Codable { let id, uid, text: String }
struct TableQuestion: Codable, Identifiable {
  let id, uid, text, locale: String
  let at: Double
  let reference: TableReference?
  let error: String?
}
struct TableVote: Codable, Identifiable {
  let id, requestedBy: String
  let members, agreed: [String]
  let expiresAt: Double
}
struct TableReport: Codable {
  let outcome: String
  let turns: Int
  let finishedAt: Double
  let authorParticipated: Bool
  let truth, hint, story: String?
}
struct TableSnapshot: Codable {
  let `protocol`, revision: Int
  let roomId, meId, phase, hostId: String
  let puzzle: TablePuzzle
  let createdAt, updatedAt: Double
  let eventSeq, turns: Int
  let members: [TableMember]
  let queue, failed: [TableQuestion]
  let processing: TableQuestion?
  let vote: TableVote?
  let revealPending, invitationsOpen, readOnly: Bool
  let inviteCode: String?
  let report: TableReport?
  var seats: [TableMember] { members.filter { $0.seat == "seated" } }
  var phaseLabel: String { tablePhaseLabel(phase) }
  var invitation: URL? {
    inviteCode.flatMap { URL(string: "https://hgt.mmstudio.games/rooms/join?code=\($0)") }
  }
  var dailyLocked: Bool { puzzle.dailyDate == DailyPuzzle.utcToday }
}
struct TableTurn: Codable {
  let intent, verdict, reply: String
  let solved, revealed: Bool
  let closeness: Double?
  let replyLocale: String?
}
struct TableEvent: Codable, Identifiable {
  let seq: Int
  let id: String
  let at: Double
  let type, text: String
  let actorId, questionId, referenceId: String?
  let turn: TableTurn?
}
struct TablePage: Decodable {
  let snapshot: TableSnapshot
  let events: [TableEvent]
  let hasMore: Bool
}
struct TableEnvelope: Decodable {
  let type: String
  let snapshot: TableSnapshot?
  let events: [TableEvent]?
  let hasMore: Bool?
  let commandId: String?
  let eventSeq, status: Int?
  let error, terminal: String?
}
struct TableSummary: Decodable, Identifiable {
  let roomId, title, phase: String
  let turns: Int
  let updatedAt: Double
  var id: String { roomId }
}
struct TableTicket: Decodable {
  let ticket: String
  let expiresAt: Double
}
struct TableConfiguration: Decodable { let enabled: Bool }
struct TableRoute: Identifiable { let id: String }
struct TableCreate: Encodable { let puzzleId, requestId: String }
struct TableJoin: Encodable { let code: String }
struct TableFeedbackReply: Decodable { let id: String }
struct TableFeedback: Encodable { let note: String }
struct TableCommand: Codable {
  var commandId = UUID().uuidString.lowercased()
  var type: String
  var text: String? = nil
  var locale: String? = nil
  var referenceId: String? = nil
  var questionId: String? = nil
  var voteId: String? = nil
  var agree: Bool? = nil
  var uid: String? = nil
  var open: Bool? = nil
}
struct TablePending: Codable {
  let at: Double
  let command: TableCommand
}
func tablePhaseLabel(_ phase: String) -> String {
  ["waiting": "等待入座", "playing": "推理中", "solved": "共同解开", "revealed": "共同揭晓", "abandoned": "已中止"][
    phase] ?? phase
}

/// Only a code or our canonical invitation URL is accepted; pasted URLs are never fetched.
func tableInvitationCode(_ input: String) -> String? {
  var code = input.trimmingCharacters(in: .whitespacesAndNewlines)
  if code.lowercased().hasPrefix("http") {
    guard let url = URLComponents(string: code), url.scheme == "https",
      url.host == "hgt.mmstudio.games",
      url.port == nil, url.user == nil, url.password == nil, url.path == "/rooms/join"
    else { return nil }
    code = url.queryItems?.first(where: { $0.name == "code" })?.value ?? ""
  }
  code = code.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "-", with: "")
    .uppercased()
  return code.range(of: "^[A-HJ-NP-Z2-9]{12}$", options: .regularExpression) != nil ? code : nil
}
