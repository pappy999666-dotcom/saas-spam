# MASTER_PLAN.md — SaaS Promoter Architectural Blueprint & Execution Roadmap

> **Single Source of Truth & Universal Handoff Guide for SaaS Promoter**  
> **Status**: Approved for Implementation  
> **Target**: Strictly Surpass `pappy-omega-mini` in UX, Reliability, Performance, and Aesthetic Design.

---

## 1. Executive Vision: Surpassing Pappy Omega Mini

While `pappy-omega-mini` established proven workflows for WhatsApp automation, it suffered from severe technical debt:
* **Monolithic Architecture**: An 11,149-line Telegram bot (`bot.ts`) and a 2,518-line WhatsApp registry (`command-registry.ts`) with entangled state, business logic, and UI rendering.
* **Primitive Mobile UX**: Monospace ASCII boxes inside `<pre>` tags that broke on mobile clients, lacking native buttons, real tables, or clean progress streaming.
* **Dangerous Passive Eavesdropping**: Monitored and parsed all messages across all participating groups, risking account bans and memory exhaustion.
* **Unbounded Memory & Dropped Jobs**: Ad-hoc in-memory queue runners that dropped tasks upon restart and suffered from unbounded Signal LRU cache leaks under heavy group loads.

### How SaaS Promoter Surpasses the Reference:
1. **Clean Hexagonal Architecture**: Strict plane separation. WhatsApp is exclusively the execution plane (Groups/Channels only); Telegram is the control and monitoring plane. All business logic sits in a plane-agnostic domain core.
2. **Native Telegram Bot API 10.3**: Official bordered tables (`RichBlockTable`), custom emoji entities (`RichTextCustomEmoji`), ephemeral controls, and live draft streaming (`sendRichMessageDraft`) for sub-second, zero-spam progress.
3. **Smart Listening Leases**: Zero continuous passive listening. Groups are listened to only when an operator grants an explicit, time-bounded lease (`.listen 5m`). Outbound broadcast capabilities operate independently of inbound listening.
4. **Durable, Resume-Safe Operation Engine**: Unified job planner with idempotency keys, rate-limited delay scaling (5s–300s), classified retries (transient vs permanent), and full state persistence across process restarts.
5. **Next-Generation Aesthetic Engine**: Superior visual status designs (`_gstatusd`, `_allstatusd`) featuring intelligent URL title cleanup, OpenGraph subtitle integration, verified rich link preview cards, expanded saturated palettes, and modern Unicode framing.

---

## 2. The Designed Status Aesthetic Engine (`_gstatusd` & `_allstatusd`)

The `gstatusd` (group status designed) and `allstatusd` family is one of the highest-value capabilities of the product. It transforms ordinary status broadcasts into high-engagement visual canvases.

```
Incoming Broadcast Payload: "Check out https://chat.whatsapp.com/INVITE123"
                               │
                               ▼
           [ Canonical Link Preview Extraction ]
   ├── Fetches OpenGraph Metadata (Title, Description, Image)
   ├── Normalizes Title: strips brand tags ("| GitHub", "• Group")
   └── Generates Crisp High-Res Thumbnail (Sharp pipeline)
                               │
                               ▼
             [ Deterministic Canvas Generator ]
   ├── Seed: `${workspaceId}:${sessionId}:${groupJid}:${timestamp}`
   ├── Palette Selection: 20 vibrant, WCAG-tested background colors
   ├── Font Selection: WhatsApp Status Font Index (0 through 9)
   └── Frame Template Selection: Ornamental Unicode Frame
                               │
                               ▼
             [ Composed Status Payload Delivery ]
   ├── Text Canvas: Saturated Background + Styled Frame + Indented URL
   ├── Rich Link Card: Attached `linkPreview` metadata object
   └── Dispatch options: `{ groupStatus: true, backgroundColor, font }`
```

### 2.1 Aesthetic Framing Templates (`URL_TEMPLATES`)
SaaS Promoter preserves the beloved ornamental frames from the reference while introducing modern minimalist and card-style frames:

