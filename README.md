# OmniMemory

One shared, user-controlled memory for **ChatGPT**, **Claude** and **Gemini**, as a Chrome extension.
You keep using each chatbot's own website. OmniMemory adds a small button beside the message box so you
can pick which of your memories to add to a message, and gives you one place to see, edit, share,
hide and delete everything it stores.

- **Local-first.** Memories live in IndexedDB inside this browser profile. There is no OmniMemory account,
  server, paid API or analytics. The extension's own pages are locked down with `connect-src 'none'`.
- **Kept in step with each chatbot's own memory.** Memories you share with Gemini are kept in Gemini's
  *Instructions for Gemini*; memories you share with ChatGPT are kept in a marked block in ChatGPT's custom
  instructions. Add, edit or delete one in OmniMemory and the chatbot is updated; change it on the chatbot
  and OmniMemory picks that up. The dashboard's **Chatbot memory** page shows what each chatbot currently
  remembers, and has an on/off switch per chatbot. This is the only network traffic, and it goes only to
  that chatbot's own site, using your normal sign-in.
- **Review what your chatbots already know.** Every sync also digs through what each chatbot remembers —
  Gemini's instructions, ChatGPT's AI-written memory summary, saved memories and custom instructions — and
  lists anything OmniMemory doesn't have yet on the dashboard's **Review** page, rephrased as short notes
  ("You program VEX robots" → "I program VEX robots"). Tick what you want, reword anything, press
  **Keep and sync**, and those become memories that sync to your other chatbots. Nothing is imported
  without your say-so; the toolbar icon and popup show how many are waiting.
- **You stay in control.** Every memory has its own sharing switches per chatbot plus "keep private".
  You can also pause sharing everywhere or for one chatbot.
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

After changing the code, run `npm run build` again and click the reload ↻ button on the extension's card.
Reload any open chatbot tabs too, because they keep running the old content script until you do.

---

## Test it yourself

### Automated tests

```bash
npm test
```

There are 142 tests in 11 files. They run the real IndexedDB storage layer (using `fake-indexeddb`) and the
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
| `tests/sync.test.ts` | Chatbot memory sync against fake Gemini and ChatGPT that behave like the real ones: add/edit/delete/restore, edits and removals made on the chatbot coming back, no duplicates, credentials never copied, pause and per-chatbot switch, refused writes, one tab at a time, ChatGPT's 1,500-character limit, parsing replies captured from the real sites |
| `tests/discover.test.ts` | The Review checklist: splitting and rephrasing what chatbots remember, skipping what you already have and credentials, conflict flags, keep (with edits) / skip / bring back skipped, a kept Gemini entry not being added twice |
| `tests/no-network.test.ts` | Only one file may make requests and only to the chatbot site itself, no HTML injection, minimal manifest permissions |

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
9. **No paid API, no server.** Open `chrome://extensions`, find OmniMemory and click **service worker**,
   then open the Network tab in DevTools. Use the extension and the tab stays empty. (Sync requests are made
   from the chatbot tab itself; see the next section.)

### Testing chatbot memory sync

Be signed in to ChatGPT and Gemini in the Chrome profile where OmniMemory is installed.

1. Open the dashboard → **Chatbot memory**. ChatGPT and Gemini show **Keep in sync** on.
2. Save a memory in the popup, e.g. `I program VEX robots using PROS and LemLib`. Within a few seconds
   OmniMemory syncs: if a ChatGPT or Gemini tab is open it does it there, otherwise it briefly opens one in
   a background tab and closes it again.
3. Check Gemini: https://gemini.google.com/saved-info shows the memory (Gemini adds a full stop).
4. Check ChatGPT: Settings → Personalization → Custom instructions → **More about you** shows a block
   starting `[OmniMemory — edit these in the OmniMemory extension]` with the memory on its own line.
   Anything else you wrote in that field is kept.
5. Back on **Chatbot memory**, both cards say **In sync** and list what each chatbot remembers, including
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
9. Turn **Keep in sync** off for a chatbot → nothing more is written there. Turn off **Sync in the
   background** to sync only while you have the chatbot open.

To watch the requests: open DevTools on the chatbot tab → Network. You'll see calls to that same site only
(`chatgpt.com/backend-api/user_system_messages`, `gemini.google.com/_/BardChatUi/data/batchexecute`).

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
  your password or session. Turn it off per chatbot under **Chatbot memory**. Only one file in the code can
  make requests, and it refuses anything but the chatbot site it's running on.
- Chatbot pages can't read the database. They have to ask the service worker, which only returns memories
  that are shared with that site and not paused, deleted, private or outdated. The site is identified from
  the browser's own record of which page sent the request, so a page can't claim to be a different site.
- Nothing from the page is read until you open the panel. When you do, your draft and the last few visible
  messages are read once to rank suggestions. They are not stored, and you can turn this off in
  **Settings → Suggestions**.
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
- **Claude sync isn't available yet.** Claude's memory settings need a signed-in session to map, which hasn't
  been done. The on-page button and Insert context work on Claude as before.
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

- Claude memory sync, once its settings requests are mapped.
- Optional sync between devices through Supabase or another backend behind the existing `StorageBackend`
  interface ([design](docs/ARCHITECTURE.md#optional-sync-supabase)).
- An MCP server exposing `memory_search`, `memory_save`, `memory_update` and `memory_delete` for chat apps that
  support MCP ([design](docs/ARCHITECTURE.md#optional-mcp-server)).
- Opt-in AI-assisted memory suggestions from a conversation, always reviewed before saving
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
