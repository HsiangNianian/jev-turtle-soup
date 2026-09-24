import CryptoKit
import Foundation

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
