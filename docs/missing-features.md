# Missing Feature Analysis — Arc Mail vs. Major Email Clients

## Top 5 CRITICAL Features

| # | Feature | Source | Description | Complexity |
|---|---------|--------|-------------|------------|
| **1** | **End-to-End Encryption (PGP/S/MIME)** | Thunderbird, Proton, Tuta | Industry-standard email encryption and digital signatures. Required for healthcare, legal, finance, government. No encryption = blocked from entire market segments. | Complex |
| **2** | **Full Offline Mode** | Outlook, Thunderbird | Complete offline access — compose, flag, move, delete, organize without internet. Changes sync on reconnect. Essential for mobile professionals and unreliable connections. | Complex |
| **3** | **The Screener (First-Contact Approval)** | Hey.com, Spark (Gatekeeper) | First-time senders land in approval queue. Approve = inbox, reject = permanent block. Revolutionary spam/noise elimination. Both Hey and Spark ship this as a flagship feature. | Medium |
| **4** | **Auto Drafts (Proactive AI Replies)** | Superhuman | AI automatically writes follow-up replies without prompting, in your writing style. Superhuman's flagship 2025 feature — transforms email from reactive to proactive. | Complex |
| **5** | **Data Export/Import & Backup** | Outlook (PST), Thunderbird (profile) | Export entire mailbox (messages, folders, settings) for backup/migration. Import from other clients. Critical for user trust and data portability. | Medium |

## Top 5 HIGH Features

| # | Feature | Source | Description | Complexity |
|---|---------|--------|-------------|------------|
| **6** | **Out of Office / Auto-Replies** | Outlook | Automatic vacation/absence responses with schedule, internal/external messages, and exceptions. Expected by every professional user. | Medium |
| **7** | **Sender Blocklist / Safe Senders** | Outlook, Thunderbird | Comprehensive block/allow sender lists with domain support. Junk/spam filtering with trainable Bayesian classifier. We have phishing detection but no user-managed block system. | Medium |
| **8** | **Action-Based Auto Labels** | Superhuman | AI labels every email as "Response Needed", "Waiting On", "Meetings", "Marketing", "Cold Pitches" — action-oriented, not just category-based like our split inbox. | Medium |
| **9** | **Tracking Pixel Blocker** | Hey.com | Detect and strip spy pixels from emails, proxy all images to hide IP/location, show which senders are tracking you. Growing privacy concern. | Medium |
| **10** | **Centralized Attachment Library** | Hey.com, various | Searchable gallery of all attachments across all emails — filter by file type, sender, date. We have attachment caching but no browsable library UI. | Simple |

## Honorable Mentions (Next Tier)

| Feature | Source | Priority |
|---------|--------|----------|
| CRM Integrations (HubSpot/Salesforce) | Superhuman | High (for sales market) |
| Team Comments on Threads | Superhuman, Spark, Missive | High (for team market) |
| Shared Inboxes | Outlook, Spark, Missive | High (for team market) |
| AI Writing Style Learning | Spark | High (differentiator) |
| Smart Send (optimal delivery time) | Superhuman | Medium |
| Scheduling Poll (find mutual availability) | Outlook | Medium |
| RSS Feed Reader | Thunderbird | Medium |
| CardDAV/CalDAV sync | Thunderbird | Medium |
| Newsletter Feed View | Hey.com | Medium |
| Paper Trail (receipt auto-filing) | Hey.com | Medium |
| AI Workflow Automation (MCP/Agents) | Shortwave | Medium |
| Quick Filter Toolbar | Thunderbird | Medium |
| Email Analytics Dashboard | Various | Low |
| BIMI (brand logo display) | Gmail, Fastmail | Low |
| ~~JMAP Protocol~~ | ~~Fastmail~~ | ~~Low (future)~~ **SHIPPED** |

## Effort vs Impact Matrix

```
                    HIGH IMPACT
                        │
   Screener ●           │         ● E2E Encryption
   Auto-Replies ●       │         ● Full Offline Mode
   Block/Allow Lists ●  │         ● Auto Drafts AI
   Attachment Library ● │         ● Team Features
   Tracking Blocker ●   │
   Auto Labels ●        │
   Data Export ●        │
                        │
  SIMPLE ───────────────┼─────────────── COMPLEX
                        │
   Feed View ●          │         ● CRM Integrations
   Paper Trail ●        │         ● AI Agents/MCP
   RSS Reader ●         │         ✓ JMAP Protocol (done)
   Quick Filter ●       │
                        │
                    LOW IMPACT
```
