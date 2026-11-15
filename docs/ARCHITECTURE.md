# OmniMemory architecture

## Design goals

1. **The user controls everything.** Every memory can be seen, edited, shared, hidden and deleted in a few
   clicks, from the popup, the dashboard or the chatbot page itself.
2. **Local-first.** No OmniMemory account, server or API key. Persistence sits behind an interface so a
   cloud backend could be added later without rewriting callers. The only network traffic is optional
   *chatbot memory sync*, which talks to each chatbot's own site, from that site, with the user's own sign-in.
3. **One permission choke point.** Only one place in the code decides whether a memory may go to a chatbot,
   and every path that leads to a chatbot goes through it.
4. **The page is untrusted.** Content scripts run on third-party pages. They hold no data, cannot read the
   database, and everything they send is validated.

## Components

```
                ┌──────────────────────── extension origin ─────────────────────────┐
                │                                                                    │
  toolbar  ───► │  Popup (React)          Dashboard (React)                          │
                │      │                       │                                     │
                │      └──── MemoryService ────┘◄────┐                               │
                │                │                   │                               │
                │         IndexedDbBackend           │   Service worker              │
                │        (IndexedDB "omnimemory")    ├── router.ts (validate +       │
                │                                    │   enforce permissions)        │
                │  chrome.storage.local "omni:revision" ──► change notifications     │
                └────────────────────────────────────┼──────────────────────────────┘
                                                     │ chrome.runtime messages
                ┌────────────── chatgpt.com / claude.ai / gemini.google.com ─────────┐
                │  content script: closed shadow root → button + Panel (React)       │
                │      SiteAdapter (findComposer, readConversationTail, insert)      │
                │  content/sync: MemorySyncAdapter (read / apply) ──► same-origin    │
                │      requests to that chatbot's own memory settings endpoints      │
                └────────────────────────────────────────────────────────────────────┘
```

The worker also runs `sync-scheduler.ts`, which decides when a chatbot is behind and asks one of its tabs to
sync (or opens one in the background). The *decisions* are made in the worker by `SyncService` /
`core/sync.ts`; the content script only reads and writes the chatbot.

| Layer | Path | Responsibility |
| --- | --- | --- |
| Core | `src/core` | Data model, `MemoryService`, search, permissions, duplicates, sensitive-data checks, context building, import/export. Pure TypeScript. |
| Storage | `src/core/backend.ts`, `indexeddb-backend.ts` | `StorageBackend` interface and its IndexedDB implementation. |
| Messaging | `src/shared/messages.ts`, `src/background/router.ts` | Typed protocol, `parseRequest` validation, permission-enforcing handler. |
| Service worker | `src/background/index.ts` | Routes messages from content scripts, handles the right-click capture, expires old trash. |
| Extension pages | `src/popup`, `src/dashboard`, `src/ui` | UI. They share one `MemoryService` (`src/shared/platform.ts`) and reload on change notifications. |
| Content script | `src/content` | Site adapters, composer insertion, the on-page panel. |
| Chatbot memory sync | `src/core/sync.ts`, `src/core/sync-service.ts`, `src/background/sync-scheduler.ts`, `src/content/sync/` | Pure planner, the begin/commit service with a per-site lock, the scheduler, and the Gemini/ChatGPT adapters plus the one same-origin request helper. |

## Data model

`src/core/types.ts`. Each memory:

```ts
{
  id: string;                 // crypto.randomUUID(), never changes
  content: string;            // ≤ 2000 chars, plain text
  category: 'Personal' | 'Education' | 'Projects' | 'Technology' | 'Preferences' | 'Other';
  tags: string[];             // lowercased, de-duplicated, ≤ 12
  source: 'manual' | 'chatgpt' | 'claude' | 'gemini' | 'selection' | 'import';
  created_at, updated_at: ISO string;
  last_used_at?: ISO string;  // last time it was inserted or copied into a chatbot
  enabled: boolean;           // false = "keep private" (per-site choices are kept)
  permissions: { chatgpt: boolean; claude: boolean; gemini: boolean };
  status: 'active' | 'outdated' | 'deleted';
  deleted_at?: ISO string;    // starts the 30-day restore window
  status_before_delete?: 'active' | 'outdated';
  history: { at, action, previous?: { content?, category?, tags? }, note? }[]; // last 25
}
```

Settings (one record): `sharingPaused`, `sitePaused` per chatbot, `defaultPermissions` for new memories,
`relevanceFromPage`, `theme`, `libraryView`, `siteSync` per chatbot (keep its own memory in step) and
`syncInBackground`.

