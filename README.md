# OmniMemory

One shared, user-controlled memory for **ChatGPT**, **Claude** and **Gemini**, as a Chrome extension.
You keep using each chatbot's own website. OmniMemory adds a small button beside the message box so you
can pick which of your memories to add to a message, and gives you one place to see, edit, share,
hide and delete everything it stores.

- **Local-first.** Memories live in IndexedDB inside this browser profile. There is no OmniMemory account,
  server or analytics. The extension's own pages can connect to one address only — Google's Gemini API —
  and only if you turn on the AI assistant with your own key.
- **Optional AI assistant (Gemini 3.5 Flash Lite, your own key).** Off until you add a key under
  **Settings → AI assistant**. Then:
  - **Repeat check when saving.** Before a memory is saved, Gemini checks it against the ones you have and
    flags rewordings the text rules miss ("I use the metric system" vs "I prefer metric units") and
    contradictions ("I just moved to Texas" vs "I live in Ohio"). Saving still keeps both if you say so.
  - **Assistant (Gemini 3.5 Flash).** A chat page for changing your memories by asking: "remove the
    repeats", "I moved to Austin", "merge everything about robotics", "what do you know about me?". It
    proposes adds, rewordings and removals as a checklist; nothing changes until you press **Apply**, and
    **Undo** puts everything back. When Flash is overloaded, Flash Lite answers instead (and says so).
  - **Find repeats.** One button on the library reads all your memories and lists groups that repeat each
    other (with a merged wording; **Merge all** in one click) or contradict each other (**Keep this**).
    Merged extras go to Recently Deleted.
  - **Tidy imports.** The Review page turns everything ChatGPT, Claude and Gemini remember into one clean
    list: first-person, one fact each, duplicates across chatbots combined, things you already have set
    aside, categories filled in, contradictions flagged and left unticked. Nothing is hidden: what Gemini set
    aside or left out stays one click away, and **Original list** shows the plain version.
  Private memories and anything that looks like a password are never sent. Every AI result is a suggestion
  you accept or not.
- **Kept in step with each chatbot's own memory.** Memories you share with Gemini are kept in Gemini's
  *Instructions for Gemini*; memories you share with ChatGPT or Claude are kept in a marked block in
  ChatGPT's custom instructions or Claude's *Instructions*. Add, edit or delete one in OmniMemory and the chatbot is updated; change it on the chatbot
  and OmniMemory picks that up. The dashboard's **Chatbots** page shows what each chatbot currently
  remembers, and has an on/off switch per chatbot. This is the only network traffic, and it goes only to
  that chatbot's own site, using your normal sign-in.
- **Sync asks before it does anything risky.** It's off until you turn it on for a chatbot, and the first
  time it shows exactly what it would add before writing anything. OmniMemory remembers which chatbot
  entries it created: if a chatbot already had something that matches one of your memories, it asks before
  linking it, and it never removes an entry the chatbot had first without asking. Anything waiting for your OK
  shows on the toolbar icon (amber) and in the popup. **Approve all N for ChatGPT/Claude/Gemini** answers
  everything for one chatbot in one click, and on the Review page **Keep all** keeps everything found on one
  chatbot; you can still go through them one by one.
- **Every change is logged and can be undone.** Each chatbot's card has a **Recent activity** feed — added,
  updated, removed, linked, edited on the chatbot — with one-click undo (**Put back**, **Change back**,
  **Take off**, **Unlink**…).
- **Review what your chatbots already know.** Every sync also digs through what each chatbot remembers —
  Gemini's instructions, ChatGPT's and Claude's AI-written memory summaries, saved memories and custom
  instructions — and
  lists anything OmniMemory doesn't have yet on the dashboard's **Review** page, rephrased as short notes
  ("You program VEX robots" → "I program VEX robots"). Tick what you want, reword anything, press
  **Keep and sync**, and those become memories that sync to your other chatbots. Nothing is imported
  without your say-so; the toolbar icon and popup show how many are waiting.
- **You stay in control.** Every memory has its own sharing switches per chatbot plus "keep private".
  You can also pause sharing everywhere or for one chatbot.
