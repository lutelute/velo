# Architecture

Velo follows a **three-layer architecture** with clear separation of concerns.

```
+--------------------------+
|     React 19 + Zustand   |   UI Layer
|  Components + 8 Stores   |   (TypeScript)
+--------------------------+
|     Service Layer         |   Business Logic
|  Gmail / DB / AI / Sync  |   (TypeScript)
|  Calendar / Bundles /     |
|  Filters / Notifications  |
+--------------------------+
|     Tauri v2 + Rust       |   Native Layer
|  System Tray / OAuth /    |   (Rust)
|  SQLite / Notifications / |
|  Deep Links / Autostart   |
+--------------------------+
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [Tauri v2](https://v2.tauri.app/) |
| **Frontend** | React 19, TypeScript, Zustand 5 |
| **Styling** | Tailwind CSS v4 |
| **Editor** | TipTap v3 |
| **Backend** | Rust |
| **Database** | SQLite (via tauri-plugin-sql) |
| **Search** | FTS5 with trigram tokenizer |
| **AI** | Anthropic Claude, OpenAI GPT, Google Gemini |
| **Icons** | Lucide React |
| **Drag & Drop** | @dnd-kit |
| **Testing** | Vitest + Testing Library |

## Data Flow

1. **Sync** -- Background sync every 60s via Gmail History API (delta sync). Falls back to full sync if history expires (~30 days).
2. **Storage** -- All messages, threads, labels, contacts, calendar events, and AI results stored in local SQLite (24 tables) with FTS5 full-text indexing.
3. **State** -- Seven Zustand stores manage UI state. No middleware, no persistence needed -- ephemeral state rebuilds from SQLite on startup.
4. **Rendering** -- Email HTML is sanitized with DOMPurify and rendered in sandboxed iframes. Remote images blocked by default.
5. **Background services** -- Five interval checkers run continuously: sync, snooze, scheduled send, follow-up reminders, newsletter bundles (all 60s intervals).
6. **Security** -- Phishing link detection scores message links with 10 heuristic rules. SPF/DKIM/DMARC authentication headers parsed and displayed as badges.

## Project Structure

```
velo/
├── src/
│   ├── components/           # React components (11 groups, ~55 files)
│   │   ├── layout/           # Sidebar, EmailList, ReadingPane, TitleBar
│   │   ├── email/            # ThreadView, MessageItem, EmailRenderer,
│   │   │                     # ContactSidebar, SmartReplySuggestions,
│   │   │                     # InlineReply, ThreadSummary, FollowUpDialog,
│   │   │                     # AuthBadge, AuthWarningBanner, PhishingBanner,
│   │   │                     # LinkConfirmDialog, CategoryTabs
│   │   ├── composer/         # Composer, AddressInput, EditorToolbar,
│   │   │                     # AiAssistPanel, ScheduleSendDialog, FromSelector
│   │   ├── search/           # CommandPalette, SearchBar, ShortcutsHelp, AskInbox
│   │   ├── settings/         # SettingsPage, FilterEditor, LabelEditor,
│   │   │                     # SubscriptionManager, ContactEditor,
│   │   │                     # QuickStepEditor, SmartFolderEditor
│   │   ├── accounts/         # AddAccount, AccountSwitcher, SetupClientId
│   │   ├── calendar/         # CalendarPage, MonthView, WeekView, DayView,
│   │   │                     # EventCard, EventCreateModal
│   │   ├── labels/           # LabelForm
│   │   ├── dnd/              # DndProvider (drag threads → sidebar labels)
│   │   └── ui/               # EmptyState, Skeleton, ContextMenu, illustrations/
│   ├── services/             # Business logic layer
│   │   ├── db/               # SQLite queries (27 files), migrations, FTS5
│   │   ├── gmail/            # GmailClient, tokenManager, syncManager
│   │   ├── ai/               # AI service, 3 providers, categorization, Ask Inbox
│   │   ├── google/           # Google Calendar API
│   │   ├── composer/         # Draft auto-save
│   │   ├── search/           # Query parser, SQL builder
│   │   ├── filters/          # Auto-apply filter engine
│   │   ├── categorization/   # Rule-based categorization engine
│   │   ├── snooze/           # Snooze & scheduled send checkers
│   │   ├── followup/         # Follow-up reminder checker
│   │   ├── bundles/          # Newsletter bundle manager
│   │   ├── notifications/    # OS notification manager
│   │   ├── contacts/         # Gravatar integration
│   │   ├── attachments/      # Attachment cache manager
│   │   ├── unsubscribe/      # One-click unsubscribe (RFC 8058)
│   │   ├── quickSteps/       # Quick step executor, types, defaults
│   │   ├── badgeManager.ts   # Taskbar badge count
│   │   ├── deepLinkHandler.ts # mailto: protocol handler
│   │   └── globalShortcut.ts # System-wide compose shortcut
│   ├── stores/               # Zustand stores (8): ui, account, thread,
│   │                         # composer, label, contextMenu, shortcut, smartFolder
│   ├── hooks/                # useKeyboardShortcuts, useClickOutside, useContextMenu
│   ├── utils/                # crypto, date, emailBuilder, sanitize, imageBlocker,
│   │                         # mailtoParser, fileUtils, templateVariables, noReply
│   ├── constants/            # Keyboard shortcut definitions
│   └── styles/               # Tailwind CSS v4 globals
├── src-tauri/
│   ├── src/                  # Rust backend (tray, OAuth, splash, single-instance)
│   ├── capabilities/         # Tauri v2 permissions
│   └── icons/                # App icons (all platforms)
├── docs/                     # Documentation
├── package.json
├── CLAUDE.md                 # AI coding assistant context
└── README.md
```

## Rust Backend

The Rust layer (`src-tauri/src/`) is intentionally thin -- most logic lives in TypeScript. It provides:

- **System tray** -- Show/hide, check mail, quit menu
- **OAuth server** -- Localhost PKCE server on port 17248
- **Splash screen** -- Shown during initialization, closed when ready
- **Single instance** -- Prevents duplicate app windows, forwards deep link args
- **Minimize to tray** -- Hides on close instead of quitting
- **Custom titlebar** -- Overlay on macOS, frameless on Windows/Linux
- **Windows AUMID** -- Set for proper notification identity

**Tauri commands:** `start_oauth_server`, `close_splashscreen`, `set_tray_tooltip`, `open_devtools`

**Plugins (13):** sql, notification, opener, log, dialog, fs, http, single-instance, autostart, deep-link, global-shortcut

## Service Layer

All business logic lives in `src/services/` as plain async functions (except `GmailClient` class).

| Service | Description |
|---------|-------------|
| `db/` | SQLite queries (27 files), migrations, FTS5 search |
| `gmail/` | Gmail client, token management, sync engine |
| `ai/` | AI service with 3 providers, categorization, Ask Inbox |
| `google/` | Google Calendar API |
| `composer/` | Draft auto-save (3s debounce) |
| `search/` | Gmail-style query parser, SQL builder |
| `filters/` | Auto-apply filter engine (AND logic) |
| `categorization/` | Rule-based categorization before AI fallback |
| `snooze/` | Snooze & scheduled send background checkers |
| `followup/` | Follow-up reminder checker |
| `bundles/` | Newsletter bundling with delivery schedules |
| `notifications/` | OS notifications with VIP filtering |
| `contacts/` | Gravatar integration |
| `attachments/` | Local attachment caching |
| `unsubscribe/` | One-click unsubscribe (RFC 8058) |
| `quickSteps/` | Custom action chains with executor engine |

**Root-level services:** `badgeManager.ts` (taskbar badge), `deepLinkHandler.ts` (mailto: protocol), `globalShortcut.ts` (system-wide compose)

## UI Layer

Eight Zustand stores manage ephemeral UI state:

| Store | Purpose |
|-------|---------|
| `uiStore` | Theme, sidebar, reading pane, density, font scale, selections |
| `accountStore` | Account list, active account |
| `threadStore` | Thread list, selected thread, loading state |
| `composerStore` | Compose state, recipients, body, attachments |
| `labelStore` | Label list, label operations |
| `contextMenuStore` | Right-click context menu state |
| `shortcutStore` | Custom keyboard shortcut bindings |
| `smartFolderStore` | Saved searches with dynamic query tokens |

## Database

SQLite via Tauri SQL plugin. 12 migrations, 30 tables total.

Key tables: `accounts`, `messages` (with FTS5 index, `auth_results`), `threads` (with `is_pinned`, `is_muted`), `thread_labels`, `labels`, `contacts`, `attachments`, `filter_rules`, `scheduled_emails`, `templates`, `signatures`, `image_allowlist`, `settings`, `ai_cache`, `thread_categories`, `calendar_events`, `follow_up_reminders`, `notification_vips`, `unsubscribe_actions`, `bundle_rules`, `bundled_threads`, `send_as_aliases`, `smart_folders`, `link_scan_results`, `phishing_allowlist`, `quick_steps`.

## Startup Sequence

1. Run database migrations
2. Restore persisted settings (theme, sidebar, density, font scale, reading pane, etc.)
3. Load custom keyboard shortcuts
4. Initialize Gmail clients for all accounts, sync send-as aliases
5. Start background sync (60s interval), backfill uncategorized threads
6. Start background checkers (snooze, scheduled send, follow-up, bundles)
7. Initialize OS notifications
8. Register global compose shortcut
9. Initialize deep link handler (`mailto:`)
10. Update taskbar badge count
11. Close splash screen, show main window
