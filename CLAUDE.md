# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development — starts Tauri app with Vite dev server (port 1420)
npm run tauri dev

# Build production app
npm run tauri build

# Vite dev server only (no Tauri)
npm run dev

# Run all tests (single run)
npm run test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest run src/stores/uiStore.test.ts

# Type-check only (no emit)
npx tsc --noEmit

# Rust backend only (from src-tauri/)
cargo build
cargo test
```

## Architecture

Tauri v2 desktop app: Rust backend + React 19 frontend communicating via Tauri IPC.

### Three-layer data flow

1. **Rust backend** (`src-tauri/`): System tray, minimize-to-tray (hide on close), splash screen, OAuth localhost server (port 17248, PKCE), single-instance enforcement, autostart support. Tauri commands: `start_oauth_server`, `close_splashscreen`, `set_tray_tooltip`, `open_devtools`. Plugins: sql (SQLite), notification, opener, log, dialog, fs, http, single-instance, autostart, deep-link (`mailto:` scheme), global-shortcut. Windows-specific: sets AUMID for proper notification identity.

2. **Service layer** (`src/services/`): All business logic. Plain async functions (not classes, except `GmailClient`).
   - `db/` — SQLite queries via `getDb()` singleton from `connection.ts`. Version-tracked migrations in `migrations.ts`. FTS5 full-text search on messages (trigram tokenizer). 27 service files covering accounts, messages, threads, labels, contacts, filters, templates, signatures, attachments, scheduled emails, image allowlist, search, settings, AI cache, bundle rules, calendar events, follow-up reminders, notification VIPs, thread categories, send-as aliases, smart folders, quick steps, link scan results, and phishing allowlist.
   - `gmail/` — `GmailClient` class auto-refreshes tokens 5min before expiry, retries on 401. `tokenManager.ts` caches clients per account in a Map. `syncManager.ts` orchestrates sync (60s interval). `sync.ts` does initial sync (365 days, configurable via `sync_period_days` setting) and delta sync via Gmail History API; falls back to full sync if history expired (~30 days). `authParser.ts` parses SPF/DKIM/DMARC from `Authentication-Results` headers. `sendAs.ts` fetches send-as aliases from Gmail API.
   - `ai/` — `aiService.ts` provides thread summaries, smart replies, AI compose, text transform, and auto-categorization. `providerManager.ts` manages three providers (`providers/claudeProvider.ts`, `providers/openaiProvider.ts`, `providers/geminiProvider.ts`). `askInbox.ts` enables natural language inbox queries. `categorizationManager.ts` auto-sorts threads into Primary/Updates/Promotions/Social/Newsletters. `errors.ts` and `types.ts` define shared AI types. Results cached locally via `db/aiCache.ts`.
   - `google/` — `calendar.ts` handles Google Calendar API (list calendars, fetch events, create events, token refresh).
   - `composer/` — `draftAutoSave.ts` auto-saves drafts every 3 seconds (debounced). Watches composer state changes via Zustand subscribe.
   - `search/` — `searchParser.ts` parses Gmail-style operators (`from:`, `to:`, `subject:`, `has:attachment`, `is:unread/read/starred`, `before:`, `after:`, `label:`). `searchQueryBuilder.ts` builds SQL queries from parsed operators.
   - `filters/` — `filterEngine.ts` auto-applies filters to incoming messages during sync. Criteria use AND logic (case-insensitive substring matching). Actions: applyLabel, archive, trash, star, markRead.
   - `categorization/` — `ruleEngine.ts` applies rule-based categorization (pattern matching on sender/subject) before falling back to AI.
   - `snooze/` — Background interval checkers for snooze unsnooze and scheduled sends.
   - `followup/` — `followupManager.ts` checks for follow-up reminders (threads with no reply after user-set delay).
   - `bundles/` — `bundleManager.ts` manages newsletter bundling with delivery schedules.
   - `notifications/` — `notificationManager.ts` provides OS notifications via tauri-plugin-notification with VIP sender filtering.
   - `contacts/` — `gravatar.ts` fetches Gravatar profile images for contacts.
   - `attachments/` — `cacheManager.ts` handles local attachment caching with size limits.
   - `unsubscribe/` — `unsubscribeManager.ts` handles one-click unsubscribe (RFC 8058 List-Unsubscribe-Post and mailto: fallback).
   - `quickSteps/` — Custom action chain executor with 18 action types. `executor.ts` runs action sequences on threads. `defaults.ts` provides preset templates. `types.ts` defines action chain schema.
   - Root-level services: `badgeManager.ts` (taskbar badge count), `deepLinkHandler.ts` (`mailto:` protocol handling), `globalShortcut.ts` (system-wide compose shortcut).

3. **UI layer** (`src/components/`, `src/stores/`): Eight Zustand stores (`uiStore`, `accountStore`, `threadStore`, `composerStore`, `labelStore`, `contextMenuStore`, `shortcutStore`, `smartFolderStore`) — simple synchronous state, no middleware. Components subscribe directly via hooks.

### Component organization

11 groups, ~55 component files:
- `layout/` — Sidebar, EmailList, ReadingPane, TitleBar
- `email/` — ThreadView, ThreadCard, MessageItem, EmailRenderer, ActionBar, AttachmentList, SnoozeDialog, ContactSidebar, FollowUpDialog, InlineAttachmentPreview, InlineReply, SmartReplySuggestions, ThreadSummary, AuthBadge, AuthWarningBanner, PhishingBanner, LinkConfirmDialog, CategoryTabs
- `composer/` — Composer (TipTap v3 rich text editor), AddressInput, EditorToolbar, AttachmentPicker, ScheduleSendDialog, SignatureSelector, TemplatePicker, UndoSendToast, AiAssistPanel, FromSelector
- `search/` — CommandPalette, SearchBar, ShortcutsHelp, AskInbox
- `settings/` — SettingsPage, FilterEditor, LabelEditor, SignatureEditor, TemplateEditor, ContactEditor, SubscriptionManager, QuickStepEditor, SmartFolderEditor
- `accounts/` — AddAccount, AccountSwitcher, SetupClientId
- `calendar/` — CalendarPage, CalendarReauthBanner, CalendarToolbar, DayView, WeekView, MonthView, EventCard, EventCreateModal
- `labels/` — LabelForm
- `dnd/` — DndProvider (@dnd-kit drag-and-drop: threads → sidebar labels)
- `ui/` — EmptyState, Skeleton, ContextMenu, ContextMenuPortal, illustrations/ (InboxClearIllustration, NoAccountIllustration, NoSearchResultsIllustration, ReadingPaneIllustration, GenericEmptyIllustration)

### Multi-window support

Thread pop-out windows via `ThreadWindow.tsx`. Entry point in `main.tsx` checks URL params (`?thread=...&account=...`) to render `<ThreadWindow />` or `<App />`. Window label format: `thread-{threadId}`. Tauri capabilities allow `thread-*` wildcard. Default size: 800x700. Splash screen window (400x300, no decorations, always on top) shown during initialization.

### Startup sequence (App.tsx)

1. `runMigrations()`
2. Restore persisted settings: theme, color theme, sidebar, contact sidebar, reading pane position, read filter, email list width, email density, default reply mode, mark-as-read behavior, send & archive, font scale, inbox view mode, phishing detection
3. Load custom keyboard shortcuts (`shortcutStore.loadKeyMap()`)
4. `getAllAccounts()` → `initializeClients()` → `fetchSendAsAliases()` per account
5. `startBackgroundSync()` (60s interval), `backfillUncategorizedThreads()`
6. `startSnoozeChecker()` + `startScheduledSendChecker()` + `startFollowUpChecker()` + `startBundleChecker()` (60s intervals)
7. `initNotifications()` (request OS permission)
8. `initGlobalShortcut()` (system-wide compose shortcut)
9. `initDeepLinkHandler()` (`mailto:` protocol)
10. `updateBadgeCount()` (taskbar badge)
11. `close_splashscreen` → show main window
12. Cleanup on unmount: stop all background checkers, unregister shortcuts, deep link handler

### Cross-component communication

Custom window events: `velo-sync-done`, `velo-toggle-command-palette`, `velo-toggle-shortcuts-help`, `velo-toggle-ask-inbox`. Tray emits `tray-check-mail` via Tauri event system. `single-instance-args` event for deep link forwarding.

### Keyboard shortcuts

`useKeyboardShortcuts` hook in App.tsx — Superhuman-style keys. Skips when input/textarea/contentEditable is focused. Supports two-key sequences (only `g` prefix currently) with 1s timeout via refs. Shortcut definitions in `src/constants/shortcuts.ts`. Customizable via `shortcutStore` (persisted to SQLite settings).

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate threads down/up |
| `o` / `Enter` | Open thread |
| `e` | Archive |
| `s` | Star/unstar |
| `p` | Pin/unpin |
| `m` | Mute/unmute thread |
| `c` | Compose new email |
| `r` | Reply |
| `a` | Reply all |
| `f` | Forward |
| `u` | Unsubscribe |
| `#` / `Delete` / `Backspace` | Trash (permanent delete if already in trash) |
| `!` | Report spam / Not spam (context-aware) |
| `/` or `Ctrl+K` | Command palette / search |
| `?` | Shortcuts help |
| `Escape` | Close composer → clear multi-select → deselect thread (hierarchical) |
| `Ctrl+Shift+E` | Toggle sidebar |
| `Ctrl+Enter` | Send email (in composer) |
| `Ctrl+A` | Select all threads |
| `Ctrl+Shift+A` | Select all threads from current position |
| `g` then `i` | Go to Inbox |
| `g` then `s` | Go to Starred |
| `g` then `t` | Go to Sent |
| `g` then `d` | Go to Drafts |
| `g` then `p` | Go to Primary |
| `g` then `u` | Go to Updates |
| `g` then `o` | Go to Promotions |
| `g` then `c` | Go to Social |
| `g` then `n` | Go to Newsletters |

