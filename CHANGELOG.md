# Changelog

`PiStudio` — a browser + desktop GUI for [pi](https://pi.dev). The backend
(`server.js`) is zero-dependency plain Node; the frontend is React + TypeScript +
Vite + Tailwind (`src/` → built into `dist/`), with Electron only for the
optional desktop shell.

This file was written after the fact from the build history, so the dates are the
local days the work happened rather than tagged releases. Newest first.

- **Run (browser):** `./start.sh` → http://127.0.0.1:4173/
- **Run (desktop):** `npm install && ./start-desktop.sh`
- **Package (macOS):** `npm run package` → `.app` + `.dmg` in `release/`
- **Tests:** `npm test` (`dev/react-smoke.mjs`, real headless Chrome)

---

## 2026-10-14 — promote-all + per-task budget

### Added
- `POST /api/tasks/:id/promote-all` — apply every isolated agent's changes to the
  working tree in one call, with per-agent conflict reporting; non-conflicting
  agents still land.
- per-task **budget**: `POST /api/tasks` takes `budget: { cost?, tokens? }`; when
  the task's summed spend crosses it the server stops the remaining agents and
  marks `budgetExceeded`. Tasks expose `budget`, `spend`, `budgetExceeded`.
- the tasks board: budget inputs in the launcher, a spend/budget line, a
  "budget exceeded" badge, and a **Promote all** button.

---

## 2026-10-14 — per-agent git worktree isolation

### Added
- task agents now run in their **own git worktree** (branch
  `pistudio/<task>/<agent>`) when the task's directory is a git repo, so parallel
  agents cannot overwrite each other. `POST /api/tasks` takes `isolate:false` to
  opt out; non-repo dirs fall back to the shared tree.
- `GET /api/tasks/:id/agents/:aid/diff` (changed files + unified diff),
  `POST /api/tasks/:id/agents/:aid/promote` (apply that agent's changes to the
  working tree with `git apply --3way`, reporting conflicts), and
  `POST /api/tasks/:id/cleanup` (remove the task's worktrees).
- the tasks board shows a worktree badge with **Diff** and **Promote** actions.
- `worktree.js` — pure git-worktree helpers (create / diff / promote / remove).

---

## 2026-10-14 — usage trends, run history, per-agent control

### Added
- **usage trends**: `/api/usage` now returns `prev` (the previous equal-length
  window), and the dashboard shows ↑/↓ deltas for cost, tokens and turns.
- **run history**: `traces/run-*.jsonl` are indexed into the `runs` table and
  exposed at `GET /api/runs?limit=` (started/ended, model, turns, tokens, cost);
  the dashboard lists recent runs.
- **per-agent control** in the task board: `POST /api/tasks/:id/agents/:aid/stop`
  and `/restart` (respawn with the same spec), plus a **Compare** overlay that
  line-diffs two agents' answers.

### Changed
- task agents keep their originating spec so they can be restarted; a replaced
  process can no longer clobber the new agent's state on exit.

---

## 2026-10-14 — SQLite index + usage dashboard

### Added
- **zero-dependency SQLite index** (`db.js`, Node's built-in `node:sqlite`): an
  FTS5 index over every session's metadata **and full transcript**, with a no-op
  fallback when `node:sqlite` is missing (Node <22.5) or `--no-index` is set.
  JSONL stays the source of truth; the DB (`~/.pistudio/index.db`) is derived and
  rebuildable.
- **`/api/search` now uses the index** when available (full-transcript FTS5 with
  snippets), falling back to the old file grep. Same response shape.
- **Usage & spend dashboard** (toolbar + ⌘K): cost, tokens and turns per day, per
  model and per workspace — `GET /api/usage`, `GET /api/index/status`,
  `POST /api/index/rebuild`.
- **agent tasks are persisted** to the index when they finish, so races survive a
  restart.
- `shot-usage.png` + a **Usage & spend** README section (en/zh).

---

## 2026-10-14 — agent task runtime (orchestration groundwork)

### Added
- **agent tasks** — a runtime for spawning a *group* of `pi` processes the GUI
  owns, independent of any browser tab. `POST /api/tasks` fans one prompt out to
  several agents, each with its own `--model` / `--append-system-prompt` /
  `--tools` / `--thinking`, with lifecycle (`running`/`idle`/`stopped`/`done`),
  per-agent SSE and buffered replay. Endpoints: `GET|POST /api/tasks`,
  `GET /api/tasks/:id`, `GET /api/tasks/:id/events`,
  `POST /api/tasks/:id/agents/:aid/command`, `POST /api/tasks/:id/stop`,
  `DELETE /api/tasks/:id`.
- a throwaway **`/tasks`** debug board (`dev/task-debug.html` + `dev/task-debug.js`)
  to launch agents and watch them stream — no build step.

> Groundwork for the orchestration views. Separate from the existing
> **Inspector → Agents** view, which only *observes* pi's own `subagent` example
> extension (see **Sub-agents**).

---

## 2026-10-14 — open-source hygiene: npm package, CI, install guide

### Added
- **CI** (`.github/workflows/ci.yml`): `npm run typecheck` + `npm run build` on
  Node 20 and 22, then the headless-Chrome smoke test (`npm run test:quick`) on
  Node 22. Electron's binary download is skipped since neither job needs it.
- **`INSTALL.md`** — install from npm, from source, the macOS app bundle, plus
  update/uninstall and troubleshooting.
- **`LICENSE`** (MIT) and `docs/reddit-draft.md` (launch copy, not posted).
- **`dev/make-screenshots.mjs`** — regenerates `dev/shot-*.png` from the **React**
  UI (throwaway server + headless Chrome, driven through the DOM and the
  `pi-gui:*` events). The old `legacy/dev/make-screenshots.mjs` only drove the
  retired vanilla frontend, so every README screenshot was the old UI; all 24
  are regenerated now.
- **npm publishing metadata**: `bin` (installs `pistudio` and the `pigui` alias),
  a `files` allowlist, `engines`, `repository`/`homepage`/`bugs`, `keywords`,
  `publishConfig` and a `prepublishOnly` frontend build.

### Changed
- **the launcher moved `bin/` → `cli/`**, so the repository no longer has a `bin/`
  directory; it is wired into `package.json`'s `bin` field, which means
  `npm install -g pistudio` puts the command on `PATH` directly (no more manual
  `npm run link` required).
- **repository cleanup** — removed the unrelated `模板/` template (513 MB of
  untracked `node_modules` plus its tracked sources), `neobrutalist-ui-design/`
  and its `.zip`, and `demo.html`; they were only ever excluded at packaging time.
- README (en/zh) updated for `cli/` and the npm install flow; `dev/package.mjs`
  ignores refreshed.
- **both READMEs restyled** — centered header with status badges, a hero shot,
  Quick start up top, a scannable Highlights grid, a linked table of contents,
  and the long feature list collapsed behind a `<details>`. Also fixed the
  **Trace** feature block that had been stranded under `## Sub-agents`.

---

## 2026-10-13 — renamed to PiStudio + packaging fixes

### Changed
- **the project is now `PiStudio`** (was `pi-gui`): window/app title, `README`,
  `package.json`, the macOS bundle (`PiStudio.app`, bundle id `dev.pistudio`) and
  the `.dmg` name. The CLI command is `pistudio` (`pigui` kept as an alias).
  Internal identifiers (`pi-gui:*` events, `pi-gui-*` localStorage keys,
  `x-pi-gui-token`, `PI_GUI_*` env vars) are unchanged.

### Fixed
- **`pistudio --help`** prints usage instead of launching the GUI; when stdout is
  not a terminal the launcher detaches, so tools/scripts are not blocked until the
  window is closed.
- **macOS packaging** now ad-hoc signs the `.app` (`codesign --force --deep
  --sign -`). Without it the bundle kept only the linker's ad-hoc signature and
  macOS refused to launch it (`bootstrap_look_up …MachPortRendezvousServer:
  Permission denied`).

### Added
- **`README.zh-CN.md`** — a Simplified Chinese translation, with a language
  switcher in both READMEs.

---

## 2026-10-12 — the frontend is React now

### Added
- **the UI is React + TypeScript + Vite + Tailwind + shadcn/ui** (`src/`). Vite
  builds it into `dist/`, which `server.js` serves in both the browser and the
  Electron shell. The backend protocol is untouched.
- full feature parity with the retired vanilla UI: chat with streaming
  text/thinking + Markdown/code highlighting, tool cards (args/output), image
  attachments, `@`-file and `/`-command autocomplete, input history + draft
  persistence, edit & resend / retry (fork + prefill), trace-jump chips, the
  model/thinking picker, the session sidebar (workspace/time grouping,
  collapsible groups, content search), the sessions modal (live tree + saved-list,
  rename / clone / export HTML / fork / bookmark / delete), the right-hand dock
  (trace / changes / context-inspector, resizable), extension-UI dialogs, toasts,
  widgets, the ⌘K command palette, settings (comfortable/compact transcript),
  light/dark/system theme, en/zh i18n, desktop notifications, steering/follow-up
  queue status, and diagnostics
- **`dev/react-smoke.mjs`** + `npm test` / `npm run test:quick`: a self-contained
  end-to-end smoke test — starts its own server and headless Chrome, drives the
  real UI over CDP, uses language-agnostic selectors (structure / ARIA / lucide
  class names) and exits non-zero on failure, so it doubles as a CI gate
- **macOS packaging**: `npm run package` produces `release/pi GUI-darwin-<arch>/`
  and `pi-gui-<arch>.dmg` (`dev/package.mjs`, `@electron/packager` + `hdiutil`)
- `legacy/` — the retired vanilla frontend and its dev scripts, archived so the
  migration stays reviewable and reversible
- **`pigui` launcher** (`bin/pigui`, installed with `npm run link`): one command
  from any directory, `--web` for the browser, builds `dist/` if missing; the
  packaged `.app` now remembers its last working folder so a Finder double-click
  opens somewhere sensible

### Changed
- `server.js` serves `dist/` only; the old `public/` fallback is gone and a
  missing build now prints `run npm run build` instead of silently serving stale UI
- desktop shell: `electron/preload.js` exposes `window.piDesktop.setTheme()`. The
  main process matches the native window background and sidebar vibrancy to the
  app theme, augments `PATH` (so `pi` is found when launched from Finder) and
  writes traces to `~/Library/Application Support/pi GUI/traces` when packaged
- the toolbar theme button is a plain light/dark toggle whose icon shows the mode
  you will switch *to*; the three-way choice (`system`) stays in Settings

### Fixed
- **light theme rendered dark inside Electron** — the page is transparent (for the
  sidebar material) and was showing the window's dark background. The main process
  now follows the app theme via IPC, and the content column always paints the
  theme background
- **the desktop window could not be dragged** — the frameless window had no
  `-webkit-app-region: drag`; the toolbar and status bar now provide it
- custom/system messages were rendered **twice** in the reducer, and `display:false`
  was ignored
- `toolcall_delta` / `toolcall_end` were **dead code** (`updateTool` was passed an
  undefined id), so streaming tool arguments and the final `args` were dropped
- the edit/retry fork flow could mis-fire when a `fork` response was lost; it now
  clears its pending intent on a timeout and no longer double-toasts
- `serveStatic` prefix check was not path-anchored; the revert backup path was not
  normalised (both could escape their intended directory)
- the ⌘⇧E export handler closed over a stale `exportHtml`
- the `@`-completion request could set state after unmount

---

## 2026-09-30 — a dock instead of dialogs, and prose that knows its measure

### Added
- **the right-hand panel is a dock with three views**: *Trace* (per-exchange
  events), *Changes* (file list, line diff, revert) and *Context* (what the model
  actually received — system prompt size, tools, context files, the message ledger
  with a role bar, and the last request's model/tools/message count/payload).
  The Changes **modal is gone**: reviewing what the agent wrote is a glance, not a
  dialog
- the dock is **draggable** (`#dock-resize`, pointer or arrow keys, 320–820px,
  remembered) and each view keeps its own scroll position

### Changed
- **prose keeps a reading measure, wide content does not**: paragraphs, lists,
  headings and quotes cap at `74ch`, while code blocks, tables and diffs use the
  whole column (measured: prose 653px, code 897px). Previously the bubble capped
  everything, so a wide table or a long line of code was squeezed into a
  conversation-width column
- `dockToggle('trace' | 'changes' | 'context')` is the single entry point; the
  Settings panel, the palette and the toolbar buttons all go through it

### Fixed
- **`class="hidden"` had no generic CSS rule** — it was only styled per component
  (`#trace.hidden`, `.badge.hidden`, …). That is why the dock rendered all three
  views stacked, and it had already bitten the model/thinking selects earlier.
  There is now a `.hidden { display: none !important }` utility so a new element
  can never silently stay visible
- the dock's context rows stacked their labels over truncated values, because
  `kvRows(label, value, right)` keeps the value in the *third* slot — the dock was
  passing it as the right-aligned number and then hiding that column

## 2026-09-30 — full-bleed shell, one picker, compact by default

### Changed
- **the app is a window, not a card**: the frame border, the outer shadow and the
  page padding are gone, so the UI is edge-to-edge. In Electron the window draws
  the chrome instead — `titleBarStyle: 'hiddenInset'`, the traffic lights floating
  over the sidebar, and `vibrancy: 'sidebar'` so the sidebar shows the system
  material (the page goes transparent behind it via `html.is-electron`)
- **compact log is the default layout** — the boxed one is still available in
  Settings → Appearance. It was the right call beyond looks: pi sends the tool
  group and the prose as separate messages, so the card layout drew *one* assistant
  reply as *two* turns
- **model and thinking level are one control** (`DeepSeek V4 Flash · high ▾`) with
  a two-column popover. The native selects stay in the DOM as the source of truth,
  so `set_model` / `set_thinking_level` and the remembered preferences are untouched
- the toolbar lost its duplicate branding (the sidebar already shows `π pi GUI`) and
  the `Δ` button is an icon with a count badge instead of `Δ Changes` text

### Fixed
- **the context percentage was displayed twice** — once in the toolbar, once in the
  status bar. It lives in the status bar now, with the detail in its tooltip
- the two selects relied on a `class="hidden"` that no CSS rule defined (`hidden` is
  only styled per component here), so they were rendering next to the picker
- with the sidebar collapsed in Electron the toolbar sat under the traffic lights;
  it now reserves that corner

### Tooling
- the "compact is the default" test drives the real boot path via a new
  `preferredLayout()`, instead of re-implementing the default in the test

## 2026-09-30 — time grouping, and two transcript layouts to choose between

### Added
- **group sessions by time or by workspace** — a two-button switch in the sidebar
  (remembered). By time you get *Today / Yesterday / Earlier this week / This
  month / Earlier* with the workspace shown on each row; by workspace you get the
  previous behaviour. 128 sessions in one flat list was too long to scan
- **a second transcript layout: "compact log"** — Settings → Appearance, the
  command palette, or `applyLayout()`. It drops the per-turn card and draws one
  continuous document with a left rail, puts tool calls on single dense lines
  without the redundant `done` badge, and reduces thinking to a faint one-liner.
  Worth having as more than a style: the card layout renders *one* assistant reply
  as *two* cards (the tool group and the prose arrive as separate messages), so it
  reads as two turns. The compact layout draws it as one. `#app.layout-compact`,
  so it is a pure CSS switch

### Changed
- the modal session list now shows the derived title, the workspace label and the
  session's turns/cost alongside its id and size

### Tooling
- **`dev/i18n-add.mjs`** inserts a key into the correct language block. Hand-editing
  by anchoring on a key name is how the same key lands twice in `en` (and the second
  definition silently shadows the first) — that happened three times in this
  stretch, and `dev/i18n-check.mjs` caught it every time. This is the tool that
  avoids creating the problem the check detects

## 2026-09-30 — session titles, per-session cost, and a sidebar that holds still

### Added
- **derived session titles** — the first user message with the instruction wrapper
  stripped (`Reply with exactly: PIPE OK` → `PIPE OK`, `Use the read tool on
  package.json` → `package.json`). No model call: a few regexes plus a colon split
  when the prefix looks like an instruction. A list of 100 sessions is finally
  scannable
- **per-session stats in the list**: turns, tool calls, tokens and cost, read from
  the transcript by `GET /api/sessions`. All 117 sessions across 3 workspaces scan
  in **90 ms cold, 14 ms warm** (summaries are cached by `mtime:size`), and the
  modal session list shows the workspace label too, since it now spans all of them

### Fixed
- **the session list no longer jumps around**. Three causes, all fixed: it was
  rebuilt from scratch (`innerHTML = ''`) on every turn, rows and groups were
  sorted by mtime so the session you were using kept leaping to the top, and the
  rebuild could swap the row under the pointer — clicking could open the *wrong*
  session. Now: rows are reconciled by path and reused, a refresh whose data is
  unchanged does not repaint at all, ordering is stable (the active group first,
  then alphabetical; the active row pinned first inside its group), and a finished
  turn repaints exactly one row (`sbTouchActive`) with a full refresh throttled to
  once per 20 s

### Changed
- the sidebar's rows are two lines — title on top, `3 turns · $0.0003 · just now`
  underneath — and the tooltip carries the workspace, the absolute time and the
  full stats

## 2026-09-30 — session sidebar: see every session, switch freely

### Added
- **a permanent session sidebar**, which fixes two real problems at once: the
  session list lived in a modal (so you could not see where you were) and
  `GET /api/sessions` only ever returned the server's own cwd — on this machine
  that hid **6 of 108 sessions** entirely, and every session from any other
  project. The list now spans **all workspaces**, grouped by project, newest
  first, each row showing a relative time (`just now` / `12 min` / `17 h`),
  with the active session highlighted and one click to switch
- `GET /api/sessions?scope=all|workspace&limit=` with `workspaceLabel`,
  `isCurrentWorkspace` per session and a `workspaces` summary; summaries are
  cached by `mtime:size`, so listing 114 sessions across 3 workspaces takes ~45 ms
- `⌘\\` / `⌘B` folds the sidebar, `⌘⇧[` / `⌘⇧]` steps to the previous / next
  session, and the collapsed state plus per-workspace groups are remembered
- the sidebar search filters titles and, from two characters, greps every
  transcript, showing the matching sessions with their snippet

### Changed
- **switching sessions now reloads everything**: the conversation, the branch
  tree, stats, the trace, the changes panel and the sub-agent registry. Before,
  a switch left the tree, trace and inspector showing the previous session
- a session switch (or fork/clone/new) **resets the file-change baseline and the
  agent registry** — they describe the conversation you just left, not the one
  you are in
- `dev/cdp-test.mjs`'s inspector section now runs its own exchange instead of
  depending on what earlier steps happened to leave in the buffer (a fork clears
  per-session inspector state, which is correct but made the test order-dependent)

## 2026-09-30 — design system cleanup, i18n gaps, measured UI audit

### Added
- **`dev/css-audit.mjs`** — drives the real page over CDP and reports numbers
  instead of opinions: the rendered type scale, radius steps, WCAG AA contrast of
  every text style against its effective background, the reading measure in `ch`,
  hit targets under 26px, surface-nesting depth and the gap between messages. It
  immediately disproved two things I was about to "fix" (the reading measure was
  already 70ch, contrast was already 6.3–15)
- three tests that keep the design system honest: every rendered `font-size` and
  `border-radius` must be a documented step, and chat surfaces may not nest more
  than two deep

### Changed
- **one documented type scale** — `10 11 12 13 14 15 17 20`, all as custom
  properties. The rendered page had **13 distinct sizes** including `9.5px`,
  `10.5px`, `11.5px`, `12.5px` and a `13.3333px` that was the browser's default
  for form controls leaking through; it is now **7** (plus the H1 step), and
  `button/input/select/textarea { font: inherit }` stops the leak coming back
- **radii collapsed to named steps** `--r-xs 6 / --r-sm 8 / --r 10 / --r-lg 14 /
  --r-pill 999` — a stray `5px` and a stray `9px` were the only one-offs in the
  inventory
- **tool cards use a left rule instead of a full border**, so a message no longer
  reads as a box inside a box inside a box (max surface nesting went 3 → 2)
- the toolbar's working-directory chip is flat text again: a bordered pill there
  reads as a button, and it is not one
- the context-usage readout is labelled (`ctx 42%`) instead of a bare `42%`
- the Changes panel is a real two-column layout — before, the file list and the
  diff pane were stacked at 50% height each, leaving half the panel empty

### Fixed
- **hardcoded English in a translated UI**: `Thinking…` / `Thinking`, the theme
  tooltip, and — because `refreshI18n` only re-rendered the panels — the
  thinking labels, tool badges and copy buttons of messages already on screen.
  Switching language now relabels live chat blocks too
- `dev/make-screenshots.mjs` toggled the language instead of setting it, so a
  persisted choice leaked into the next run: the "chat in the light theme"
  screenshot was being written in Chinese
- `dev/i18n-check.mjs` now **fails on duplicate keys** in one language block. It
  caught two that I had just introduced by copy-pasting a key into the wrong
  block, where the second definition silently shadows the first

## 2026-09-29 — review, highlighting, search and long-session rendering

### Added
- **Changes panel (Δ)** — every file an `edit`/`write` tool touches is snapshotted
  *before* the edit and diffed against the file on disk now, so the panel shows the
  cumulative result rather than one tool call at a time. Per-file stats, filter,
  *this session only* toggle, line-numbered diff, and **single-file revert** with a
  two-step confirm. The current content is always copied to `traces/revert-*/`
  before anything is restored. In a git repo, repo-wide dirty files (including
  edits made through `bash`) are listed as well — which `git diff` alone cannot do
  the other way round, and a non-repo directory is fully supported
- **syntax highlighting** for fenced code — js/ts, json, python, bash, html, css,
  yaml, sql, diff, go, rust and a c-like family. A hand-written tokenizer with
  sticky regexes, zero dependencies, and it leaves the text byte-identical (a test
  asserts the round-trip)
- **full-text search over saved sessions** in the command palette: ≥2 characters
  greps every transcript on disk, this project first, and shows role + snippet;
  Enter switches pi to that session
- **self-contained HTML export** (⌘/Ctrl+Shift+E) — conversation, tool calls, raw
  trace and inline CSS in one offline file, plus an embedded JSON payload
- **chunked markdown rendering** — messages are split into paragraph/fence chunks
  and only the changed chunk is re-parsed, so streaming a long reply no longer
  re-parses everything above it
- palette actions for the new panels, collapse/expand all tool cards, jump to the
  last error, retry the last prompt, and every thinking level
- `dev/make-screenshots.mjs` captures the changes panel

### Changed
- **the event stream is resumable**: events carry `__seq`, a reconnecting client
  sends `&since=N`, the server replays what it still has and emits `__gap` when it
  doesn't — the client then resyncs from `get_messages` and says so in the log
  instead of silently losing turns

### Fixed
- `mdChunks` keeps `chunks.join('') === source` exactly, including consecutive
  blank lines, fences closed at EOF and files without a trailing newline (two
  whitespace-eating bugs found by the new tests)
- diff/yaml highlight rules needed the `m` flag, otherwise `^`-anchored rules only
  matched at offset 0

## 2026-09-27 — output formats, discoverability, and sub-agent visibility

### Added
- **markdown upgrade**: headings, ordered/unordered lists, **tables**, blockquotes,
  horizontal rules, and a language label on fenced code blocks. Models emit tables
  and lists constantly, and they used to render as raw pipe/asterisk soup.
- **ANSI colours** in tool output (`ls --color`, test runners, build logs) are
  rendered as spans instead of raw escape codes
- **JSON payloads** in `read`/`bash` output and in ```json fences are
  pretty-printed when they parse
- **multi-agent visibility**: sub-agents report their own system prompt, context,
  provider requests and tool results, tagged with their agent id. New
  **Inspector → Agents** tab plus a header selector that re-points every tab at the
  chosen agent. The server keys agents by pid (it spawned the main pi, so any other
  pid is a sub-agent) and links children via `ppid`; no patching of the official
  `subagent` example was needed — children inherit `PI_GUI_URL`/`PI_GUI_SESSION` and
  load `extensions/inspector.ts` from `~/.pi/agent/extensions/`
- **first-run hints** in the empty chat and a keyboard reference in Settings — the
  palette, `@` and `/` were previously invisible
- `⌘/Ctrl+K`, `@`, `/` mentioned in the composer placeholder
- screen-reader announcer (`role=status`) that reports each completed turn

### Changed
- **the trace panel is bounded by rendered rows, not by events**: each group keeps
  at most 40 rows of DOM, older ones collapse behind a *N more rows hidden* button,
  and streaming deltas are not put in the DOM at all unless the *deltas* toggle is
  on. Measured: 12,000 events went from **3,041 ms / 108,008 nodes** to
  **434 ms / 369 nodes**, and DOM size is now independent of event count.
- Inspector payloads (system prompt, raw request bodies) are rendered **on demand**:
  40 × 100 KB records used to put 4 M characters in the DOM while collapsed

### Fixed
- `#chat`, `#trace-list` and `#inspect-body` were not keyboard-scrollable
  (`tabindex` + `role=region` added)
- `aria-live="polite"` sat on the streaming log, so a screen reader would announce
  every token; the log is now `aria-busy` while streaming and completion is
  announced once through a dedicated live region

## 2026-09-20 — P1: correctness and hardening

### Added
- **security headers** on every response: a strict `Content-Security-Policy`
  (`default-src 'self'`, `script-src 'self'`, no inline scripts — `style-src`
  allows inline only because the waterfall/share bars are generated with style
  attributes), plus `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`
- **byte budgets** for anything that accumulates: trace events (8 MB/session) and
  inspector captures (4 MB/session, 512 KB per record) are now bounded by size as
  well as count, on both the server and the client; `/api/diagnostics` exposes
  `memory.traceBytes` / `memory.inspectBytes`
- `dev/i18n-check.mjs` — a static completeness check (literal keys from
  `t`/`tp`/`noticeT`/`setStatusK`, `data-i18n*` in markup, and declared dynamic
  prefixes) that exits non-zero on a missing key. The suite runs it too, plus a
  **runtime** assertion that nothing fell back while driving the UI in Chinese
  (`window.__i18nFallback`)

### Fixed
- **`label.tool` did not exist** — an unnamed tool would have rendered the key
  itself. Found by the new i18n check, which is exactly why it exists.
- **the session tree went stale**: the panel fetched `get_tree` once when opened,
  so opening it mid-turn (or right after one) showed a tree without the new
  entries. It is now refreshed when the agent settles while the panel is open.
- **`state.allMessages` was not updated by the live path**, so *Export
  conversation (.md)* produced an empty document for anything received after the
  last `get_messages`. Live user/assistant/custom messages are appended now (the
  test asserts the export contains the actual reply).
- the **sessions panel and inspector were dialogs visually but not semantically**:
  no `role=dialog`, `aria-modal`, `aria-labelledby`, focus trap or focus restore,
  and Escape closed the sessions panel but not the inspector. Both now use the
  same dialog treatment as the real modals, and Escape closes either.
- two labels were hardcoded English (`Queue` on the send button, `Remove` on
  attachments) — both go through `t()` now

## 2026-09-18 — a Settings modal, and a leaner toolbar

### Changed
- the toolbar was 8 buttons plus two selects. Everything that is not needed
  mid-conversation moved into a **Settings modal** (⚙): theme, language, the
  three panel launchers, Markdown export, new session, diagnostics and restart pi.
  The toolbar is now `model · thinking · usage · ⚙ · ＋ New · ■ Stop`.
- the moved controls keep their element ids, so the wiring and the test suite
  were unaffected by the layout change (the tests now call the JS API —
  `openSessions()`, `traceSetOpen()`, `openInspect()`, `applyTheme()` — instead of
  clicking toolbar buttons, which is more robust anyway).

### Fixed
- `openSettings()` refreshed the theme/language labels from inside the modal
  *builder*, which runs before the modal is attached to the document — so
  `document.querySelector('#btn-lang')` returned null and the toggle showed the
  wrong label. The refresh now happens after `showInfoModal()` returns.

## 2026-09-18 — inspector, per-tool renderers, waterfall, export, replay

### Added
- **per-tool renderers**: `write` renders its content as added lines with a `+N`
  badge; `read` gets a line-numbered gutter (skipped when pi already numbered
  it); `grep` — and grep-shaped `bash` output — is grouped per file with line
  numbers and a match-count badge; `find`/`ls` render as clean lists
- **trace waterfall**: every group header shows each tool as a bar positioned
  inside the exchange's time window (hover for name + duration), plus a
  **touched files** chip listing the paths
- **export the conversation as Markdown** (⌘K → *Export conversation (.md)*)
- **Replay tab** in the Inspector: pick an exchange, scrub a slider over its raw
  records and watch the visible state rebuild — accumulated text, thinking, tool
  statuses, usage, stop reason, queue — with the raw event at each step
- **extension/tool audit**: the inspector reports `getAllTools()` and
  `getCommands()`, so the Capabilities tab shows every tool **with the source it
  came from** (extension path, package, …)
- the server injects `PI_GUI_URL` / `PI_GUI_SESSION` into the pi process, so the
  extension can report to `POST /api/inspect`; records are kept per session,
  broadcast as `__inspect` and appended to `traces/inspect-*.jsonl`
- `--no-inspector` to disable it

### Removed
- the `neo` (neobrutalist) visual style, its toolbar toggle, its token block and
  every reference. The UI is now a single calm, token-driven style.

### Fixed
- **inspector records were written into the trace file.** `inspectFileFor()` used
  `traceFile.replace(/^run-/, 'inspect-')`, which never matches an absolute path,
  so the two files were the same. The mixed records then crashed the client:
  `traceNormalize` read `.type` off a record that had no `evt`. Fixed by
  rewriting the basename, excluding `inspect-*.jsonl` from `/api/traces`, and
  making `traceNormalize` skip records without an `evt`.
- inspector records are now readable after a reload / server restart: when the
  in-memory buffer is empty, `/api/inspect` falls back to the file.
- `extensions/inspector.ts` had its closing brace in the wrong place, which made
  pi fail to load the extension and **exit immediately** (the GUI then showed
  zero models). Caught by the suite.

## 2026-09-18 — inspector: an X-ray for the harness

### Added
- **Inspector panel** (toolbar **Inspect**), fed by a new bundled extension
  `extensions/inspector.ts` that hooks `before_agent_start`,
  `before_provider_request`, `after_provider_response`, `context`,
  `session_compact`, `tool_result` and `resources_discover`. Every handler is
  pass-through — it returns `undefined`, so pi's prompts, payloads and tool
  arguments are never modified. Five tabs:
  - **System prompt** — the exact string, its size, and the parts it was built
    from (cwd, tools, tool snippets, guidelines, context files, skills,
    custom/append prompt)
  - **Context** — every message handed to the model with role, types, size and
    a share bar across the window
  - **Requests** — one row per LLM call: model, params, message roles, tool
    names, payload bytes, HTTP status, rate-limit headers, raw payload on demand
  - **Session file** — the append-only entry list with `id`/`parentId` and
    compaction flags
  - **Capabilities** — commands/extensions, model catalog, discovered skills,
    loaded context files, compaction history
- the server injects `PI_GUI_URL` / `PI_GUI_SESSION` into the pi process, so the
  extension can report to `POST /api/inspect`; records are kept per session,
  broadcast as `__inspect` and appended to `traces/inspect-*.jsonl`
- `--no-inspector` to disable it

### Removed
- the `neo` (neobrutalist) visual style, its toolbar toggle, its token block and
  every reference. The UI is now a single calm, token-driven style.

### Fixed
- **inspector records were written into the trace file.** `inspectFileFor()` used
  `traceFile.replace(/^run-/, 'inspect-')`, which never matches an absolute path,
  so the two files were the same. The mixed records then crashed the client:
  `traceNormalize` read `.type` off a record that had no `evt`. Fixed by
  rewriting the basename, excluding `inspect-*.jsonl` from `/api/traces`, and
  making `traceNormalize` skip records without an `evt`.
- inspector records are now readable after a reload / server restart: when the
  in-memory buffer is empty, `/api/inspect` falls back to the file.

## 2026-09-17 — per-tab sessions, tool diffs, accessibility

### Added

**Composer**
- `@` file completion — project-wide fuzzy search via `git ls-files` (so
  `.gitignore` is respected) with a bounded walk fallback outside a repo
- `/` command completion — extension commands, prompt templates and skills from
  `get_commands`, with descriptions and a source badge
- draft persists across reloads (`localStorage`), `↑`/`↓` browse previous
  prompts shell-style, floating `↓ latest` button when scrolled away
- **edit & resend / retry** on the last user message: forks the session at that
  message via `get_fork_messages` + `fork`, then pre-fills the composer with the
  original text (or resends it verbatim)

**Reading**
- tool cards render pi's own `details.diff` for `edit` with `+/-` colouring and a
  `+N −M` badge; headers show the file path or the exact command
- output longer than 40 lines starts collapsed behind *show all N lines*
- copy button on every code/output block, plus copy-whole-answer on assistant
  messages
- only the newest 30 messages live in the DOM; older ones sit behind a
  *load earlier* button and the reading position is preserved
- cost formatting that never shows a misleading `$0.0000`, with last-turn
  `↑in ↓out $cost` in the usage tooltip

**Live state**
- status-bar run indicator: spinner, the current action (`thinking…`,
  `writing…`, `running bash…`, `compacting…`) and elapsed time
- blinking caret at the end of streaming text
- streaming deltas coalesced into one DOM update per animation frame — long
  replies no longer re-parse their whole markdown per token

**Operations**
- diagnostics panel (toolbar `ⓘ`): pi pid, server, cwd, connected clients, last
  command, last event, uptime, trace file; **Restart pi** built in (toolbar `⟳`)
- `⌘/Ctrl+K` command palette: new session, restart pi, trace panel, sessions,
  diagnostics, theme, visual style, language, every model, every `/command`
- desktop notification when a run finishes while the tab is in the background
- trace files are pruned to the newest `--trace-keep` runs (default 30)
- API token: binding beyond loopback auto-generates one, prints the full URL and
  answers unauthenticated `/api/*` calls with 401

**Accessibility / keyboard**
- dialogs are real `role="dialog"` + `aria-modal` with a focus trap and focus
  restore; the chat is an `aria-live` log, the status bar a `role="status"`
- session tree is a `role="tree"` with `treeitem`s and ↑/↓/Home/End navigation
- completion and palette lists use `role="listbox"`/`option`/`aria-selected`
- icon buttons carry `aria-label`s; all focusable elements have a visible
  `:focus-visible` outline; `prefers-reduced-motion` is honoured

### Changed
- **one `pi` process per browser tab.** Server state moved from a single global
  child process to `Map<clientId, PiSession>`; the client keeps a random id in
  `sessionStorage` and sends it as `?c=<id>`. A reload keeps the session, a new
  tab gets an independent pi, and idle sessions (no client, 10 min) are reaped
  (`--session-idle`).
- pi processes start **lazily** on first use instead of at boot
- the default visual style is `soft`; `neo` (neobrutalist) is one toolbar click
  away
- `/api/events`, `/api/command`, `/api/info`, `/api/diagnostics`,
  `/api/restart` and `/api/trace` are now session-scoped

### Fixed
- `onMessageEnd` rebuilt message blocks without carrying tool `details`, so diffs
  never rendered (both event orders verified)
- trace-jump buttons disappeared after a page reload — `linkTraceJumps()`
  reconnects history bubbles to trace groups
- extension dialogs could hang forever in a tab that missed the answer; the
  server now tracks pending dialog ids (expiring ones with a `timeout`) and sends
  them in the SSE `__hello` handshake so clients prune stale modals

---

## 2026-09-16 — i18n, images, sessions, desktop shell, dual styles

### Added
- **English / 中文 UI** (`public/i18n.js`): toolbar `中 / EN` button, in-place
  re-render without a reload, follows `navigator.language` on first visit, then
  remembers the choice. Static markup is tagged with `data-i18n*`; notices
  remember the key they were rendered from so a language switch updates them.
- **Images**: paste from the clipboard, drag & drop anywhere, or the 📎 button;
  thumbnail tray with per-image remove and a 12 MB cap; sent as
  `images: [{type,data,mimeType}]` and rendered inline
- **Sessions panel**: the full `get_tree` branch tree (active path highlighted,
  leaf marked, entry labels), bookmarks written through pi's own `setLabel()` via
  the bundled `extensions/gui-bridge.ts` (`/gui-label`), **Fork from here**,
  **Clone branch**, **Export HTML**, **Rename session**, saved-session list with
  switch and two-step delete, and filters on both tabs (free text, role chips,
  active-path-only, time range, sort, named-only)
- **Electron desktop shell** (`electron/main.js`): free-port handshake, native
  window with menu (Open Folder…, Restart pi, Reveal Working Folder), window
  bounds memory, single-instance lock. `.npmrc` pins an Electron mirror because
  the GitHub release download stalls on some networks. `start-desktop.sh` falls
  back to the browser UI.
- **`soft` visual style** (Calm, hairline borders, blurred shadows) as the new
  default, alongside the ported neobrutalist `neo` style
- `GET /api/files` — git-aware project file index for `@` completion
- screenshots + `dev/make-screenshots.mjs`

### Changed
- theme system rewritten as tokens (`--line`, `--shadow*`, `--page-bg`, …) so
  light/dark **and** soft/neo are independent, persisted choices

### Fixed
- a prompt typed in one tab was invisible in the others: `message_start` for
  `role: "user"` was ignored, so only the sending tab saw the question. Now
  foreign user messages render, de-duplicated against the sender's optimistic
  bubble.
- the "No messages yet" placeholder stayed forever once messages arrived

---

## 2026-09-15 — the GUI itself

### Added
- `server.js`: spawns `pi --mode rpc`, bridges its JSONL protocol to the browser
  over SSE for events and POST for commands. No framework, no runtime deps.
- chat UI: streaming assistant text, collapsible thinking, tool-call cards with
  live output, model + thinking-level pickers, token/cost/context usage, abort,
  new session, steering messages while streaming
- **Trace panel**: one group per exchange with duration/tools/tokens/cost, rows
  for prompts, assistant stop reasons and usage, tool calls with timings and
  exit status, dialogs **and the answers**, compaction, retries, queue updates,
  process/stderr and extension errors; a *deltas* toggle for raw
  `message_update` events; raw JSON per row; JSONL persistence under `traces/`;
  history dropdown, NDJSON export, clear; a per-message **trace** jump button
- **Extension UI bridge**: `select`/`confirm`/`input`/`editor` as real modals
  (keyboard driven, queued, timeout countdown) plus `notify`, `setStatus`,
  `setWidget`, `setTitle`, `setEditorText`
- offline resilience: `send()` retries with backoff, a failed prompt is put back
  in the composer with an explicit notice, an OFFLINE badge appears, and a
  reconnect re-syncs state
- `GET /api/diagnostics` self-check endpoint; `favicon` and `file://` guards
- dev harness: `dev/dialogs-demo.ts` (`/dialogtest`), `dev/cdp-test.mjs`
  (headless Chrome end-to-end), `dev/multi-tab-test.mjs`
- moved out of the neighbouring memory project into `~/Desktop/harness/pi`

---

## Architecture notes

**SSE + POST instead of WebSocket.** pi's RPC mode is line-delimited JSON on
stdin/stdout. One-way SSE for the firehose plus a plain POST for commands needs
no protocol library, no upgrade handling, and reconnects automatically —
`EventSource` retries on its own, which is what makes the "server restarted"
case self-healing.

**One pi per tab.** Sharing a single pi across tabs looked fine until two tabs
disagreed about the conversation (the user's message was missing, dialogs leaked
between tabs). Giving each tab its own process removes that whole class of bug
and enables genuinely parallel work. The cost is a process per tab, which is why
idle sessions are reaped.

**Zero runtime dependencies.** The frontend is token-driven CSS and vanilla JS;
the server is `http` + `child_process` + `fs`. Adding a bundler or a UI framework
would make the thing harder to keep working, not easier.

**Token only off-loopback.** On `127.0.0.1` a token is friction with no benefit;
bound anywhere else the agent is shell-capable, so a token is generated and
required automatically.

**The trace is the debugging substrate.** Every problem in this log — the missing
user bubble, the stuck fruit dialog, the unrendered diff, the flaky test — was
diagnosed from `/api/diagnostics` plus the JSONL trace rather than guesswork.

## Testing

`dev/cdp-test.mjs` drives the real UI in headless Chrome over the DevTools
Protocol: 148 checks covering theme and style tokens, both languages, `@`/`/`
completion, the palette, dialogs and their focus trapping, tree keyboard
navigation, run state, diff/copy/collapse rendering, draft persistence across a
real reload, pagination, the diagnostics panel, edit & resend, image attachments,
the session tree and its filters, bookmarks, the trace pipeline, unreachable-
server recovery, stale-dialog pruning and multi-client behaviour.

Model-dependent behaviour (does the model actually call a tool?) is **injected as
synthetic events** rather than asserted on, so the suite is deterministic.

## Known limitations

- session entries are append-only by pi's design: nodes can be bookmarked,
  forked from, or the whole file deleted — never edited
- `ctx.ui.custom()` and TUI-only `ExtensionUIContext` methods are no-ops in RPC
  mode, so they cannot be surfaced in the GUI
- `switch_session` only lists sessions for the current working directory
- traces are one file per server run; traces are kept for the newest
  `--trace-keep` runs
- the agent can run shell commands: never bind it to a public interface

## Deliberately not done

- syntax highlighting (a dependency or a hand-written tokeniser for less value
  than the diff rendering)
- mobile/responsive layout (a local development tool)
- a theme/skin system beyond soft·neo × light·dark × en·zh
- CI (the suite is meant to be run locally: `node dev/cdp-test.mjs`)
- first-run onboarding tour, avatars, typing animations, sounds — attention
  without solving anything
