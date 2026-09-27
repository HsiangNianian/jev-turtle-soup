import Combine
import CryptoKit
import Foundation

/// A separate archive/transport from solo saves; each instance is tied to one account and table.
@MainActor final class TableStore: ObservableObject {
  @Published private(set) var snapshot: TableSnapshot?
  @Published private(set) var events: [TableEvent] = []
  @Published private(set) var status = "正在连接"
  @Published private(set) var online = false
  @Published private(set) var requiresLogin = false
  @Published var error: String?
  @Published private(set) var hasEarlier = false
  @Published private(set) var pendingCount = 0
  @Published private(set) var rejected: TableCommand?
  let owner: String
  let roomID: String
  private let api: SoupAPI
  private var socket: URLSessionWebSocketTask?
  private var receiver: Task<Void, Never>?
  private var reconnect: Task<Void, Never>?
  private var heartbeat: Task<Void, Never>?
  private var request: Task<Void, Never>?
  private var pending: [TablePending] = []
  private var stopped = true
  private var terminal = false
  private var generation = 0
  private var cursor = 0
  private var attempts = 0
  private var lastMessageAt = Date().timeIntervalSince1970
  private let pendingURL: URL
  init(owner: String, roomID: String, api: SoupAPI = .shared) {
    self.owner = owner
    self.roomID = roomID
    self.api = api
    let key = SHA256.hash(data: Data("\(owner):\(roomID)".utf8)).map { String(format: "%02x", $0) }
      .joined()
    pendingURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("TablePending", isDirectory: true).appendingPathComponent(
        "\(key).json")
  }
  func start() {
    guard stopped else { return }
    stopped = false
    terminal = false
    if let data = try? Data(contentsOf: pendingURL),
      let loaded = try? JSONDecoder().decode([TablePending].self, from: data)
    {
      pending = Array(
        loaded.filter { Date().timeIntervalSince1970 * 1000 - $0.at < 600_000 }.suffix(12))
    }
    pendingCount = pending.count
    connect()
  }
  func stop() {
    stopped = true
    generation += 1
    online = false
    request?.cancel()
    receiver?.cancel()
    reconnect?.cancel()
    heartbeat?.cancel()
    socket?.cancel(with: .normalClosure, reason: nil)
    socket = nil
  }
  func resume() {
    guard !stopped, !terminal else { return }
    generation += 1
    request?.cancel()
    receiver?.cancel()
    heartbeat?.cancel()
    reconnect?.cancel()
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    online = false
    connect()
  }
  private func persist() throws {
    try FileManager.default.createDirectory(
      at: pendingURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(pending).write(to: pendingURL, options: .atomic)
    pendingCount = pending.count
  }
  private func accept(_ value: TableSnapshot, _ incoming: [TableEvent]) {
    guard value.meId == owner, value.roomId == roomID, value.protocol == 1 else {
      end("auth", message: "账号或协议已变化，请重新登录")
      return
    }
    if snapshot == nil || value.revision >= snapshot!.revision { snapshot = value }
    var known = Dictionary(events.map { ($0.seq, $0) }, uniquingKeysWith: { _, last in last })
    for e in incoming {
      known[e.seq] = e
      cursor = max(cursor, e.seq)
    }
    events = known.values.sorted { $0.seq < $1.seq }
  }
  private func connect() {
    guard !stopped, !terminal else { return }
    generation += 1
    let current = generation
    status = "正在连接"
    request = Task {
      do {
        if snapshot == nil {
          let page: TablePage = try await api.request("/api/rooms/\(roomID)")
          guard !Task.isCancelled, current == generation else { return }
          accept(page.snapshot, page.events)
          hasEarlier = page.hasMore
        }
        guard !terminal else { return }
        if snapshot?.members.first(where: { $0.uid == owner })?.seat == "removed" {
          terminal = true
          status = "已被移出同桌"
          return
        }
        let ticket: TableTicket = try await api.send(
          "/api/rooms/\(roomID)/ticket", body: [String: String]())
        guard !Task.isCancelled, current == generation else { return }
        let ws = try api.tableSocket(roomID: roomID, ticket: ticket.ticket, after: cursor)
        socket = ws
        ws.resume()
        receiver = Task { await receive(ws, current: current) }
      } catch {
        guard !Task.isCancelled, current == generation else { return }
        if let failure = error as? SoupAPIError, [401, 403, 404].contains(failure.status) {
          end(failure.status == 401 ? "auth" : "removed", message: failure.message)
        } else {
          retryLater()
        }
      }
    }
  }
  private func receive(_ ws: URLSessionWebSocketTask, current: Int) async {
    do {
      while !Task.isCancelled, current == generation {
        let value = try await ws.receive()
        guard current == generation, !stopped else { return }
        lastMessageAt = Date().timeIntervalSince1970
        let data: Data
        switch value {
        case .string(let s):
          if s == "pong" { continue }
          data = Data(s.utf8)
        case .data(let d): data = d
        @unknown default: continue
        }
        let message = try JSONDecoder().decode(TableEnvelope.self, from: data)
        if message.type == "snapshot" || message.type == "update", let value = message.snapshot {
          accept(value, message.events ?? [])
          guard !terminal else { return }
          if !online {
            online = true
            status = "实时连接"
            attempts = 0
            error = nil
            for item in pending { try await transmit(item.command, over: ws) }
            heartbeat = Task {
              while !Task.isCancelled {
                do {
                  try await Task.sleep(for: .seconds(25))
                  try Task.checkCancellation()
                  if Date().timeIntervalSince1970 - lastMessageAt > 60 {
                    retryLater()
                    return
                  }
                  try await ws.send(.string("ping"))
                } catch {
                  if !Task.isCancelled, current == generation { retryLater() }
                  return
                }
              }
            }
          }
        } else if message.type == "error" || message.type == "ack" {
          if let reason = message.terminal {
            end(reason, message: message.error ?? "请重新入座")
            return
          }
          if let id = message.commandId {
            if message.type == "error" {
              rejected = pending.first(where: { $0.command.commandId == id })?.command
            }
            pending.removeAll { $0.command.commandId == id }
            try persist()
          }
          if message.type == "error" { error = message.error }
        }
      }
    } catch {
      guard !Task.isCancelled, current == generation, !stopped, !terminal else { return }
      retryLater()
    }
  }
  private func retryLater() {
    guard !stopped, !terminal else { return }
    generation += 1
    online = false
    status = "正在重连，记录会自动补齐"
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    heartbeat?.cancel()
    receiver?.cancel()
    reconnect?.cancel()
    let seconds = min(30, 3 * pow(2, Double(min(attempts, 4))))
    attempts += 1
    reconnect = Task {
      do {
        try await Task.sleep(for: .seconds(seconds))
        try Task.checkCancellation()
        connect()
      } catch {}
    }
  }
  private func end(_ reason: String, message: String) {
    terminal = true
    generation += 1
    online = false
    status = message
    error = message
    requiresLogin = reason == "auth"
    heartbeat?.cancel()
    reconnect?.cancel()
    socket?.cancel(with: .normalClosure, reason: nil)
    socket = nil
    snapshot = nil
    events = []
    if reason == "removed" {
      pending = []
      try? persist()
      Task {
        if let page: TablePage = try? await api.request("/api/rooms/\(roomID)"), !stopped {
          accept(page.snapshot, page.events)
          hasEarlier = page.hasMore
        }
      }
    }
  }
  private func transmit(_ command: TableCommand, over ws: URLSessionWebSocketTask) async throws {
    let data = try JSONEncoder().encode(command)
    guard let text = String(data: data, encoding: .utf8) else { return }
    try await ws.send(.string(text))
  }
  @discardableResult func send(_ command: TableCommand) -> Bool {
    guard online, let ws = socket, !stopped, !terminal else {
      error = "连接恢复后再发送，内容可以先留在输入框"
      return false
    }
    guard pending.count < 12 else {
      error = "请等前面的操作确认后再试"
      return false
    }
    pending.append(TablePending(at: Date().timeIntervalSince1970 * 1000, command: command))
    do { try persist() } catch {
      pending.removeLast()
      self.error = "无法保存待确认操作，请检查手机存储空间"
      return false
    }
    let current = generation
    Task {
      do { try await transmit(command, over: ws) } catch {
        if current == generation { retryLater() }
      }
    }
    return true
  }
  func earlier() async {
    guard let first = events.first else { return }
    let current = generation
    do {
      let page: TablePage = try await api.request("/api/rooms/\(roomID)/events?before=\(first.seq)")
      guard !stopped, current == generation else { return }
      accept(page.snapshot, page.events)
      hasEarlier = page.hasMore
    } catch { if !isRequestCancellation(error) { self.error = error.localizedDescription } }
  }
}