Multi-select: click to toggle, Shift+click for range. All keyboard actions work on multi-selected threads.

## Styling

Tailwind CSS v4 — uses `@import "tailwindcss"`, `@theme {}` for custom properties, and `@custom-variant dark` in `src/styles/globals.css`. Dark mode toggles via `<html class="dark">` which swaps CSS custom properties. Font scaling via `font-scale-{small|default|large|xlarge}` classes on `<html>`.

**Semantic color tokens**: `bg-bg-primary/secondary/tertiary/hover/selected`, `text-text-primary/secondary/tertiary`, `border-border-primary/secondary`, `bg-accent/accent-hover/accent-light`, `bg-danger/warning/success`, `bg-sidebar-bg`, `text-sidebar-text`.

**Glass effects**: `.glass-panel`, `.glass-modal`, `.glass-backdrop` utility classes with blur and shadow properties.

**Color themes**: 8 accent color presets (Indigo, Rose, Emerald, Amber, Sky, Violet, Orange, Slate) defined in `src/constants/themes.ts`. Each has light & dark variants. Applied via CSS custom properties, independent of light/dark mode.

**Background**: Animated gradient blobs (5 blobs with radial gradients, keyframe animations). Light mode uses blue→purple→pink→orange→cyan gradient; dark mode uses darker blues/purples.

