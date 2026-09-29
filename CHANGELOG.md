# Changelog

## 0.40.0 - 2026-09-29

### Features

- Add personal useful / set-aside marks to solo and multiplayer Web/PWA questions and answers, including archived games and question ledgers. Click an active mark again to clear it; filter all, marked, useful or set-aside entries while keeping each question with its answer.
- Save marks only in the current browser, separated by account and game/room. Keep tabs in sync, report local storage failures, and preserve marks through room replay and history pagination without API writes or model calls.

### Validation

- Pass 224 tests, lint and production build checks. Verify solo play and archives, private marks in real WebSocket rooms, browser refresh, cross-tab changes, account isolation, read-only history pagination, storage errors and mobile/desktop layouts.
- Marks use browser-local storage only; this release adds no server-side storage, room protocol changes or model requests.

### Native apps

- iOS remains 0.7.0 (build 13), and Android remains 0.4.0 (build 7). Personal usefulness marks are currently a Web/PWA feature; the native apps retain the shared question ledger from v0.39.0.
- Native attachments are unchanged from v0.39.1. The iOS ZIP is an unsigned arm64/x86_64 Simulator app, not an iPhone IPA. The Android APK is a debug-signed test build.

## 0.39.1 - 2026-09-29

### Fixes

- Make the desktop table's case-rail scrollbar thin and transparent at rest. Reveal a muted, paper-toned thumb on hover or keyboard focus without an opaque track or layout shift.
- Keep wheel and keyboard scrolling available for long question ledgers, with a visible focus outline and system scrollbar colors in high-contrast mode.

### Validation

- Check a 30-question ledger in light and dark themes, including idle/hover appearance, stable width, wheel scrolling, keyboard scrolling and forced colors.
- Pass lint and production build checks. This is a web-only presentation change with no database migration or room protocol changes.

### Native apps

- iOS remains 0.7.0 (build 13), and Android remains 0.4.0 (build 7), with the shared question ledger introduced in v0.39.0. Native attachments are unchanged from that release.
- The iOS attachment is an unsigned Simulator app for arm64 and x86_64, not an iPhone IPA. The Android APK is a debug-signed test build.

## 0.39.0 - 2026-09-29

### Features

- Add shared question ledgers to Web/PWA, native iOS and Android tables. Open the ledger beside the premise on mobile, or read it in the desktop case rail.
- Mark answers and ledger entries with the solo game's yes, no, partly, unrelated and solved stamps, and show who asked each question.
- Pair questions and answers by question ID so interleaved discussion cannot mix up players or verdicts. Skip unanswered questions and replies without a supported verdict, and prioritize the solved stamp.
- Preserve ledgers in shared archives, deduplicate reconnect replay and load earlier questions through existing history pagination. No additional model calls or database migration are required.

### Validation

- Pass 217 tests, lint, production web and native builds. Cover question pairing, replay, incomplete history pages and solved verdicts.
- Verify the ledger with real browser, iOS Simulator and Android emulator clients against an isolated local Worker, including shared archives and mobile/desktop layouts.

### Native apps

- Update iOS to 0.7.0 (build 13) and Android to 0.4.0 (build 7).
- The iOS attachment is an unsigned Simulator app for arm64 and x86_64, not an iPhone IPA. Physical iPhones use the Personal Team setup in `ios/README.md`. The Android APK is a debug-signed test build.

## 0.38.1 - 2026-09-28

### Fixes and resource usage

- Add a visible Leave action on Web, iOS and Android tables. Leaving releases the seat and disconnects the account's devices while keeping the shared case file.
- Read completed or left-seat archives over HTTP without WebSocket tickets, heartbeats or automatic reconnects. Refresh an ongoing archive on demand and restore a live connection only after rejoining.
- Send every final event page before closing room sockets, discard obsolete pending commands, and handle rooms that finish during reconnection without a retry loop.
- Reject real-time connections for read-only archives and skip unchanged presence writes and D1 projections. Preserve full history catch-up on additional devices without requiring a presence change.
- Keep the existing two-minute reconnect grace period, 24-hour idle timeout and persistent shared archives.

### Validation

