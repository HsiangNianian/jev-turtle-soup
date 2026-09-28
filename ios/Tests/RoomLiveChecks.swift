import Foundation

struct LiveFixture: Decodable {
  let cookies: [String: String]
  let puzzleId: String
}
@main struct RoomLiveChecks {
  @MainActor static func until(_ label: String, _ condition: () -> Bool) async throws {
    let end = Date().addingTimeInterval(20)
    while !condition() {
      if Date() > end { throw NSError(domain: label, code: 1) }
      try await Task.sleep(for: .milliseconds(50))
    }
    print("PASS \(label)")
  }
  @MainActor static func main() async throws {
    let fixture = try JSONDecoder().decode(
      LiveFixture.self, from: Data(contentsOf: URL(fileURLWithPath: ".build/rooms/preview.json")))
    func api(_ uid: String) -> SoupAPI {
      let config = URLSessionConfiguration.ephemeral
      config.httpAdditionalHeaders = ["Cookie": "ts_session=\(fixture.cookies[uid]!)"]
      return SoupAPI(session: URLSession(configuration: config))
    }
    let a = api("alice")
    let b = api("bob")
    let room: TableSnapshot = try await a.send(
      "/api/rooms",
      body: TableCreate(puzzleId: fixture.puzzleId, requestId: UUID().uuidString.lowercased()))
    let _: TableSnapshot = try await b.send(
      "/api/rooms/join", body: TableJoin(code: room.inviteCode!))
    let host = TableStore(owner: "alice", roomID: room.roomId, api: a)
    let guest = TableStore(owner: "bob", roomID: room.roomId, api: b)
    defer {
      host.stop()
      guest.stop()
    }
    host.start()
    guest.start()
    try await until("Both URLSession sockets authenticate") {
      host.online && guest.online
        && host.snapshot?.seats.filter { $0.disconnectedAt == nil }.count == 2
    }
    host.send(TableCommand(type: "start"))
    try await until("Native clients share authoritative phase") {
      host.snapshot?.phase == "playing" && guest.snapshot?.phase == "playing"
    }
    host.send(TableCommand(type: "ask", text: "Was someone leaving the elevator?", locale: "en"))
    guest.send(TableCommand(type: "discuss", text: "A native-only discussion"))
    try await until("A native question and discussion reach both clients") {
      host.snapshot?.turns == 1 && guest.snapshot?.turns == 1
        && host.events.contains { $0.text == "A native-only discussion" }
    }
    host.resume()
    try await until("Reconnect restores transcript without duplicates") {
      host.online && host.events.filter { $0.type == "answer" }.count == 1 && host.pendingCount == 0
    }
    guest.send(TableCommand(type: "leave"))
    try await until("Leaving closes the native socket and keeps the shared archive") {
      guest.archived && !guest.online && guest.pendingCount == 0 && !guest.events.isEmpty
    }
    guest.resume()
    host.send(TableCommand(type: "discuss", text: "Only fetch this on refresh"))
    try await until("Remaining member can continue the discussion") {
      host.events.contains { $0.text == "Only fetch this on refresh" }
    }
    try await Task.sleep(for: .milliseconds(250))
    guard guest.archived, !guest.online,
      !guest.events.contains(where: { $0.text == "Only fetch this on refresh" })
    else { throw NSError(domain: "Archive should not reconnect", code: 1) }
    guest.refresh()
    try await until("Manual archive refresh fetches new records over HTTP") {
      guest.archived && guest.events.contains { $0.text == "Only fetch this on refresh" }
    }
    let _: TableSnapshot = try await b.send("/api/rooms/join", body: TableJoin(code: room.inviteCode!))
    guest.refresh()
    try await until("Explicit rejoin restores a live native seat") { guest.online && !guest.archived }
    host.send(TableCommand(type: "reveal"))
    try await until("Native reveal waits for all seats") {
      guest.snapshot?.vote != nil && host.snapshot?.report == nil
    }
    guest.send(TableCommand(type: "vote", voteId: guest.snapshot!.vote!.id, agree: true))
    try await until("Both native clients receive the shared report") {
      host.snapshot?.report?.truth != nil && guest.snapshot?.phase == "revealed"
        && host.archived && guest.archived && !host.online && !guest.online
    }
    let archive = TableStore(owner: "alice", roomID: room.roomId, api: a)
    archive.start()
    defer { archive.stop() }
    try await until("Reopening a completed native archive does not open a socket") {
      archive.archived && !archive.online && archive.snapshot?.report?.truth != nil
    }
    let feedback: TableFeedbackReply = try await a.send(
      "/api/rooms/\(room.roomId)/report", body: TableFeedback(note: "Isolated native QA"))
    guard !feedback.id.isEmpty else { throw NSError(domain: "feedback", code: 1) }
    print("PASS Native feedback acknowledged")
  }
}