```typescript
export const STATUS_URL_TEMPLATES = [
  // 1. Celestial Blossom (Classic Cute Aesthetic)
  (title: string, url: string) =>
    `┈┈┈ 𓍢ִ໋✧ ${title} ✧𓍢ִ໋ ┈┈┈\n   ${url}\n┈┈┈┈┈┈┈ ₊˚⊹ ┈┈┈┈┈┈┈`,

  // 2. Starline Minimal
  (title: string, url: string) =>
    `˚.✦ ── ${title} ── ✦.˚\n   ${url}\n˚.✦ ────── ⋆ ────── ✦.˚`,

  // 3. Heart Ribbon
  (title: string, url: string) =>
    `─── ᰔ Ɛゝ ${title} Ɛゝ ᰔ ───\n   ${url}\n───────── 𖦹 ─────────`,

  // 4. Bracket Star
  (title: string, url: string) =>
    `╭─ Ɛゝ ${title} Ϧ3 ─╮\n   ${url}\n╰─── ⋆⋅☆⋅⋆ ───╯`,

  // 5. Delicate Flutter
  (title: string, url: string) =>
    `┈─𓏲 ${title} 𓏲─┈\n   ${url}\n┈─┈─ ᰔ ─┈─┈`,

  // 6. Diamond Radiance
  (title: string, url: string) =>
    `⟡─── Ɛゝ ${title} ───⟡\n   ${url}\n⟡──────── ✧ ────────⟡`,

  // 7. Sparkle Crest
  (title: string, url: string) =>
    `⋆˚࿔ ${title} ࿔˚⋆\n   ${url}\n───── ⋆⋅☆⋅⋆ ─────`,

  // 8. Stardust Spark
  (title: string, url: string) =>
    `.・゜-: ✧ ${title} ✧ :-゜・.\n   ${url}\n.・゜-: ─────── :-゜・.`,

  // 9. Ocean Breeze
  (title: string, url: string) =>
    `~〜~ ✧ ${title} ✧ ~〜~\n   ${url}\n~〜~〜~〜 𖦹 ~〜~〜~〜`,

  // 10. Modern Executive (SaaS Promoter Exclusive)
  (title: string, url: string) =>
    `┌── ✦ ${title.toUpperCase()} ✦ ──┐\n   ${url}\n└────────────────────────┘`,

  // 11. Clean Cyber Box (SaaS Promoter Exclusive)
  (title: string, url: string) =>
    `◢■■ ${title} ■■◣\n   ${url}\n◥■■■■■■■■■■■■■■■■◤`,

  // 12. Minimalist Bullet Card (SaaS Promoter Exclusive)
  (title: string, url: string) =>
    `❖ ${title}\n   ⤷ ${url}\n━━━━━━━━━━━━━━━━━━━━`,
];
```

### 2.2 Saturated High-Contrast Color Palette
The background canvas colors are explicitly selected for maximum readability on mobile displays across light and dark modes:
```typescript
export const STATUS_PALETTE = [
  "#6D5DFB", // Electric Indigo
  "#C2509E", // Magenta Rose
  "#0EA5A8", // Deep Cyan
  "#D97706", // Vivid Amber
  "#DB2777", // Neon Pink
  "#2563EB", // Royal Blue
  "#7C3AED", // Violet Purple
  "#0F766E", // Forest Emerald
  "#BE185D", // Ruby Crimson
  "#4F46E5", // Deep Iris
  "#B45309", // Warm Ochre
  "#0891B2", // Cerulean
  "#4338CA", // Midnight Iris
  "#047857", // Jade Green
  "#9D174D", // Deep Wine
  "#1D4ED8", // Cobalt Blue
  "#6B21A8", // Purple Velvet
  "#C026D3", // Vivid Fuchsia
  "#059669", // Mint Emerald
  "#E11D48", // Vivid Rose
];
```

### 2.3 Intelligent Title & Metadata Extraction
1. **Extraction Pipeline**: When `_gstatusd` or `_allstatusd` is invoked, any HTTP/HTTPS URL is parsed.
2. **Metadata Fetch**: Link Preview Engine extracts `<meta property="og:title">`, `<title>`, or `<meta name="twitter:title">`.
3. **Clean-up Rules**:
   * Strips tracking noise: `?utm_*`, `?fbclid=*`.
   * Strips generic brand suffixes: `| WhatsApp Group`, `- YouTube`, `• Instagram photos`, `| Facebook`.
   * Decodes HTML entities (`&amp;` → `&`, `&#039;` → `'`).
   * Caps title to 36 characters with clean word boundary truncation.
   * Fallback hierarchy: `OpenGraph Title` → `Group Subject Name` → `"WhatsApp Group"`.
4. **Rich Preview Attachment**: Reuses the resolved link preview thumbnail and description directly inside the message payload so WhatsApp renders the rich card alongside the styled status text.

---

## 3. Comprehensive Command Catalog & Feature Map

### 3.1 WhatsApp Command Inventory (Execution Plane)

