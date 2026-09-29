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
enum TableVerdict: String {
  case yes, no, partly, irrelevant, solved
  init?(turn: TableTurn?) {
    if turn?.solved == true { self = .solved; return }
    guard let value = turn?.verdict, let verdict = Self(rawValue: value), verdict != .solved else { return nil }
    self = verdict
  }
  var glyph: String {
    switch self {
    case .yes: "是"
    case .no: "否"
    case .partly: "半"
    case .irrelevant: "—"
    case .solved: "中"
    }
  }
  var label: String {
    switch self {
    case .yes: "是"
    case .no: "不是"
    case .partly: "部分正确"
    case .irrelevant: "无关"
    case .solved: "已破案"
    }
  }
}
struct TableLedgerItem: Identifiable {
  let id, question: String
  let actorId: String?
  let verdict: TableVerdict
}
func tableLedger(_ events: [TableEvent]) -> [TableLedgerItem] {
  var questions: [String: TableEvent] = [:]
  var answers: [String: TableVerdict] = [:]
  for event in events.sorted(by: { $0.seq < $1.seq }) {
    guard let id = event.questionId else { continue }
    if event.type == "question" { questions[id] = event }
    if event.type == "answer", let verdict = TableVerdict(turn: event.turn) { answers[id] = verdict }
  }
  return questions.values.sorted { $0.seq < $1.seq }.compactMap { question in
    guard let id = question.questionId, let verdict = answers[id] else { return nil }
    return TableLedgerItem(id: id, question: question.text, actorId: question.actorId, verdict: verdict)
  }
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

struct TableTranscriptEntry: Identifiable {
  let event: TableEvent
  let answers: [TableEvent]
  var id: String { event.id }
}
func tableTranscript(_ events: [TableEvent]) -> [TableTranscriptEntry] {
  let ordered = events.sorted { $0.seq < $1.seq }
  let questions = Set(ordered.filter { $0.type == "question" }.compactMap { $0.questionId })
  let answers = Dictionary(grouping: ordered.filter { $0.type == "answer" && $0.questionId != nil }, by: { $0.questionId! })
  return ordered.compactMap { event in
    if event.type == "answer", let id = event.questionId, questions.contains(id) { return nil }
    return TableTranscriptEntry(event: event, answers: event.type == "question" ? answers[event.questionId ?? ""] ?? [] : [])
  }
}