Sync bookkeeping lives in a second object store, `sync` (database version 2), one record per chatbot:
links between memories and the chatbot's entries, the last snapshot of what the chatbot remembers, the last
error, refused writes (retried after 6 hours) and a short-lived lock.

### Rules enforced by `MemoryService`

- **Edits happen in place.** `update()` keeps the id and records the previous text, category or tags in
  `history`. A change that doesn't actually change anything writes nothing.
- **Deletes are soft.** `remove()` sets `status: 'deleted'`. `restore()` puts back the previous status.
  `purge()` only erases memories already in the trash. `purgeExpired()` erases trash older than 30 days and
  runs on install, on browser startup and whenever the popup or dashboard opens.
- **Merges can be undone.** The first memory survives with the merged text, the others go to the trash, and
  sharing becomes the *intersection* of the originals so a merge never shares something more widely.
- **Nothing is overwritten silently.** Duplicate and conflict detection only produces warnings. Saves and
  imports always create new memories.

## Permission model

`src/core/permissions.ts` is the only place sharing is decided:

```
shareable(memory, site) = !settings.sharingPaused
                        && !settings.sitePaused[site]
                        && memory.status === 'active'
                        && memory.enabled
                        && memory.permissions[site]
```

`router.ts` uses it for every request from a content script:

| Request | Behaviour |
| --- | --- |
| `context/query` | Returns only shareable memories, each reduced to `{id, content, category, tags, updated_at}`. |
| `context/build` | Builds the text to insert **in the worker, from fresh data**. If a memory was unshared or deleted after the panel opened, it is dropped here. |
| `memory/update`, `memory/unshare`, `memory/delete` | Allowed only on memories the calling site can currently see. Otherwise the response is the same generic "not available", so the site can't tell whether a hidden memory exists. |
| `memory/review` | Compares the text only against memories the site can see, so a duplicate warning can't reveal hidden ones. |
| `memory/create` | Refuses text that looks like a credential. `source` is set to the calling site. |
| `sync/status`, `sync/begin`, `sync/commit`, `sync/fail`, `sync/cache`, `sync/done` | Chatbot memory sync for **the calling site only**. `begin` returns the writes to make; only memories shareable with that site are ever in them. The reported snapshot is size-limited and validated. |

**Which site is asking** comes from `sender.url` (provided by the browser) through `siteFromUrl`, which
requires HTTPS and an exact host match. The message body is never trusted for this. Messages from frames
other than the top frame, or from other extensions, are ignored.

## On-page integration

### Adapters

`SiteAdapter` (`src/content/adapters/types.ts`):

```ts
interface SiteAdapter {
  id: SiteId; label: string;
  isActive(): boolean;                         // false on sign-in pages etc.
  findComposer(): HTMLElement | null;
  findAnchor(composer): HTMLElement;           // the visible box the button sits beside
  readDraft(): string;
  readConversationTail(maxChars): string;      // last ~6 messages + draft, used only to rank
  insert(text, probe): Promise<boolean>;       // true only if verified
}
```

`createAdapter()` in `base.ts` builds an adapter from lists of selectors. It always tries generic fallbacks
(`[contenteditable][role=textbox]`, `[contenteditable]`, `textarea`) after the site-specific selectors, and if
no anchor selector matches, it walks up from the message box to the nearest rounded container.
**To add a provider:** add an entry to `src/shared/sites.ts`, write an adapter file, register it in
`adapters/index.ts`, and add a match pattern to `manifest.json`.

### Insertion (`src/content/insert.ts`)

- `<textarea>`: set the value through the native setter and dispatch an `input` event, so React-controlled
  inputs notice the change.
- Rich-text editors: focus the editor, put the caret at the start (if there is a draft) or the end, then try
  the strategies in the adapter's order:
  - a synthetic `paste` with `text/plain` (works with ProseMirror and Lexical)
  - `document.execCommand('insertText')` (works with Quill, which Gemini uses and which ignores synthetic paste)
  - a `beforeinput` event
- After each attempt the message box is read back and the closing marker `[End of context]` is counted. A
  strategy only counts as successful if the count went up. If nothing works, the panel copies the context to
  the clipboard and says so.
- Nothing is ever submitted.

### Isolation

The UI mounts in a **closed** shadow root on a custom `<omnimemory-root>` element. Styles are loaded through
a constructed stylesheet (falling back to a `<style>` element) and use `all: initial`, so the site's CSS can't
change them. Keyboard, paste and input events are stopped at the host element so the site's shortcuts don't
fire while you type in the panel. Memory text is rendered by React as text nodes; there is no
`innerHTML` anywhere (a test checks this).

