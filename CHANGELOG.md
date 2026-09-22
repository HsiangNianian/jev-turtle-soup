# Changelog

## 0.33.2 - 2026-09-22

### Fixes

- Keep routine cloud saves silent so each question and answer no longer shows a sync banner.
- Show sync notices and retry controls only for offline, failed, unauthenticated, or unsaved progress.

## 0.33.1 - 2026-09-22

### Fixes

- Hide the synced notice after three seconds, and show it again when a new save starts syncing.
- Keep syncing, offline, authentication, failure, and unsaved-progress notices visible until resolved.

## 0.33.0 - 2026-09-22

### Features

- Sync saved games to the signed-in account with separate local storage for guests and each account.
- Persist upload and deletion queues across refreshes, retry temporary failures, and show sync status in Chinese, English, and Japanese.

### Fixes

- Reply playfully in the player’s language when a puzzle has no hint, instead of displaying empty quotation marks.

- Generate daily puzzles using recent titles and surfaces from the puzzle table.
- Prevent account switches and late responses from mixing progress or clearing newer edits.
- Preserve legacy saves during migration and report local storage failures without claiming progress was saved.

### Development

- Keep Vite hot reload and local Workers development as separate, documented entry points.
- Pin Wrangler 4.136.2 and Vitest 5.0.1, add regression tests, and provide a local OTP mode that skips email.
- Document environment-file precedence and incremental database upgrades.

### Compatibility

- Existing save URLs and timestamp conflict rules remain compatible; new clients send `X-Save-Owner`.
- Existing databases without the saves table need `db/migrations/016-saves.sql` before deployment.
- Cloud lists remain limited to 200 games. Cross-device deletion tombstones are not included.