| Command | Aliases | Category | Scope | Permission | Description & Execution Path |
|---|---|---|---|---|---|
| `_menu` | `_list`, `_help` | Discovery | DM / Group | Any Member | Renders categorized menu cards with interactive navigation. |
| `_ping` | `_p` | Diagnostics | DM / Group | Any Member | Displays socket roundtrip latency and uptime badge. |
| `_health` | `_status` | Diagnostics | DM / Group | Sudo / Owner | Runtime socket state, memory usage, inbound/outbound stats. |
| `_setprefix` | `_prefix` | Session | DM / Group | Sudo / Owner | Sets prefix: `.`, `_`, `!`, `/`, or `none` (prefixless). |
| `_setsudo` | `_sudo` | Security | DM / Group | Owner Only | Whitelists a verified WhatsApp number for session command execution. |
| `_rmsudo` | `_removesudo`| Security | DM / Group | Owner Only | Revokes sudo privileges from a WhatsApp number. |
| `_listen` | `_lease` | Listening | Current Group | Sudo / Owner | Grants temporary listening lease (e.g. `.listen 5m`). |
| `_cgc` | `_creategc` | Groups | Current Group | Sudo / Owner | Interactive group creator: Name → Image → Bio → Confirm. |
| `_leavegc`| `_lve`, `_lvgc`| Groups | Current Group | Sudo / Owner | Safely leaves the target group JID. |
| `_lvall` | `_leaveall` | Groups | Global | Owner Only | Leaves all groups; enforces native [YES] / [NO] buttons. |
| `_groups` | `_mygroups` | Groups | DM / Group | Sudo / Owner | Paginated list of joined groups with member counts. |
| `_setgpp` | `_gpp` | Profile | Group | Sudo / Owner | Sets HD group profile picture from replied image (uncropped). |
| `_setpfp` | `_pfp` | Profile | DM / Group | Sudo / Owner | Sets session profile picture from replied image. |
| `_rmpfp` | `_removepfp`| Profile | DM / Group | Sudo / Owner | Removes the current session profile picture. |
| `_pmt` | `_promote` | Moderation | Group | Admin Only | Promotes target to group admin (@mention or verified phone). |
| `_dmt` | `_demote` | Moderation | Group | Admin Only | Demotes group admin to regular participant. |
| `_spmt` | `_smartpmt` | Moderation | Group / Cross | Admin Only | Smart promote: verifies target membership or creates safe copy-code. |
| `_sdmt` | `_smartdmt` | Moderation | Group / Cross | Admin Only | Smart demote across group boundaries. |
| `_tag` | `_hidetag` | Tagging | Group | Sudo / Admin | Latency-optimized invisible hidetag; supports recursive self-chaining. |
| `_stag` | `_showtag` | Tagging | Group | Sudo / Admin | Visible participant mention broadcast. |
| `_gstatus`| `_gs` | Status | Current Group | Sudo / Owner | Publishes payload directly to current group's native WhatsApp Status. |
| `_gstatusx`| `_gsx` | Status | Current Group | Sudo / Owner | Repeated group status broadcast (count: 2–20). |
| `_gstatusd`| `_dgstatus` | Status | Current Group | Sudo / Owner | **Designed group status** with URL title extraction & styling. |
| `_togstatus`| `_togs` | Status | Target Group | Sudo / Owner | Dispatches group status to an external target group invite. |
| `_togstatusx`| `_tgsx`| Status | Target Group | Sudo / Owner | Repeated external target group status. |
| `_allstatus`| `_alls` | Broadcast | All Groups | Owner Only | Queued broadcast to all joined groups with pacing. |
| `_allstatusd`| `_dalls` | Broadcast | All Groups | Owner Only | **Designed broadcast** with group-aware styles & URL titles. |
| `_allstatusx`| `_allsx` | Broadcast | All Groups | Owner Only | Repeated broadcast to all groups with delay progression. |
| `_allstatusd`| `_allsd` | Pacing | Global | Sudo / Owner | Configures inter-group delay for status broadcasts (5s–300s). |
| `_allchat` | `_ac` | Broadcast | All Groups | Owner Only | Broadcasts hidden-mention message to all group chats. |
| `_allchatx`| `_acx` | Broadcast | All Groups | Owner Only | Repeated group chat broadcast with pacing. |
| `_allchatd`| `_acd` | Pacing | Global | Sudo / Owner | Configures inter-group delay for chat broadcasts (5s–300s). |
| `_join` | `_joinlink` | Joining | DM / Group | Sudo / Owner | Direct group join from invite URL or quoted message. |
| `_joind` | `_setjoind` | Pacing | Session | Sudo / Owner | Configures Join Manager delay between joins (5s–300s). |
| `_targetgs`| `_jointarget`| Joining | Session | Sudo / Owner | Sets maximum Active-bucket link cap for Join Manager. |
| `_autojoin`| `_togglejoin`| Joining | Session | Sudo / Owner | Toggles automatic invite link intake. |
| `_iggc` | `_ignoregc` | Broadcast | Session | Sudo / Owner | Ignores specific group JIDs from all status/chat broadcasts. |
| `_stopstatus`| `_stopallstatus`| Queue | Session | Sudo / Owner | Immediately cancels active allstatus batch jobs. |
| `_stopchat`| `_stopallchat`| Queue | Session | Sudo / Owner | Immediately cancels active allchat batch jobs. |
| `_pendingjoin`| `_joinrequests`| Approvals | Group | Admin Only | Displays pending join requests table with country breakdowns. |
| `_approveall`| `_appall` | Approvals | Group | Admin Only | Bounded approval of all pending join requests (requires confirm). |
| `_approveamt`| `_appamt` | Approvals | Group | Admin Only | Approves first N pending join requests. |
| `_approvecountry`| `_appcountry`| Approvals | Group | Admin Only | Approves pending requests matching international country code. |
| `_rejectall`| `_rejall` | Approvals | Group | Admin Only | Bounded rejection of all pending requests. |
| `_rejectamt`| `_rejamt` | Approvals | Group | Admin Only | Rejects first N pending requests. |
| `_rejectcountry`| `_rejcountry`| Approvals | Group | Admin Only | Rejects pending requests matching country code. |
| `_reqamt` | `_joincount` | Approvals | Group | Admin Only | Counts pending requests grouped by phone country prefix. |
| `_kickall`| `_removeall` | Moderation | Group | Admin Only | Bulk removal of non-admin members with confirmation button. |
| `_kickamt`| `_removeamt` | Moderation | Group | Admin Only | Removes first N non-admin members. |
| `_kickcountry`| `_removecountry`| Moderation | Group | Admin Only | Removes non-admin members matching country code. |
| `_mp3` | `_toaudio` | Media | DM / Group | Sudo / Owner | Transcodes quoted audio/video to high-quality MP3 attachment. |
| `_cs` | `_convertsticker`| Media | DM / Group | Sudo / Owner | Converts quoted sticker back to PNG or MP4 video. |
| `_stickerinfo`| `_sinfo` | Media | DM / Group | Sudo / Owner | Shows embedded EXIF pack name, publisher, and dimensions. |
| `_previewdebug`| `_pdebug`| Diagnostics | DM / Group | Any Member | Inspects canonical link preview extraction for any URL. |
| `_support`| `_ticket` | Support | DM / Group | Any Member | Creates a support ticket delivered to Telegram admin inbox. |