### Keeping views in sync

IndexedDB has no cross-context change events. After every write, `MemoryService` calls `emitChange()`, which
writes a timestamp (never content) to `chrome.storage.local`. The popup, dashboard and open chatbot panels
listen through `storage.onChanged` and reload. This is how an edit in the popup shows up straight away on an
open ChatGPT tab.

## Chatbot memory sync

OmniMemory keeps each chatbot's *own* memory feature in step with its memories. None of the chatbots has a
public API for this, so each is synced through the same private requests its settings page makes, sent by
the content script **on that chatbot's own site** (same origin, the user's normal cookies, nothing else).

| Chatbot | Where OmniMemory writes | Shape | What it also shows (read-only) |
| --- | --- | --- | --- |
| Gemini | Settings → *Instructions for Gemini* | `items`: one entry per memory. Calls `ListMemories` (`ZKcapf`), `CreateMemory` (`xVRQX`), `UpdateMemory` (`gSnMcd`), `DeleteMemory` (`Ok9j9b`) on `/_/BardChatUi/data/batchexecute`, with the page's `SNlM0e` token. | — |
| ChatGPT | Custom instructions → *More about you* (`other_user_message`) | `block`: one marked block, one line per memory; text outside the markers is never touched. `GET`/`PATCH /backend-api/user_system_messages`. | Other custom-instruction fields, older saved memories (`/backend-api/memories`), and the AI-written Memory summary (`/backend-api/memories/about_you/summary/*`, regenerated only when its checksum changes). |
| Claude | — | Not mapped yet (needs a signed-in session to discover). | — |

Why not ChatGPT's Memory summary? It is regenerated by AI from chat history each time it's opened; a test
correction did not survive regeneration. ChatGPT itself points to custom instructions for "information you'd
like it to always keep in mind".

### One sync

```
content script                      service worker (SyncService)
──────────────                      ────────────────────────────
sync/status ─────────────────────►  blocked? pending? (no network)
read chatbot  (adapter.read)
sync/begin {snapshot} ───────────►  pass 1: plan → apply *pulls* (chatbot-side changes) to MemoryService
                                    pass 2: plan again → ops; take the lock; store snapshot
                    ◄─────────────  {planId, ops}
apply each op (adapter.apply)
read again (light)
sync/commit {planId, results} ───►  record links / failures; release lock
sync/done ───────────────────────►  close the background tab if the scheduler opened one
```

### Rules (`core/sync.ts`, unit-tested in `tests/sync.test.ts`)

1. Only memories passing the normal sharing rule for that chatbot are written. While sharing is paused, or sync
   is off for that chatbot, nothing is written or removed.
2. A memory that stops being shareable (deleted, private, outdated, unshared) is removed from the chatbot;
   restoring it puts it back.