- Pass 213 tests, lint and production build checks, including multi-device leave, paginated catch-up, completed-room reconnection races and failed manual refreshes.
- Verify leave, HTTP archive refresh, explicit rejoin and shared reports with browser, native iOS and Android clients against an isolated local Worker.

### Native apps

- Update iOS to 0.6.1 (build 12) and Android to 0.3.1 (build 6).
- The iOS attachment is an unsigned Simulator app for arm64 and x86_64, not an iPhone IPA. Physical iPhones use the Personal Team setup in `ios/README.md`. The Android APK is a debug-signed test build.
- No database migration is required.

## 0.38.0 - 2026-09-28

### Improvements

- Give mobile Web/PWA, iOS and Android tables one chronological conversation for player questions, host answers and discussion. Switch the composer between asking Yan and chatting without hiding messages or losing either draft.
- Use a three-column desktop workspace for the case and members, formal questions, and discussion. Keep both composers available and preserve drafts when resizing the window.
- Open long premises and member controls in separate panels, and keep the invitation card compact and inside the scrolling conversation.
- Keep the mobile web composer within the visible viewport when the keyboard opens, restore focus after closing a panel, and distinguish empty or unavailable send buttons in native apps.

### Validation

- Verify waiting, joining, questions, discussion, reveal votes and archives with authenticated local WebSocket clients. Cover native iOS/Android interaction, long English premises, narrow screens, independent drafts and desktop/mobile transitions.
- Retain the A/B/C interactive prototypes and screenshots as the design reference for the selected mobile A and desktop C layouts.

### Native apps

- Update iOS to 0.6.0 (build 11) and Android to 0.3.0 (build 5). The attached iOS archive is an unsigned Simulator app; physical iPhones use the Personal Team installation in `ios/README.md`. The Android APK is a debug-signed test build.
- This release uses the existing room protocol and database schema; no new migration is required.

## 0.37.0 - 2026-09-28

### Features

- Restore the admin author-digest panel alongside community metrics, with email previews, the next scheduled send, per-author status, recent delivery history, and manual send/retry controls.
- Automatically send author activity digests every Monday at 20:00 Asia/Shanghai (12:00 UTC), starting September 28. Send only to authors with public puzzles, recent activity, and no opt-out; keep Chinese, English, and Japanese email copy and unsubscribe links.

### Reliability

- Use fixed weekly windows and durable per-author reservations so overlapping Cron invocations and manual sends cannot duplicate accepted messages. Preserve the statistics snapshot on retries and expose ambiguous outcomes for inspection.
- Exclude authors' own actions, page through all eligible authors, escape display names in HTML email, and protect manual sends with administrator and same-origin checks.
- Add migration `021-weekly-digest.sql` before deploying the Worker. Retain the existing daily-puzzle and maintenance schedules.

### Native apps

- Native clients remain iOS 0.5.0 (build 10) and Android 0.2.0 (build 4), including invited multiplayer tables. The iOS Simulator archive is unsigned and cannot be installed on an iPhone; physical-device builds use the Xcode Personal Team setup in `ios/README.md`. The Android APK is a debug-signed test build.

## 0.36.0 - 2026-09-28

### Features

- Add invitation-only tables for 2–6 signed-in players on Web/PWA, native iOS 0.5.0 and native Android 0.2.0: shared questions, separate discussion, follow-up references, unanimous reveal votes and shared case reports.
- Keep table archives under My Tables with reconnect recovery, persisted unacknowledged operations, host transfer, invitation controls and a frozen archive for removed members.
- Publish separate team shortest/longest solve records, exclude tables in which the author participated, and count only consenting nonauthors toward deduplicated manual reveals.

### Reliability and security

- Coordinate each table in a SQLite Durable Object with sequential Jev processing, durable leases, idempotent commands, event replay and retryable D1 projection.
- Require account authentication, membership checks, same-origin browser requests, single-use session-bound WebSocket tickets and bounded inputs/rates. Keep truth and original stories server-side until an authorized conclusion.
- Verify native and browser room identity before replaying pending commands; reject expired sessions and stop removed members from receiving later events.

## 0.35.13 - 2026-09-27

### Improvements

- Apply the same continuous, feathered glass spoiler to tags on daily soup pages. Hover or tap reveals the group for three seconds, while today's locked soup continues to withhold its tags.

