import Combine
import Foundation

@MainActor
final class CommunityStore: ObservableObject {
  @Published private(set) var snapshots: [SocialTarget: SocialSnapshot] = [:]
  @Published private(set) var errors: [SocialTarget: String] = [:]
  @Published private(set) var busy: Set<SocialTarget> = []
  @Published private(set) var unread = 0
  @Published private(set) var generation = 0
  @Published var publicationRevision = 0
  private var uid: String?
  private var fetched: [SocialTarget: Date] = [:]
  private var loading: [SocialTarget: UUID] = [:]
  private var unreadRevision = 0
  private let api: SoupAPI
  private let playerKey: String

  init(api: SoupAPI = .shared, playerKey: String = NativeIdentity.playerKey) {
    self.api = api
    self.playerKey = playerKey
  }

  func activate(_ userID: String?) {
    guard uid != userID else { return }
    uid = userID
    generation += 1
    snapshots = [:]
    errors = [:]
    fetched = [:]
    loading = [:]
    busy = []
    unread = 0
  }

  func load(_ target: SocialTarget, force: Bool = false) async {
    guard loading[target] == nil, !busy.contains(target) else { return }
    if !force, let date = fetched[target], date.timeIntervalSinceNow > -45 { return }
    let epoch = generation
    let requestID = UUID()
    loading[target] = requestID
    errors[target] = nil
    defer { if loading[target] == requestID { loading[target] = nil } }
    do {
      let snapshot = try await api.social(target, playerKey: playerKey)
      guard epoch == generation, loading[target] == requestID else { return }
      snapshots[target] = snapshot
      fetched[target] = .now
    } catch {
      if epoch == generation, loading[target] == requestID, !isRequestCancellation(error) {
        errors[target] = error.localizedDescription
      }
    }
  }

  func toggleLike(_ target: SocialTarget) async {
    guard let snapshot = snapshots[target], !busy.contains(target) else { return }
    let epoch = generation
    // Invalidate an older GET so it cannot overwrite this mutation's result.
    loading[target] = nil
    busy.insert(target)
    errors[target] = nil
    defer { if epoch == generation { busy.remove(target) } }
    do {
      let result = try await api.setLike(!snapshot.liked, target: target, playerKey: playerKey)
      guard epoch == generation else { return }
      snapshots[target]?.likes = result.likes
      snapshots[target]?.liked = result.liked
      fetched[target] = .now
    } catch { if epoch == generation { errors[target] = error.localizedDescription } }
  }

  func comment(_ text: String, on target: SocialTarget) async throws {
    guard uid != nil else { throw SoupAPIError(status: 401, message: "登录后，就可以参与讨论") }
    guard !busy.contains(target) else { throw SoupAPIError(status: 0, message: "请等上一条互动完成") }
    let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (2...300).contains(body.utf16.count) else {
      throw SoupAPIError(status: 0, message: "留言请写 2–300 字")
    }
    let epoch = generation
    loading[target] = nil
    busy.insert(target)
    defer { if epoch == generation { busy.remove(target) } }
    let comment = try await api.comment(body, target: target)
    guard epoch == generation else { throw CancellationError() }
    snapshots[target]?.comments.insert(comment, at: 0)
    fetched[target] = .distantPast
  }

  func delete(_ comment: SocialComment, on target: SocialTarget) async throws {
    guard comment.canDelete, uid != nil, !busy.contains(target) else { return }
    let epoch = generation
    loading[target] = nil
    busy.insert(target)
    defer { if epoch == generation { busy.remove(target) } }
    let _: OKReply = try await api.request(
      "/api/social/comments/\(apiSegment(comment.id))", method: "DELETE")
    guard epoch == generation else { throw CancellationError() }
    snapshots[target]?.comments.removeAll { $0.id == comment.id }
    fetched[target] = .distantPast
  }

  func refreshUnread() async {
    guard uid != nil else { return }
    let epoch = generation
    let revision = unreadRevision
    do {
      let result: NotificationsReply = try await api.request("/api/me/notifications")
      if epoch == generation && revision == unreadRevision { unread = result.unread }
    } catch {
      // Keep the last known badge; the activity screen offers a retry.
    }
  }

  func markSeen() async {
    guard uid != nil else { return }
    let epoch = generation
    unreadRevision += 1
    do {
      let _: OKReply = try await api.request("/api/me/notifications/seen", method: "POST")
      if epoch == generation { unread = 0 }
    } catch {
      // Do not clear an unread badge if the server did not acknowledge it.
    }
  }
}