**Icons**: `lucide-react` icon library.

## Testing

Vitest + jsdom. Setup file: `src/test/setup.ts` (imports `@testing-library/jest-dom/vitest`). Config: `globals: true` (no imports needed for `describe`, `it`, `expect`). Tests are colocated with source files (e.g., `uiStore.test.ts` next to `uiStore.ts`). Zustand test pattern: `useStore.setState()` in beforeEach, assert via `.getState()`.

~30 test files across stores (6), services (10), utils (9), and components (5).

## Database

SQLite via Tauri SQL plugin. 12 migrations (version-tracked in `_migrations` table). Custom `splitStatements()` handles BEGIN...END blocks in triggers.

Key tables (30 total): `accounts`, `messages` (with FTS5 index `messages_fts`, `auth_results`), `threads` (with `is_pinned`, `is_muted`), `thread_labels`, `labels`, `contacts` (frequency-ranked for autocomplete, with `first_contacted_at`), `attachments` (with `cached_at`, `cache_size`), `filter_rules` (criteria/actions as JSON), `scheduled_emails` (status: pending/sent/failed), `templates` (with optional keyboard shortcut), `signatures`, `image_allowlist`, `settings` (key-value store), `ai_cache`, `thread_categories`, `calendar_events`, `follow_up_reminders`, `notification_vips`, `unsubscribe_actions`, `bundle_rules`, `bundled_threads`, `send_as_aliases`, `smart_folders`, `link_scan_results`, `phishing_allowlist`, `quick_steps`, `_migrations`.

