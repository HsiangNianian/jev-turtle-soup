import CryptoKit
import Foundation
import Combine

struct CaseEnvelope: Codable {
  var games: [CaseFile] = []
  var dirtyIDs: Set<String> = []
}

/// Each account has its own file. A failed read never overwrites the original.
struct CaseArchive {
  var directory: URL?

  func fileURL(owner: String) throws -> URL {
    let root =
      try directory
      ?? FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appendingPathComponent("NativeCases", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let key = SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
    return root.appendingPathComponent("\(key).json")
  }

  func load(owner: String) throws -> CaseEnvelope {
    let url = try fileURL(owner: owner)
    guard FileManager.default.fileExists(atPath: url.path) else { return CaseEnvelope() }
    return try JSONDecoder().decode(CaseEnvelope.self, from: Data(contentsOf: url))
  }

  func save(_ archive: CaseEnvelope, owner: String) throws {
    let data = try JSONEncoder().encode(archive)
    var options: Data.WritingOptions = [.atomic]
    #if os(iOS)
      options.insert(.completeFileProtectionUntilFirstUserAuthentication)
    #endif
    try data.write(to: fileURL(owner: owner), options: options)
  }
}

enum QuestionMarkFilter: String, CaseIterable {
  case all, marked, useful, notUseful = "not-useful"
  var label: String {
    switch self { case .all: "全部记录"; case .marked: "我的标记"; case .useful: "只看有用"; case .notUseful: "暂时无用" }
  }
}

/// Private, account/case-scoped annotations. Deliberately excluded from CaseFile and room commands.
@MainActor final class LocalQuestionMarks: ObservableObject {
  @Published private(set) var values: [String: String]
  @Published var filter: QuestionMarkFilter = .all
  private let key: String
  private let defaults: UserDefaults
  init(owner: String?, kind: String, id: String, defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let scope = try! JSONEncoder().encode([owner, kind, id])
    key = "soup.question-marks.v1." + scope.base64EncodedString()
    values = (defaults.dictionary(forKey: key) as? [String: String] ?? [:]).filter { $0.value == "useful" || $0.value == "not-useful" }
  }
  func toggle(_ id: String, value: String) {
    guard value == "useful" || value == "not-useful" else { return }
    var next = (defaults.dictionary(forKey: key) as? [String: String] ?? [:]).filter { $0.value == "useful" || $0.value == "not-useful" }
    if next[id] == value { next.removeValue(forKey: id) } else { next[id] = value }
    if next.isEmpty { defaults.removeObject(forKey: key) } else { defaults.set(next, forKey: key) }
    values = next
  }
  func includes(_ id: String?) -> Bool {
    if filter == .all { return true }
    guard let id, let mark = values[id] else { return false }
    return filter == .marked || mark == filter.rawValue
  }
}