---

### 3.2 Telegram Control Plane Features (Management Plane)

* **Bot API 10.3 Native Control Center**:
  * `/start` & `/menu`: Private dashboard with instant access to Sessions, Operations, Link Buckets, and Settings.
  * `/pair [label] [phone]`: High-speed pairing wizard with 8-character `SAASPROM` code generation and copy button.
  * `/sessions`: Paginated session switcher (5/page) with real-time socket health badges.
  * `/autopromote`: Multi-scope scheduling wizard (Session, User, Global).
  * `/setsudo`: Multi-tier sudo management (Session, Global Workspace, Omni).
* **Live Show & Draft Progress**:
  * Single-message live monitoring with `sendRichMessageDraft` streaming progress bars, active item counts, countdown timers, and live error diagnostics.
* **Validator Hub & Bucket Management**:
  * Real-time link verification state machine (`Main` → `Validating` → `Active` / `Dead` / `Retryable`).
  * Requeue retryable errors, download verified `.txt` link lists, purge dead links.
* **Global Command Bridge**:
  * Multi-session command execution desk with active session filtering, batch fan-out, and aggregated response reports.
* **Workload Manager (Distributed Panels)**:
  * Deploy single-file `index.js` workers to external VPS/Pterodactyl panels, connect via 8-char code, share panels across child workspaces.
* **Master Admin Panel (Owner Only)**:
  * Force Join enforcement, User directory & ban controls, Omni Sudo list, Central Menu Media manager, Emergency Mode kill-switch, Inceptor maintenance sweep.

---

## 4. State Machines, Queues & Domain Models

### 4.1 Link Bucket State Machine (Validator Engine)
```
      [ Document / Text Ingestion ]
                    │
                    ▼
               [ MAIN BUCKET ]
                    │  (Admission Sweep every 5s; concurrency: 5 links/socket)
                    ▼
             [ VALIDATING BUCKET ]
          (Leased to active socket)
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
  [ ACTIVE ]     [ DEAD ]    [ RETRYABLE ]
  (Verified)     (Revoked)   (Rate-limited)
      │                           │
  Downloadable                Requeue to Main
```

