# Changelog

## 0.33.8 - 2026-09-23

### Fixes

- Keep feedback snapshots valid within the storage limit by retaining recent complete messages and recording omitted content.
- Recover complete fields and messages from legacy truncated snapshots without rewriting stored reports; show partial-recovery, damaged-content, and missing-snapshot notices in the admin page.

## 0.33.7 - 2026-09-23

### Fixes

- Judge each question afresh against the puzzle truth, using recent conversation for context without copying or inverting earlier answers.
- Keep uncertain judgments out of yes/no badges and the fact ledger; show the clarification reply while retaining the raw model judgment in debug details.

## 0.33.6 - 2026-09-23

### Features

- Share the bowl you are playing straight from the always-visible case-file bar, using the system share sheet with a copy-link fallback.

## 0.33.5 - 2026-09-23

### Fixes

- Keep daily story, puzzle, hint, and retry instructions in the selected Chinese, English, or Japanese language, including genre and duplicate-avoidance guidance.
- Validate each generated content field before publication; retry language mismatches and never publish them through relaxed quality review.

## 0.33.4 - 2026-09-23

### Features

- Show an "Official" label beside the official-bowl verification mark on library cards, library detail, and daily pages, localized in Chinese, English, and Japanese.

## 0.33.3 - 2026-09-22

### Fixes

- Recover missing application chunks after deployment, while ignoring unrelated script failures.
- Keep a reload cooldown across successful boots; use manual recovery when storage is blocked or progress is unsaved.
- Let slow startup finish without an automatic refresh or a false crash report.
- Record the failed asset path and preserve React component stacks without duplicate resource-error reports.
- Allow slower host responses to finish, with a 20-second attempt timeout and one bounded retry; return localized errors when the service remains unavailable.

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