## Key Gotchas

- **Tauri SQL plugin config**: `preload` in tauri.conf.json must be an array `["sqlite:velo.db"]` — NOT an object/map
- **Tauri Emitter trait**: Must `use tauri::Emitter;` to call `.emit()` on windows
- **Tauri capabilities**: Any new plugin needs explicit permissions added to `src-tauri/capabilities/default.json`. Windows allow `"main"`, `"splashscreen"`, and `"thread-*"` wildcard
- **Tauri window config**: Custom titlebar — macOS uses `titleBarStyle: "Overlay"`, Windows/Linux removes decorations programmatically in Rust setup. 1200x800 default, 800x600 minimum. Splash screen: 400x300, no decorations, center, always on top
- **Single instance**: `tauri-plugin-single-instance` must be first plugin registered. Forwards args for deep linking
- **Minimize-to-tray**: Use `.on_window_event()` on the Builder, not `window.on_window_event()`
- **Windows WebView2**: `Chrome_WidgetWin_0` error on close is benign — ignore it
- **Windows AUMID**: Set explicitly in Rust for proper notification identity (`com.velomail.app`)
- **OAuth**: Localhost server tries ports 17248-17251. PKCE flow, no client secret. Client ID stored in SQLite settings table, configured by user in Settings
- **CSP**: Allows connections to googleapis.com, anthropic.com, openai.com, generativelanguage.googleapis.com, gravatar.com, googleusercontent.com
- **TypeScript strict mode**: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` are all enabled. Target ES2021, bundler module resolution, `moduleDetection: "force"`
- **Path alias**: `@/*` maps to `src/*`
- **Email HTML rendering**: DOMPurify sanitization, rendered in sandboxed iframe (`allow-same-origin` only). Strips remote images by default (uses `data-blocked-src` attributes), allowlist per sender
- **Thread deletion**: Two-stage — first trash, then permanent delete from DB if already in trash
- **Snooze**: Removes INBOX label and adds SNOOZED label (not just a flag)
- **Draft auto-save**: 3-second debounce, not configurable
- **Gmail History API**: Expires after ~30 days, triggers automatic full sync fallback
- **Vite HMR**: Uses port 1421 when `TAURI_DEV_HOST` is set
- **Vite build**: Multi-page — `index.html` (main app) + `splashscreen.html`
- **Filter engine**: AND logic for criteria, merges actions when multiple filters match same message
- **AI providers**: API keys stored in SQLite settings table. Provider selected per-feature in settings. Results cached in `ai_cache` table
- **Deep links**: `mailto:` scheme registered via tauri-plugin-deep-link. Opens compose window with pre-filled recipient
- **Autostart**: Uses `--hidden` flag to start minimized to tray
- **Phishing detection**: 10 heuristic rules (IP URLs, homograph, suspicious TLDs, URL shorteners, display/href mismatch, suspicious paths, brand impersonation, dangerous protocols, free email impostor, subdomain spoofing). Sensitivity configurable (low/default/high). Results cached in `link_scan_results`
- **Auth display**: SPF/DKIM/DMARC parsed from `Authentication-Results` header. Aggregate verdict: pass/fail/warning/unknown. Stored in `messages.auth_results` column
- **Mute threads**: Sets `is_muted` flag, auto-archives. Muted threads suppressed from notifications during delta sync
- **Send-as aliases**: Fetched from Gmail `/settings/sendAs` API on account init. `FromSelector` shown in composer when account has multiple aliases
- **Smart folders**: Saved search queries with dynamic tokens (`__LAST_7_DAYS__`, `__LAST_30_DAYS__`, `__TODAY__`). Managed via `smartFolderStore`
- **Quick steps**: Custom action chains with 18 action types. Executor in `services/quickSteps/executor.ts`
- **Split inbox**: Category tabs (Primary/Updates/Promotions/Social/Newsletters) with backfill service for existing threads