### 4.2 Auto-Promote Scheduling Architecture
```typescript
export interface AutoPromoteRule {
  id: string;
  workspaceId: string;
  scope: "SESSION" | "USER" | "GLOBAL";
  sessionId?: string;
  command: "allstatus" | "allstatusd" | "allchat" | "allstatusx";
  postsPerGroup: number;
  payload: {
    text?: string;
    caption?: string;
    media?: WhatsAppMediaPayload;
  };
  schedule: {
    startDate: string;      // YYYY-MM-DD
    endDate: string;        // YYYY-MM-DD
    timesPerDay: number;    // 1 to 5
    slotTimes: string[];    // ["08:00", "13:00", "20:00"]
    timezone: string;       // e.g. "Africa/Lagos", "UTC"
  };
  state: "ACTIVE" | "PAUSED" | "COMPLETED" | "EXPIRED";
  lastRunAt?: number;
  nextRunAt?: number;
}
```

---

## 5. Universal AI & Engineer Handoff Guide

If another AI or developer joins this project, follow this exact protocol to maintain architectural integrity:

### 5.1 Where Code Lives
* **Domain Core & Shared Logic**: [`src/core/`](file:///root/saas-promoter/src/core)
  * `errors.ts`: Error classification (`ClassifiedError`, `FailureKind`).
  * `identity.ts`: Phone/JID normalization. **Never expose LIDs**.
  * `permissions.ts`: Role hierarchy (`owner`, `sudo`, `global_sudo`, `none`).
  * `command-parser.ts`: Prefix matching, alias normalization, self-chain unwrapping.
  * `command-registry.ts`: Strongly typed registry.
  * `operation-engine.ts`: Bounded worker queues, exponential backoff, cancellation tokens.
* **Link Preview Subsystem**: [`src/preview/`](file:///root/saas-promoter/src/preview)
  * `engine.ts`: Canonical URL resolution, SSRF filtration, Sharp crop & edge sharpening, versioned caching.
* **WhatsApp Transport**: [`src/transport/`](file:///root/saas-promoter/src/transport)
  * `plogme-adapter.ts`: Capability-gated socket wrapper. Never call raw Baileys methods directly.
  * `runtime.ts`: Socket connection lifecycle, auto-reconnect, and pairing.
  * `normalizer.ts`: Inbound message normalization and quoted media extraction.
* **Telegram Control Plane**: [`src/telegram/`](file:///root/saas-promoter/src/telegram)
  * `client.ts`: Thin Bot API 10.3 HTTPS client.
  * `control-plane.ts`: Poller, router, and callback dispatcher.
* **Command Modules**: [`src/commands/`](file:///root/saas-promoter/src/commands)
  * `groups.ts`: Group lifecycle, promotion, status, and tagging.
  * `bulk.ts`: Allstatus, allchat, broadcast delay tuning.
  * `join.ts`: Join Manager and direct invite resolution.

### 5.2 Mandatory Engineering Rules
1. **Never Invent APIs**: Check `plogme` method enumeration in `docs/REFERENCE_AUDIT.md`.
2. **Never Expose LIDs**: Always pass WhatsApp IDs through `firstVerifiedPhone()` or `formatMention()`.
3. **Never Block the Event Loop**: Batch iterations must yield via `setImmediate` or follow configured pacing delays.
4. **Always Write Unit Tests**: Any new command or parser adjustment must have a corresponding test in `tests/`.
5. **Always Run Quality Gates**:
   * Type check: `npx tsc -p tsconfig.json --noEmit`
   * Test suite: `npx vitest run`

---

## 6. Implementation Phase Roadmap

```
- [x] Phase 0: Forensic Audit & Capability Enumeration (Complete)
- [x] Phase 1: Core Foundation & Operation Engine (Complete & Tested: 51/51 tests pass)
- [ ] Phase 2: Designed Status Engine (_gstatusd, _allstatusd, status-design.ts, URL title extraction)
- [ ] Phase 3: WhatsApp Runtime & Socket Manager (plogme lifecycle, pairing 'SAASPROM', listening leases)
- [ ] Phase 4: Full WhatsApp Command Suite (Groups, Admin, Moderation, Join, Approvals, Media tools)
- [ ] Phase 5: Telegram Bot API 10.3 Control Plane (Rich Tables, Live Draft Streaming, Dashboards)
- [ ] Phase 6: Reference Feature Migration (Validator Hub, Join Manager, Auto-Promote)
- [ ] Phase 7: Workload Panel Subsystem (Distributed index.js worker runtime)
- [ ] Phase 8: End-to-End Soak Testing & Hardening
```