- **A welcome tour that shows, not tells.** On first install the dashboard opens with a short tour of animated
  demos: a pretend cursor saves a note from the toolbar, saves a sentence from a web page, inserts memories
  into a chat, flips a memory's sharing switches, and approves a first sync into Claude's instructions. The
  last steps have a switch per chatbot to turn on sync right there (still previewed before anything is
  written). With "reduce motion" on, each demo shows its end state instead. **Settings → Help → Take the
  tour again** brings it back.
- **No message is ever sent for you.** Context goes into the message box only when you press
  **Insert context**. If insertion fails, the context is copied to your clipboard instead.

---

## Install it in Chrome

Requirements: Node 20+ and Chrome 120+ (or another Chromium browser such as Edge or Brave).

```bash
npm install
```

```bash
npm run build
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist` folder in this project.
4. Pin OmniMemory from the puzzle-piece menu so its icon is always visible.

On a fresh install the dashboard opens with the welcome tour. (Reloading an unpacked extension doesn't count as
a fresh install; open `dashboard.html#/welcome` or use **Settings → Take the tour again** to see it.)

After changing the code, run `npm run build` again and click the reload ↻ button on the extension's card.
Reload any open chatbot tabs too, because they keep running the old content script until you do.

---

## Test it yourself

### Automated tests

```bash
npm test
```

There are 170 tests in 13 files. They run the real IndexedDB storage layer (using `fake-indexeddb`) and the
same message router the content scripts talk to, so they cover the parts that decide what a chatbot can see.

| File | What it covers |
| --- | --- |
| `tests/acceptance.test.ts` | Acceptance criteria 2–10 end to end: save → retrieve on all three sites → edit once and see it everywhere → unshare Gemini only → delete → restore → export |
| `tests/router.test.ts` | Message validation, mapping the sender to a site, permission enforcement, blocking a site from editing or deleting memories it can't see, credential refusal |
| `tests/service.test.ts` | Create/edit in place, history, outdated, bulk changes, trash, restore, 30-day expiry, merge |
| `tests/search.test.ts` | Instant search and conversation-relevance ranking |
| `tests/duplicates.test.ts` | Duplicate and conflict detection, credential detection, category suggestions |
| `tests/import-export.test.ts` | Export format, round-trip import, plain-text/JSON import, review rules, context building |
| `tests/insert.test.ts` | How text gets into the message box: textarea, paste, `execCommand`, fallthrough, failure leading to Copy |
| `tests/permissions.test.ts` | Sharing rules and global/per-site pause |
| `tests/sync.test.ts` | Chatbot memory sync against fake Gemini, ChatGPT and Claude that behave like the real ones: add/edit/delete/restore, edits and removals made on the chatbot coming back, no duplicates, credentials never copied, pause and per-chatbot switch, refused writes, one tab at a time, ChatGPT's 1,500-character limit and Claude's 6,000-character block, parsing replies captured from the real sites, off by default and first-write preview, asking before linking or removing an entry the chatbot had first, the activity log and undo |
| `tests/discover.test.ts` | The Review checklist: splitting and rephrasing what chatbots remember, skipping what you already have and credentials, conflict flags, keep (with edits) / skip / bring back skipped, a kept Gemini entry not being added twice |
| `tests/no-network.test.ts` | Only two files may make requests: the chatbot-sync one (same site only) and the Gemini client (one fixed Google address, key in a header); chatbot pages can't reach the AI client or key; no HTML injection; minimal manifest permissions |
| `tests/repeat-loop.test.ts` | The repeat loop a real user hit: ChatGPT's re-worded summary and remarks about past chats ("you've asked how to tune PID") aren't offered again as new memories |
| `tests/ai.test.ts` | The AI assistant against a pretend model: private, deleted and credential-like memories are never sent, the key stays out of settings and exports, replies are mapped back safely (bad indexes, unknown kinds and secret-looking text ignored), imports combine duplicates and nothing found is silently dropped |

`npm run typecheck` runs the TypeScript checks without building.