## 0.35.12 - 2026-09-27

### Improvements

- Cover each library detail's tags and their spacing with one continuous spoiler layer, including wrapped lines, and reveal the group together for three seconds.
- Replace the solid fill and hard edges with transparent frosted blur, feathered edges, and softer particles with the appearance of dew on glass.

## 0.35.11 - 2026-09-27

### Features

- Cover every library-detail tag with Gaussian blur and animated white dust. Hover, tap, or keyboard activation reveals an individual tag for three seconds; activating again renews the timer.
- Remask tags when focus leaves or the page goes into the background, avoid revealing on touch scrolling, and respect reduced-motion preferences.

## 0.35.10 - 2026-09-27

### Features

- Add a collapsed spoiler section to official daily puzzles in the library, loading the full original story only when the reader opens it.
- Show the full story alongside the truth in revealed and solved case reports, preserve its paragraphs in saved archives, and recover it for older reports.
- Keep the story behind the same reveal rules as the truth: ordinary questions and locked manual reveals do not return it, while successfully solving a daily bowl reveals both.

## 0.35.9 - 2026-09-25

### Features

- Make the website installable as a PWA on iPhone, Android, and desktop with branded icons and a standalone home-screen experience.
- Precache the version-matched app shell and route chunks for offline access to local case archives, while keeping navigation fresh and API or account data out of the Service Worker cache.
- Explain installation in the About page and support the browser's install prompt where available.

## 0.35.8 - 2026-09-25

### Fixes

- Use the original story as the canonical source for official daily judgments, including factual answers and solve checks. The condensed truth identifies the core twist but cannot override story facts.
- Fall back to the submitted truth for community puzzles that have no original story, without adding another model request.

## 0.35.7 - 2026-09-25

### Fixes

- Keep narrow factual statements on the yes/no path and distinguish a person's fate from a relative's in host judgments.
- Ask for a specific fact when a supposed theory and its verdict are both uncertain, instead of combining a tentative yes with cold feedback.
- Require condensed daily truths to preserve who died and who remains alive; clarify the September 22 bowl's mother/sister distinction.

## 0.35.6 - 2026-09-25

### Fixes

- Judge official daily questions against the original story as well as the condensed truth, so explicit timeline facts survive condensation.
- Keep recent player questions for reference resolution without feeding earlier host verdicts back into the model; this prevents a wrong answer from reinforcing itself across turns.
- Clarify the September 25 daily's canonical answer key after conflicting answers about the brother's age and final appearance.

## 0.35.5 - 2026-09-25

### Fixes

- Keep the Cron invocation open until daily generation finishes, and report generation failures as failed scheduled runs.
- Remove the duplicate midnight trigger; the six-hour schedule already includes 00:00 UTC and continues to backfill missing daily bowls.

## 0.35.4 - 2026-09-25

### Improvements

- Give mobile web a single-row masthead and a fixed four-tab navigation for the bureau, daily bowls, library, and account.
- Keep the current section and unread account activity visible in the tab bar; hide it during play to preserve room for the conversation.

## 0.35.3 - 2026-09-25

### Fixes

- Group the mobile web header into a clear account row and navigation row without spreading controls across the screen.
- Match the curated library link to the section label's type scale and keep the progress-lock icon beside its copy on narrow screens.

## 0.35.2 - 2026-09-24

### Features

- Show each soup's shortest and longest successful question counts in public web and native details, excluding the author's account. Today's official soup keeps these records hidden until it unlocks.

### Fixes

- Stop a solved player's later questions from increasing the recorded solve length.
- Repair historical overcounts only when a complete turn log establishes the first solved question (`db/migrations/019-solve-turn-records.sql`).

## 0.35.1 - 2026-09-24

### Fixes

- Give mobile web navigation and author puzzle cards enough room for titles, stats, and actions in narrow layouts.
- Keep the native iOS and Android search fields visually stable before and during input.

## 0.33.9 - 2026-09-24

### Fixes

- Preserve the original language label for past daily puzzles, including English and Japanese bowls after the UTC date changes.
- Return genre scores consistently in the daily index and detail APIs.

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