3. OmniMemory-side changes win. Chatbot-side changes to entries OmniMemory put there come back: an edited
   entry edits the memory, a removed entry stops sharing that memory with that chatbot (it isn't deleted).
   Anything else the chatbot remembers is never imported automatically — it goes to Review (below). The one
   exception is a line typed into OmniMemory's own ChatGPT block, which becomes a memory directly.
4. Same-meaning entries (case, spacing, a trailing full stop — Gemini adds one) are never duplicated, and
   don't count as edits.
5. Credentials are never copied in either direction. A write the chatbot refuses is not retried for 6 hours.
6. ChatGPT's field holds 1,500 characters; the most recently used memories are kept and the rest reported.
7. The block parser is damage-tolerant: several blocks, a lost start marker, or marker text inside a line are
   all treated as OmniMemory's, cleaned and de-duplicated, and the field is rewritten in clean form. Marker
   text is never written into a line, and memories that picked some up (an early-version bug) are repaired
   at the start of each sync; a repaired memory that duplicates another goes to Recently Deleted.
8. Snapshot entries with no text (e.g. ChatGPT's "Dive deeper" summary section) are skipped, and a rejected
   message says which field was wrong.
9. **Ownership.** Each link records `owned`: true when OmniMemory created the entry (a `create` result, or a
   line in its own ChatGPT block), false when the chatbot had it first and the user agreed to link it (an
   *adopt*, or a Gemini entry kept from Review). Links saved by older versions have no `owned` and are treated
   as not owned. A create that succeeds without returning an id is remembered (`own:<memoryId>`) so the
   wording match on the next sync links it as owned without asking.
10. **Held changes.** Three kinds of change are never made without the user's OK; the planner puts them in
    `plan.held` instead of `plan.ops`, and the dashboard shows them as *Waiting for your OK*:
    - `first-write` — nothing is written to a chatbot until `approvedAt` is set. The held change carries a
      preview (add / update / remove lines). State saved by older versions that already had links is treated
      as approved.
    - `adopt:<memoryId>:<remoteId>` — an unlinked chatbot entry says the same as a shareable memory. Nothing
      is created or linked while waiting. Yes → linked with `owned: false`. No → left alone, and no copy is
      added while it still matches.
    - `delete:<remoteId>` — removing an entry that isn't owned. Yes → deleted. No → unlinked and left on the
      chatbot (and not offered on Review).
    Decisions are kept in `approved` / `declined` (bounded). `pendingChanges` doesn't count held changes, so
    nothing re-syncs in a loop while it waits.
11. **Activity and undo.** `applyResults` and the pull step append to `activity` (newest last, 100 per
    chatbot): `added`, `updated`, `removed`, `linked`, `edited-there`, `removed-there`, `imported`.
    `SyncService.undo` reverses one by changing the memory in OmniMemory (restore + reshare, revert the text,
    stop sharing, unlink, or move to trash) and lets the next sync put the chatbot back in step.
12. Chatbot sync is **off by default** (`siteSync` all false); turning it on for a chatbot starts a read so the
    first-write preview appears straight away.

### Review: what the chatbots already know (`core/discover.ts`)

At the end of `begin` (and again after `commit` re-reads), `SyncService` builds a checklist from the
snapshot: Gemini entries not linked to a memory, plus everything OmniMemory only reads on ChatGPT (Memory
summary sections, saved memories, other custom-instruction fields). `discover()`:

- splits paragraphs into sentences (Gemini entries and "How ChatGPT should respond" are kept whole);
- rewrites second person / "User …" into first person for summaries and saved memories;
- drops anything under three words (except whole entries), anything that looks like a credential, anything
  `findSimilar` calls a duplicate of an existing memory, and anything kept or skipped before (by `textKey`,
  an FNV-1a hash of the normalised text);
- flags overlaps/contradictions with an existing memory; those start unticked.

The list lives in each chatbot's sync record (`found`, plus `dismissed` and `accepted` keys). The dashboard's
**Review** page calls `SyncService.review(keep, skip)`: kept items become memories (source = that chatbot,
default sharing) — a Gemini entry is linked to its existing entry so it isn't added twice, and a reworded one
updates it — and the usual change notification syncs them to every other chatbot. Skipped items aren't
suggested again until **Bring back skipped suggestions**. The worker shows the count on the toolbar badge.

### When it runs

- On page load of a chatbot tab (if anything is waiting, or the snapshot is older than 15 minutes).
- After any change: the worker listens for `omni:revision`, waits 2.5 s, and for each chatbot with pending
  changes messages an open tab (`omni/sync-now`). With no tab open and *Sync in the background* on, it opens the
  chatbot in an inactive tab, which closes itself after `sync/done` (or after 90 s).
- From the dashboard's **Sync now** (also re-reads everything, including ChatGPT's summary).

### Limits

- These are private endpoints; a site change can break sync. Failures show in the dashboard and never block
  the rest of OmniMemory.
- Sync needs the user to be signed in on that site in this browser profile.

## Search and relevance

- `searchMemories` handles typing in the search box. Every search term must match, and partial words match
  as you type. Matches are scored as exact word > stemmed word > prefix > substring, with a bonus for tags and
  for the whole phrase. Ties go to the most recently updated memory.
- `rankByRelevance` ranks memories against free text, such as the draft plus the last few messages. Stop words
  are removed, words are lightly stemmed, and shared words are weighted by IDF (rarer words count for more). A
  memory is marked "relevant" if it shares ≥ 2 meaningful words with the text, or ≥ 25% of its weighted words.
  Relevant memories are ticked when the panel opens, up to 6.

Both functions take *already filtered* arrays, so deleted or unshared memories can't reach them by mistake.
Swapping in embeddings later only means replacing `rankByRelevance`.

## Security checklist

- Permissions: `storage`, `contextMenus`. Host permissions only for the three chatbot origins (the same ones
  the content scripts already run on; used to find an open chatbot tab to sync).
- Extension-page CSP: `script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
  so the popup, dashboard and worker can't make requests at all.
- Exactly one file makes requests: `src/content/sync/http.ts`, which refuses anything but a same-origin path on
  the chatbot site it runs on. A test checks that no other file in `src/` uses a networking API, and that it
  contains no hard-coded URLs. The build disables Vite's modulepreload polyfill so no other `fetch` sneaks in.
- Sync messages are scoped to the sender's site: a chatbot page can only read or change its own sync state, and
  only ever receives memories it may already see.
- Every content-script message is validated by `parseRequest`: unknown types are rejected, ids must be
  `[A-Za-z0-9_-]{1,64}`, and strings and lists have length limits.
- Credentials, API keys, tokens, private keys, card numbers (Luhn-checked) and SSNs are refused when saved from
  a page or an import. Manual entry warns and requires an explicit override.
- The right-click capture is held in `chrome.storage.session` (cleared when the browser closes, never synced)
  until you review it, and is thrown away after 10 minutes.

## Build

`scripts/build.mjs` runs three Vite passes, because each part of an extension needs a different output format:

1. `popup.html` + `dashboard.html` as a multi-page app (ES modules, shared chunk, Inter font).
2. `background.js` as a single ES module, because MV3 service workers can't load extra chunks.
3. `content.js` as a single classic IIFE script with the panel CSS inlined, because content scripts can't be
   ES modules.

The script then checks that every file the manifest refers to exists.

---

## Optional sync (Supabase)

This isn't implemented in the MVP. Here is how it would fit.

1. **Schema:** a `memories` table with the same fields plus `user_id uuid` and `version int`, protected by
   row-level security (`user_id = auth.uid()`). Settings go in a `settings` table keyed by `user_id`.
2. **Backend:** `SyncedBackend implements StorageBackend` wraps `IndexedDbBackend`. Reads always come from
   local storage. Writes go to local storage first and are added to an outbox store in IndexedDB. A sync loop
   pushes the outbox and pulls changes since the last sync (`updated_at > cursor`).
3. **Conflicts:** compare `version`. If both sides changed the content, keep both and mark the conflict in the
   UI, the same way the rest of the app already avoids overwriting conflicting facts. If only permissions
   changed, the most restrictive value wins.
4. **Deletes:** synced as `status: 'deleted'` (tombstones). Purges sync as hard deletes after 30 days.
5. **Opt-in only:** turned on from Settings with the user's own Supabase project URL and anon key, and
   explicit sign-in. The manifest would need an `optional_host_permissions` entry requested at that moment,
   and the CSP `connect-src` would need that one origin. Nothing changes for users who don't turn it on.
6. **Encryption (recommended):** encrypt `content` and `tags` on the device with a key derived from a
   passphrase (WebCrypto AES-GCM), so the server only stores ciphertext.

## Optional MCP server

For chat apps that support the Model Context Protocol (Claude Desktop and others), a small local MCP server
could expose the same memories. Proposed tools:

| Tool | Input | Behaviour |
| --- | --- | --- |
| `memory_search` | `{ query: string, limit?: number }` | `searchMemories` + `rankByRelevance` over memories shareable with the caller. Returns `{id, content, category, tags, updated_at}`. |
| `memory_save` | `{ content, category?, tags? }` | Runs the sensitive-data check and duplicate detection. Returns `{ saved }` or `{ needs_review: matches }` when it finds a duplicate or conflict. |
| `memory_update` | `{ id, content }` | Edits in place with history. Only for memories the caller can see. |
| `memory_delete` | `{ id }` | Soft delete (goes to the trash). |

**Transport:** the extension can't host a server, so the MCP server would be a small Node process using
`@modelcontextprotocol/sdk` over stdio. It would reach the extension through Chrome **native messaging**
(`connectNative`, an explicit opt-in that requires installing a host manifest). The server would be one more
"site" in the permission model (for example `mcp`, with its own sharing toggle), and all requests would go
through `router.ts`. Writes from MCP could be set to require confirmation in the popup.

## Future: AI-assisted memory extraction

The capture flow is already split into *propose → review → save*:

- `memory/review` returns a suggested category, duplicate and conflict matches, and sensitive-data findings,
  without saving anything.
- The panel and popup always show an editable form before saving.

An extractor would add one function:

```ts
interface MemoryExtractor {
  propose(conversationTail: string): Promise<{ content: string; category?: Category; reason: string }[]>;
}
```

- **Default (free, private):** an on-device model, such as Chrome's built-in Prompt API where available or a
  small WebGPU model, asked to list durable facts about the user from the visible messages.
- **Optional:** a cloud model with the user's own API key, turned on explicitly per provider and shown as
  sending conversation text off the device.
- Every proposal runs through `findSensitive` and `findSimilar` and is shown as an unticked suggestion in the
  panel. Nothing is saved without a click. Extraction runs only when the user asks for it ("Suggest memories
  from this chat"), never in the background, and never scans whole histories.