### Manual walkthrough (about 10 minutes)

These steps follow the acceptance criteria. You need to be signed in to at least two of the chatbots.

1. **Save a memory.** Click the OmniMemory toolbar icon, then **Save memory**. Type
   `I program VEX robots using PROS and LemLib` and save it. The header now says "1 memory stored on this device".
2. **Retrieve it on ChatGPT.** Open https://chatgpt.com and start a new chat. A small OmniMemory button
   appears just above the right end of the message box (or press **Alt+Shift+M**). Click it. Your memory
   is listed. If your draft or the chat mentions something like "my VEX robot", it appears under
   "Suggested for this chat" and is already ticked.
   Tick it, expand **Preview what ChatGPT will receive**, then click **Insert context**. The text appears in
   the message box and is not sent. Delete it or send it, whichever you prefer.
3. **Retrieve it on Claude or Gemini.** Do the same on https://claude.ai or https://gemini.google.com.
4. **Edit once, see it everywhere.** In the popup, click the memory text, change it to
   `I program VEX V5 robots using PROS and LemLib`, and save. Reopen the panel on any chatbot tab. It shows
   the new wording, and it's still one memory, not two.
5. **Stop sharing with Gemini only.** Click **Manage all memories**. In the memory's row, click the blue
   Gemini dot so it turns hollow. On Gemini the panel no longer lists the memory. ChatGPT and Claude still do.
6. **Delete it.** Click the trash icon and confirm. It disappears from every chatbot panel and every search.
7. **Restore it.** In the dashboard, open **Recently Deleted** and click **Restore**. It comes back with its
   sharing settings unchanged, so it's still off for Gemini.
8. **Export.** Go to **Settings → Your data → Export** to download `omnimemory-export-YYYY-MM-DD.json`.
9. **No server.** Open `chrome://extensions`, find OmniMemory and click **service worker**, then open the
   Network tab in DevTools. Use the extension and the tab stays empty. (Sync requests are made from the
   chatbot tab itself; see the next section. With the AI assistant on, the dashboard and popup also call
   `generativelanguage.googleapis.com`.)

### Testing the AI assistant

The dashboard sidebar is **Memories · Assistant · Review · Chatbots · Settings**; categories are chips at the
top of Memories, extra filters sit behind **Filters**, and **Recently deleted** is at the bottom of the sidebar.

1. **Settings → AI assistant**: paste a Gemini API key (from https://aistudio.google.com/apikey) and press
   **Save key**. It's tested with a tiny request first, then the switch turns on.
2. Add `I prefer metric units`, then try to save `I use the metric system for everything` → a Sparkles notice
   says you already have it, and the button reads **Save anyway**.
3. Add two memories that say the same thing in different words, then press **Find repeats** on the library →
   they're grouped with a merged wording. **Merge all** merges every group; the extras are in Recently Deleted.
4. **Assistant:** ask "Remove repeats and tidy up my memories". After a few seconds (longer when Gemini is
   busy) it lists the changes. Untick any you don't want, press **Apply**, then try **Undo**.
5. With chatbot sync on and something to review, open **Review** → after a second or two Gemini's tidy list
   appears. Things that two chatbots both remember show as one item ("Claude · Gemini · combined 2").

### Testing chatbot memory sync

Be signed in to ChatGPT, Claude and Gemini in the Chrome profile where OmniMemory is installed.

1. Open the dashboard → **Chatbots** and turn **Keep in sync** on for ChatGPT, Claude and Gemini (it's off
   for new installs). OmniMemory reads each chatbot, then shows **Waiting for your OK** with a preview of
   what it would add. Nothing has been written yet. Press **Looks good, start syncing**.
2. Save a memory in the popup, e.g. `I program VEX robots using PROS and LemLib`. Within a few seconds
   OmniMemory syncs: if a ChatGPT or Gemini tab is open it does it there, otherwise it briefly opens one in
   a background tab and closes it again.
3. Check Gemini: https://gemini.google.com/saved-info shows the memory (Gemini adds a full stop).
4. Check ChatGPT: Settings → Personalization → Custom instructions → **More about you** shows a block
   starting `[OmniMemory — edit these in the OmniMemory extension]` with the memory on its own line.
   Anything else you wrote in that field is kept.
   Claude: Settings → Your Claude → **Instructions** shows the same block after anything you wrote there.
5. Back on **Chatbots**, both cards say **In sync** and list what each chatbot remembers, including
   ChatGPT's own AI-written *Memory summary* (shown read-only, with **Add to OmniMemory**).
6. Edit the memory in OmniMemory → both chatbots show the new wording. Turn off its Gemini dot → it's removed
   from Gemini only. Delete it → it's removed from both. Restore it → it comes back.
7. Edit or remove the entry on Gemini's page, then press **Sync now** → OmniMemory has the edit, or has stopped
   sharing that memory with Gemini.
8. **Review:** add a new instruction directly in Gemini (e.g. `I prefer metric units`), then open the dashboard
   → **Review** and press **Scan chatbots now**. It's listed under *From Gemini*, along with anything from
   ChatGPT's Memory summary that OmniMemory doesn't have. Click a line to reword it, untick what you don't
   want, then **Keep and sync**. The kept items appear in your library and, a few seconds later, in ChatGPT's
   custom instructions; the Gemini one isn't added to Gemini a second time. Unticked items won't be suggested
   again (**Bring back skipped suggestions** undoes that).
9. **Asking first:** add `I prefer metric units` directly in Gemini, then save the same note in OmniMemory.
   Gemini's card asks **Gemini already has this** instead of adding a copy. Choose **Leave Gemini's alone**
   and then delete the note → Gemini's instruction is untouched. Or choose **Link them**, then delete the
   note → the card asks **Remove this from Gemini?** before touching it.
10. **Undo:** delete a synced memory, then under **Recent activity** press **Put back** on the *Removed from
    Gemini* row → it's restored and re-added at the next sync.
11. Turn **Keep in sync** off for a chatbot → nothing more is written there. Turn off **Sync in the
   background** to sync only while you have the chatbot open.

To watch the requests: open DevTools on the chatbot tab → Network. You'll see calls to that same site only
(`chatgpt.com/backend-api/user_system_messages`, `claude.ai/api/account_profile`,
`gemini.google.com/_/BardChatUi/data/batchexecute`).

Other things worth trying:

- **Save from a page:** select text on any website, right-click it and choose **Save selection to OmniMemory…**.
  You review it before it's saved. On a chatbot tab you can also select text and open the panel, which offers
  **Save as memory…**.
- **Duplicates and conflicts:** save `I use Python 3.11` and then `I use Python 3.13`. You get a conflict warning,
  and both are kept. Near-identical memories produce a "look like duplicates" banner in the dashboard with a
  **Review** (merge) button.
- **Credentials are refused:** try saving `my password is hunter2!` from a chatbot panel.
- **Pause:** turn off the switch at the top of the popup. Every panel then says sharing is paused.
- **Import:** go to **Settings → Import…** and paste a bulleted list. You can ask a chatbot "list everything you
  remember about me" and paste its answer.
- **Themes:** **Settings → Appearance**. The on-page panel follows the chatbot site's own light or dark theme.

### Try the on-page panel without signing in

A development fixture recreates each chatbot's message box with the same kind of editor the real site uses
(a textarea or ProseMirror for ChatGPT, ProseMirror for Claude, Quill for Gemini). It runs the real adapter
and panel code.

```bash
npm run dev
```

- Fixture: http://localhost:5183/dev/fixture.html?site=chatgpt (also `site=claude`, `site=gemini`, plus
  `&theme=light` and `&editor=prosemirror`)
- Popup: http://localhost:5183/popup.html
- Dashboard: http://localhost:5183/dashboard.html

In dev mode the pages share a database at `localhost`. That database is separate from the installed
extension's.

---

## Project structure

```
public/manifest.json        MV3 manifest: storage + contextMenus permissions, three content-script matches
popup.html, dashboard.html  Page entry points
src/
  core/                     Pure logic. No DOM or chrome.* APIs, so it runs in the worker, the pages and the tests
    types.ts                Memory and Settings model, limits
    service.ts              MemoryService: CRUD, history, outdated, trash/restore/purge, merge, settings
    backend.ts              StorageBackend interface (+ in-memory reference implementation)
    indexeddb-backend.ts    IndexedDB implementation (the only persistence in the MVP)
    search.ts               Instant search and relevance ranking
    permissions.ts          The single rule for "may this memory go to this chatbot?"
    duplicates.ts           Duplicate and conflict heuristics
    sensitive.ts            Credential and card-number detection
    context.ts              Builds the plain-text context block
    import-export.ts        Export file, import parsing and review
    categorize.ts           Keyword category suggestions
    sync.ts                 Chatbot memory sync rules (pure planner)
    sync-service.ts         Runs a sync: begin → (tab writes) → commit, one tab at a time; keep/skip for Review
    discover.ts             Turns what a chatbot remembers into Review suggestions (split, rephrase, dedupe)
  shared/
    messages.ts             Content-script ↔ worker protocol and validation
    sites.ts                Supported chatbot registry, URL → site mapping
    change-bus.ts           Notifies every open view to refresh after a change
    platform.ts             Shared service instance, opening the dashboard, pending captures
  background/
    index.ts                Service worker: message routing, context menu, trash expiry
    router.ts               Validated request handler that enforces permissions
    sync-scheduler.ts       Decides when a chatbot is behind; asks a tab (or a background tab) to sync
  content/
    index.tsx, mount.tsx    Content script entry; mounts the UI in a closed shadow root
    adapters/               One adapter per chatbot built on a common SiteAdapter interface
    insert.ts               Composer insertion strategies with verification
    sync/                   Chatbot memory sync: Gemini + ChatGPT adapters, runner, the one request helper
    bridge.ts, clipboard.ts Messaging to the worker; copy fallback
    ui/                     The on-page button and panel (React + scoped CSS)
  popup/                    Toolbar popup
  dashboard/                Memory manager: library, review, chatbot memory, trash, settings, merge, import
  ui/                       Shared design tokens (Tailwind), components, hooks
tests/                      Vitest suites (see above)
dev/                        Dev-only chatbot fixture (not part of the build)
scripts/build.mjs           Three-pass production build → dist/
scripts/make-icons.mjs      Generates the toolbar icons
docs/ARCHITECTURE.md        Design, data flow, security model, future plans
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and how sync, an MCP server
and AI-assisted extraction would be added.

---

## Privacy

- OmniMemory's data stays in this browser profile on this device. **It does not sync between devices or
  browsers**, and removing the extension deletes OmniMemory's copy. Export first if you want one.
- **Chatbot memory sync** writes the memories you share with ChatGPT or Gemini into that chatbot's own memory
  settings, and reads what those settings hold so the dashboard can show it. It runs in the chatbot's tab,
  talks only to that chatbot's site, and uses your existing sign-in there; OmniMemory never sees or stores
  your password or session. Turn it off per chatbot under **Chatbots**. Only one file in the code can
  make requests, and it refuses anything but the chatbot site it's running on.
- Chatbot pages can't read the database. They have to ask the service worker, which only returns memories
  that are shared with that site and not paused, deleted, private or outdated. The site is identified from
  the browser's own record of which page sent the request, so a page can't claim to be a different site.
- Nothing from the page is read until you open the panel. When you do, your draft and the last few visible
  messages are read once to rank suggestions. They are not stored, and you can turn this off in
  **Settings → Suggestions**.
- **The AI assistant** (off by default) sends memory text to Google's Gemini API with your own key: the
  memory being saved plus your other shareable memories for the repeat check, your shareable memories for
  Find repeats, and what the chatbots remember for the Review page. Private memories, deleted ones and anything
  that looks like a password are never sent. Google's terms for your key apply (free keys may be used to
  improve Google's products). The key is stored in the extension's own database, outside settings and exports,
  and chatbot pages can't read it.
- Memory text is always displayed as plain text, never HTML. The on-page UI lives in a closed shadow root, so
  the page's scripts and styles can't reach into it.
- Sync only touches the parts listed above: Gemini's Instructions, and OmniMemory's own marked block in
  ChatGPT's "More about you". ChatGPT's AI-written Memory summary and your other custom instructions are only
  read, never changed.

---

## Known limitations

- **Site markup changes.** The adapters depend on each site's page structure. On 2026-11-13 the signed-out
  ChatGPT and Gemini pages were checked: ChatGPT's message box is a `<textarea id="mobile-composer-prompt">`,
  and Gemini's is a Quill editor in `<rich-textarea>`. Insertion was confirmed working on both. Claude's
  signed-in composer couldn't be checked without logging in, so its adapter relies on ProseMirror selectors
  plus generic fallbacks. If a site redesign breaks insertion, **Copy** still works, and fixing it usually
  means updating one selector list in `src/content/adapters/`.
- **Insertion uses simulated typing or pasting**, which some editors may ignore in the future. Every insertion
  is checked by reading the message box back. If the text isn't there, the context is copied to your clipboard
  and you're asked to paste it.
- **Relevance is keyword-based** (weighted word overlap with light word-stemming), not semantic. "Car" won't
  match "vehicle".
- **Duplicate and conflict detection is heuristic.** It catches reworded duplicates, changed numbers and
  negations, but not every contradiction.
- **Chatbot memory sync uses the sites' private web requests.** None of the three chatbots offers an official
  way for other apps to change its memory, so OmniMemory uses the same requests their settings pages use
  (checked against the live sites on 2026-11-14). A site update can break this; when it does, the dashboard
  shows an error and everything else keeps working. Some chatbots may also consider this kind of automation
  against their terms; you can turn sync off at any time.
- **Claude sync writes to Instructions, not to Claude's Memory.** Claude's Memory is written by Claude from your
  chats and changed by asking it in words, with no way to add or remove one entry, so OmniMemory only reads it
  (for the dashboard and Review). The write (`PUT /api/account_profile`) was checked against a real account on
  2026-11-15: it changes only the Instructions field and shows up in Claude's settings. A Claude tab that was
  already open keeps showing the old Instructions until you reload it, and saving from that stale page would
  overwrite OmniMemory's block (OmniMemory then treats it as an edit made on Claude). OmniMemory's block in
  Claude's instructions is capped at 6,000 characters.
- **ChatGPT's custom instructions hold 1,500 characters.** If your shared memories don't all fit, the most
  recently used ones are kept and the dashboard says how many were left out. ChatGPT's Memory summary is
  rewritten by ChatGPT from your chats, so OmniMemory shows it but doesn't write to it.
- **Sync needs a tab.** Requests are made from the chatbot's own site, so with no tab open OmniMemory opens one
  in the background for a few seconds (or waits until you visit, if you turn that off).
- **No sync between devices.** Each browser profile has its own memory set.
- **The right-click save** opens the popup when Chrome allows it. Otherwise it opens the dashboard with a
  review dialog.
- Chrome only for now. Firefox would need small manifest changes.

## Future improvements

- Optional sync between devices through Supabase or another backend behind the existing `StorageBackend`
  interface ([design](docs/ARCHITECTURE.md#optional-sync-supabase)).
- An MCP server exposing `memory_search`, `memory_save`, `memory_update` and `memory_delete` for chat apps that
  support MCP ([design](docs/ARCHITECTURE.md#optional-mcp-server)).
- AI-assisted memory suggestions from a conversation, always reviewed before saving (the AI assistant's
  plumbing is in place; this would be one more prompt)
  ([design](docs/ARCHITECTURE.md#future-ai-assisted-memory-extraction)).
- Local embeddings for semantic relevance.
- More providers (Perplexity, Copilot, Mistral Le Chat): add one adapter, one entry in `sites.ts` and one
  manifest match.
- Undo history in the editor using the stored edit history.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check, then build the extension into `dist/` |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | TypeScript only |
| `npm run dev` | Dev server for the popup, dashboard and chatbot fixture |
| `npm run icons` | Regenerate `public/icons/*.png` |
