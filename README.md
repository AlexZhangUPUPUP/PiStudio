<div align="center">

# PiStudio

**A calm web & desktop GUI for the [pi](https://pi.dev) coding agent.**

[![CI](https://github.com/AlexZhangUPUPUP/PiStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexZhangUPUPUP/PiStudio/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-3da639.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-5fa04e.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-6e7681.svg)](#)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-8a5cf6.svg)](https://github.com/AlexZhangUPUPUP/PiStudio/pulls)

[English](README.md) · [简体中文](README.zh-CN.md) · [Install](INSTALL.md) · [Changelog](CHANGELOG.md)

<img src="dev/shot-chat-light.png" alt="PiStudio — chat, trace and changes in the light theme" width="860">

</div>

## Quick start

```bash
# from source (works today)
git clone https://github.com/AlexZhangUPUPUP/PiStudio.git
cd PiStudio && npm install && npm run link
cd ~/my-project && pistudio          # desktop window, falls back to the browser

# once published to npm
npm install -g pistudio
```

`pistudio` runs **pi in the current directory** — it spawns `pi --mode rpc` and
puts a UI on top. PiStudio does **not** bundle `pi`, so install it first
(`npm i -g @earendil-works/pi-coding-agent`) and complete its setup once. Full
walkthrough: **[INSTALL.md](INSTALL.md)**.

## Highlights

| | |
|---|---|
| 💬 **Chat** | streaming text + thinking, Markdown, syntax highlighting, image paste |
| 🧰 **Tool cards** | pi's real diffs, grep grouped per file, line-numbered reads, copy buttons |
| 🔭 **Dock** | trace · changes (review & revert) · context — resizable and remembered |
| 🗂 **Sessions** | every workspace, branch tree, bookmarks, fork, full-text search |
| 🧩 **Sub-agents** | each gets its own pane; the Inspector shows their internals live |
| 🌗 **Two shells** | browser tab **or** native Electron window — one server, one UI |
| 🌍 **i18n** | English / 简体中文, switched in place, no reload |
| 🛡 **Local-first** | binds to loopback; CSP + a token if you expose it beyond |

<details>
<summary><b>How it works</b></summary>

```
browser / Electron ──SSE  /api/events──▶  Node server ──stdout JSONL──▶ pi --mode rpc
                   ──POST /api/command─▶              ──stdin  JSONL──▶ pi --mode rpc
```

The server (`server.js`) is zero-dependency plain Node; the frontend is React +
TypeScript + Vite + Tailwind (`src/` → built into `dist/`); Electron is only the
optional desktop shell.

</details>

<details>
<summary><b>Migration note</b> — the UI moved from a vanilla frontend to React</summary>

The original frontend is archived under `legacy/vanilla-ui/`. Parts of this
document that mention `public/*`, plain-CSS design tokens or the
`dev/cdp-test.mjs` suite describe that archive, not the current app. For the
current app see **Frontend (React + Vite)** and **Testing → React UI**.

</details>

---

## Contents

- [Screenshots](#screenshots)
- [Multiple tabs](#multiple-tabs) · [Languages](#languages) · [Desktop shell](#desktop-shell) · [Design language](#design-language)
- [Features](#features)
- [Sub-agents](#sub-agents)
- [Run — browser](#run--browser) · [Run — desktop](#run--desktop-electron) · [Packaging (macOS)](#packaging-macos)
- [Options](#options) · [HTTP API](#http-api)
- [Frontend](#frontend-react--vite) · [Files](#files) · [Testing](#testing)
- [Notes / limitations](#notes--limitations)

## Screenshots

**Light / dark / system** — toolbar button cycles the theme, persisted per browser

| Light | Dark |
|---|---|
| ![chat in the light theme](dev/shot-chat-light.png) | ![chat in the dark theme](dev/shot-chat-dark.png) |

**Trace** — one group per exchange; every row expands to the raw JSON event

| Light | Dark |
|---|---|
| ![trace panel in the light theme](dev/shot-trace-light.png) | ![trace panel in the dark theme](dev/shot-trace-dark.png) |

**Sessions** — append-only branch tree with bookmarks, fork/clone, saved files

| Branch tree | Saved sessions |
|---|---|
| ![session branch tree](dev/shot-sessions-light.png) | ![saved sessions](dev/shot-session-list.png) |

**Extension dialogs** and **image attachments**

| Dialog (from `select`) | Attachments |
|---|---|
| ![extension select dialog](dev/shot-dialog-light.png) | ![image attachments](dev/shot-attachments-light.png) |

**Per-tool renderers** — diff for `edit`/`write`, grep grouped per file, a line
number gutter for `read`

![tool renderers](dev/shot-tool-renderers.png)

**While pi is working**, the completion popups, diagnostics, and the palette

| Running | `@` files | `/` commands | Diagnostics |
|---|---|---|---|
| ![live run state](dev/shot-running.png) | ![file completion](dev/shot-autocomplete.png) | ![command completion](dev/shot-commands.png) | ![diagnostics](dev/shot-diagnostics.png) |

![command palette](dev/shot-palette.png)

**Settings** — theme, language, panel launchers, export, diagnostics and restart
pi, out of the toolbar

![settings modal](dev/shot-settings.png)

**Inspector** — pi's internals captured live: system prompt composition, context
budget, per-call provider payloads, the session entry tree, and the capability
inventory

| System prompt | Context | Requests | Capabilities |
|---|---|---|---|
| ![system prompt](dev/shot-inspect-prompt.png) | ![context](dev/shot-inspect-context.png) | ![requests](dev/shot-inspect-requests.png) | ![capabilities](dev/shot-inspect-caps.png) |

### The dock — trace, changes and context, always one click away

![changes dock view with diff and revert](dev/shot-changes.png)

![context dock view](dev/shot-context.png)

Regenerate them with `node legacy/dev/make-screenshots.mjs` (these shots show the
legacy UI; see Testing).

## Multiple tabs

Every browser tab drives **its own `pi` process**. The tab keeps a random id in
`sessionStorage` and appends it to every API call (`/api/events?c=…`), so:

- a **reload stays on the same session** (conversation, trace and pi process are
  kept)
- a **new tab starts an independent pi** — parallel work in the same repo without
  two tabs fighting over one conversation
- a tab that closes leaves its pi behind; idle sessions with no connected client
  are reaped after `--session-idle` (default 10 min)
- requests without `c` fall back to a shared `default` session, which is what a
  stale cached page or a bare `curl` will use

Trace files, the saved-session list and the file index stay per working
directory, not per tab.

## Languages

The UI ships in English and Chinese. The toolbar `中 / EN` button switches
instantly: the status bar, trace panel, session tree, filters, dialogs and
notices all re-render in place — no page reload. The choice is kept in
`localStorage` (`pi-gui-lang`); on a first visit it follows
`navigator.language`.

| 中文 | English |
|---|---|
| ![中文界面](dev/shot-zh-chat.png) | ![English UI](dev/shot-chat-light.png) |

**会话面板 / trace 面板**

| 会话 | 轨迹 |
|---|---|
| ![中文会话面板](dev/shot-zh-sessions.png) | ![中文轨迹面板](dev/shot-zh-trace.png) |

Every string lives in `src/lib/i18n-data.js` (`{ en: {...}, zh: {...} }`, copied
verbatim from the legacy `legacy/vanilla-ui/i18n.js`) and is read through `t(key, vars)`
(`src/lib/i18n.ts`); missing keys fall back to English, so adding a language is
just another top-level key. Components call `t()` directly and re-render in place
on a language switch.

## Desktop shell

`npm run desktop` runs the same UI inside Electron, where the window provides the
chrome instead of the page:

| | |
|---|---|
| title bar | hidden (`titleBarStyle: 'hiddenInset'`); the traffic lights float over the sidebar |
| sidebar | `vibrancy: 'sidebar'` — the system material shows through, so the page is transparent there (`html.is-electron`) |
| frame | none: no border, no radius, no shadow, no page padding — the app is edge to edge |
| dragging | the sidebar header, toolbar and status bar are `-webkit-app-region: drag`; every control opts out |

The browser build drops the frame too, so both look like an application rather
than a card on a page.

## Design language

One calm, low-contrast style — no hard shadows, no thick outlines, no second
theme. In the legacy frontend these were plain CSS custom properties in
`legacy/vanilla-ui/style.css`; the React app maps the same ideas onto the
Tailwind / shadcn tokens in `src/index.css` and `tailwind.config.ts`:

| Token group | Values | Use |
|---|---|---|
| surfaces | `--bg`, `--bg-soft`, `--bg-elev`, `--page-bg` | page, panels, cards, popovers (light + dark blocks at the top of the file) |
| text | `--text`, `--muted`, `--faint` | body, secondary, tertiary — all three clear 4.5:1 on every surface |
| lines | `--line`, `--hairline`, `--line-w: 1px` | borders are hairlines; nothing is 2px except the deliberate left rule on tool cards |
| accents | `--accent`, `--ok`, `--warn`, `--danger`, `--blue`, `--purple`, `--teal` | status, badges, diff add/del, syntax tokens |
| radii | `--r-xs: 6px`, `--r-sm: 8px`, `--r: 10px`, `--r-lg: 14px`, `--r-pill: 999px` | chips and inputs → cards and code → panels and modals → pills |
| type | `--fs-1: 10px`, `--fs-2: 11px`, `--fs-3: 12px`, `--fs-4: 13px`, `--fs-5: 14px`, `--fs-6: 15px`, `--fs-7: 17px`, `--fs-8: 20px` | an 8-step scale; body is `--fs-5` |

Two rules keep it from drifting, and both are enforced by the test suite:

1. **no ad-hoc numbers** — a rendered `font-size` or `border-radius` that is not
   one of the steps above fails `node legacy/dev/cdp-test.mjs`
2. **surfaces nest at most twice** — a bordered/backgrounded box inside another
   one inside another one is what makes an agent log look noisy, so tool cards use
   a left rule instead of a full border

`node legacy/dev/css-audit.mjs` prints the measured state (type scale, radius steps,
contrast ratios against WCAG AA, reading measure in `ch`, hit-target sizes,
surface nesting depth) while driving the real page — use it instead of eyeballing
a screenshot. Prose is capped at `740px` (~70–85 characters) by `.bubble`;
code, tables and diffs are allowed to use the full width.

To tweak the legacy look, edit only the token blocks at the top of
`legacy/vanilla-ui/style.css` — every legacy component reads from them.

## Features

<details>
<summary>📖 <b>Expand the full feature tour</b> — sessions, chat, the dock, operations, extension UI, inspector</summary>

**Sessions — every session, always visible**
- a **permanent sidebar** listing every session pi has saved **across all
  workspaces**, grouped by project — the working directory of the server is not a
  filter, so yesterday's session in another repo is one click away
- each row shows a **derived title** (the first user message with the instruction
  wrapper stripped: `Reply with exactly: PIPE OK` → `PIPE OK`), plus a stats line
  — `3 turns · $0.0003 · just now` — read from the transcript, so you can see what
  a session cost before you open it
- the **active session is highlighted**, and clicking any other row switches this
  tab's pi to it and reloads the conversation, tree, stats, trace and changes
  panels
- groups collapse and stay collapsed (per workspace, remembered); `⌘\` / `⌘B`
  folds the whole sidebar away, `⌘⇧[` / `⌘⇧]` steps to the previous / next session
- **the list does not reshuffle while you use it**: rows are reconciled by path
  rather than rebuilt, ordering is stable (the group you are working in stays
  first, then alphabetical), and a finished turn repaints only its own row — the
  earlier behaviour re-sorted by mtime on every turn, which moved rows under the
  pointer and could switch you to the wrong session
- the search box filters titles **and** greps the transcripts: type two characters
  and matching sessions appear with the hit highlighted underneath
- **group by workspace or by time** — *Today / Yesterday / Earlier this week /
  This month / Earlier* when you are looking for "what did I do yesterday", the
  project grouping when you are working in one repo; the choice is remembered
- the deep session tools (branch tree, bookmarks, fork/clone, rename, delete) still
  live in the Sessions panel — the sidebar is for getting there fast

**Two transcript layouts**
- **Compact log** (default) — one continuous document with a left rail, one dense
  line per tool call, thinking as a faint one-liner, no redundant badges
- **Comfortable** — boxes each turn, for reading a conversation
- switch with `Settings → Appearance` or the palette. Compact is also more
  *correct*: the boxed layout renders one assistant reply as two cards (tools and
  prose arrive as separate messages), the compact one draws the single turn it is

**Chat**
- streaming assistant text and collapsible thinking blocks
- **prose keeps a reading measure (74ch) while code, tables and diffs take the
  full column** — a wide table or a long line of code is no longer squeezed into
  conversation width
- **tool cards that show what actually happened**
  - `edit` renders pi's own unified diff with `+/-` colouring and a `+N −M` badge
  - `write` renders the new content as added lines with a `+N` badge
  - `read` gets a line-numbered gutter (skipped if pi already numbered it)
  - `grep` (and grep-shaped `bash` output) is grouped per file with line numbers
    and a match-count badge
  - `find`/`ls` render as clean lists; headers show the path, range or pattern
  - long output (>40 lines) starts collapsed behind *show all N lines*, and every
    code/output block has a copy button
  - **syntax highlighting** for fenced code (js/ts, json, python, bash, html, css,
    yaml, sql, diff, go, rust, java, c-like) — a small hand-written tokenizer, no
    dependencies, and it never touches the text itself
- **chunked markdown rendering** — a message is split into paragraph/fence chunks
  and only the chunk that changed is re-parsed, so streaming a long reply no
  longer re-renders (or re-parses) everything above it
- streaming deltas are coalesced into one DOM update per animation frame, so
  long replies and thinking blocks no longer re-parse their markdown per token
- history restored via `get_messages`; custom/extension messages rendered
- **multi-client safe** — a prompt typed in one tab is drawn from the
  `message_start` event in every other tab (and never duplicated on the sender)
- model picker, thinking-level picker, token/cost/context usage in the toolbar
- abort, new session; Enter sends, Shift+Enter newlines
- sending while streaming becomes a steering message
- **live run state** in the status bar: a spinner, what pi is doing
  (`thinking…` / `writing…` / `running bash…` / `compacting…`) and elapsed time,
  plus a blinking caret at the end of the streaming text
- **edit & resend / retry** on the last user message — forks the session at that
  message (so nothing is lost) and puts the original text back in the composer,
  or resends it verbatim

**The dock (right-hand pane)**
- **Trace**, **Changes** and **Context** are views of one dock, not three dialogs:
  drag the left edge to size it (or use ←/→ on the handle), and it remembers
- **Context** answers "what did the model actually get?" — system prompt size,
  tool list, context files, the message ledger with a role bar, and the last
  request's model, tools, message count and payload size
- close it with its ✕; open a view from the toolbar, `Settings → Panels`, the
  palette, or `⌘⇧D` for changes

**Changes — diff review and revert**
- **Δ Changes** in the toolbar (or ⌘/Ctrl+Shift+D) opens a review panel for
  everything the agent wrote
- every file an `edit`/`write` tool touches is recorded **before** the first edit
  and diffed against what is on disk **now** — so you see the cumulative change,
  not one tool call at a time
- per-file `+N −M` stats, filter box, and a *this session only* toggle; when the
  directory is a git repo, repo-wide dirty files (including changes made through
  `bash`) are listed too
- **revert a single file** — two-step confirm, and the current content is always
  copied to `traces/revert-<stamp>/…` first, so a mis-click cannot destroy work
- the toolbar badge counts the files this session changed

**Finding things again**
- **full-text search over saved sessions** — type ≥2 characters in the palette and
  it greps every session transcript on disk (this project first), showing the
  matching role and a snippet; Enter switches pi to that session
- **export a self-contained HTML bundle** (⌘/Ctrl+Shift+E) — the whole
  conversation, the tool calls, the raw trace and the inline CSS in one offline
  file, plus a JSON payload for tooling

**Composing**
- **`@` file completion** — fuzzy-searched over the project; uses `git ls-files`
  so `.gitignore` is respected, falls back to a bounded walk outside a repo
- **`/` command completion** — extension commands, prompt templates and skills
  via `get_commands`, with descriptions and a source badge
- ↑/↓ to move, Tab or Enter to accept, Esc to dismiss
- **draft is kept** across reloads (`localStorage`), **↑ / ↓ browse previous
  prompts** (shell style), and a floating **↓ latest** button appears whenever
  you scroll away from the bottom

**Operations**
- **a Settings modal holds everything you don't need mid-conversation** —
  theme, language, the panel launchers (Trace / Sessions / Inspector), export,
  diagnostics and restart pi — so the toolbar stays down to the model picker,
  thinking level, usage, Settings, New and Stop
- **diagnostics panel**: pi pid, server, cwd, connected clients,
  last command, last event, uptime, trace file — plus a **Restart pi** button
- **⌘/Ctrl+K command palette**: new session, restart pi, trace panel, sessions,
  diagnostics, theme, visual style, language, every model, and every `/command`
  — type to filter, ↑/↓, Enter to run
- **hardened by default**: a strict `Content-Security-Policy` (no inline
  scripts), `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`
  on every response; the session tree, sessions panel and inspector are all real
  `role=dialog` `aria-modal` regions with focus traps, and Escape closes each one
- **bounded memory**: trace events and inspector captures are capped by **bytes**
  per session (8 MB / 4 MB), not just by count, so one huge payload can't bloat a
  tab; `/api/diagnostics` reports the current usage
- **no silent i18n fallbacks** (legacy check): `legacy/dev/i18n-check.mjs` asserts
  every key used in the vanilla code or markup exists in every language
- **resumable event stream**: every event carries `__seq`, and a reconnecting
  client asks for `&since=N`, so a reload or a server restart replays what it
  missed; if the buffer no longer covers the gap the client is told and resyncs
  from `get_messages` instead of silently dropping turns
- trace files are pruned to the newest `--trace-keep` runs (default 30)
- **desktop notification** when a run finishes while the tab is in the background
- **binding beyond localhost requires a token** — the server generates one, prints
  the full URL, and answers unauthenticated API calls with 401
- **keyboard / assistive-tech friendly**: dialogs are real `role=dialog`
  `aria-modal` with a focus trap and focus restore, the chat is an `aria-live`
  log, the session tree is a `role=tree` with arrow-key navigation, and icon
  buttons carry `aria-label`s

**Long conversations**
- only the newest 30 messages live in the DOM; older ones sit behind a
  *load earlier* button, and the reading position is preserved when they load

**English / 中文**
- toolbar `中 / EN` button; the whole UI re-renders in place, no reload
- follows `navigator.language` on first visit, then remembers your choice
- one dictionary per language in `src/lib/i18n-data.js`

**Theme**
- `system → light → dark` cycle in the toolbar, persisted in `localStorage`,
  follows `prefers-color-scheme` in `system` mode
- one calm, low-contrast style defined entirely by CSS custom properties, so
  retheming means editing two token blocks

**Images**
- paste from the clipboard, drag & drop anywhere, or use the 📎 button
- thumbnail tray above the composer, per-image remove, 12 MB cap
- sent as `images: [{type: "image", data, mimeType}]` with the prompt
- rendered inline in the conversation

**Extension UI bridge** (`docs/rpc.md` → Extension UI Protocol)
- dialogs — `select`, `confirm`, `input`, `editor` — as real modals, queued one
  at a time, keyboard driven (↑/↓/Enter/1-9/Esc, ⌘/Ctrl+Enter in the editor),
  live countdown when the request carries a `timeout`
- **multi-client safe**: requests are broadcast to every connected tab, so the
  first answer wins — the others close their copy with an
  *"answered in another tab"* toast instead of leaving a dead modal
- **no stuck dialogs**: the server tracks which dialogs are actually pending
  (and expires ones that carry a `timeout`) and sends that list in the SSE
  `__hello` handshake, so a tab that missed the answer — or was reloaded mid
  flight — prunes its stale modal instead of showing it forever
- fire-and-forget — `notify` (toasts), `setStatus`, `setWidget`, `setTitle`,
  `setEditorText`
- dialogs only ever appear when an extension asks for input; plain chat never
  triggers one, and the only auto-loaded extension (`gui-bridge.ts`) has no UI

**Sessions**
- **Branch tree** — the full `get_tree` structure with the active path
  highlighted, the leaf marked, entry labels, and compaction/branch-summary/
  model-change nodes
- **Bookmarks** — select any node and attach a label; labels are written via
  pi's own `setLabel()` through the bundled `extensions/gui-bridge.ts`
  (command `/gui-label`), so they also show up in pi's TUI `/tree`
- click a user message → **Fork from here**; plus **Clone branch**,
  **Export HTML**, **Rename session**
- **Saved sessions** — lists `.jsonl` sessions for the current directory with
  name/preview/time/size, click to switch, two-step delete
  (`/api/sessions`, `/api/session/delete`)
- **Filtering**
  - *branch tree*: free-text search over node text / role / label / entry id,
    role chips (`user`, `assistant`, `tool`, `meta`, `custom`) and
    **active path only**. Matching nodes are highlighted, their ancestors are
    kept but dimmed so the tree still reads as a tree, and the counter shows
    `N match · shown/total nodes`
  - *saved sessions*: search over name / preview / id / filename, time range
    (any / today / 7d / 30d), sort (newest / oldest / largest / most entries),
    named-only, with a `matched / total` counter
- note: session history is append-only (pi's own guarantee), so individual nodes
  can't be deleted — only whole session files. The panel says so explicitly.

**Inspector** — an X-ray for the harness itself (toolbar **Inspect**)
A bundled extension (`extensions/inspector.ts`) reports what pi does internally;
every handler is pass-through, so nothing about pi's behaviour changes.

| Tab | What you see | Where it comes from |
|---|---|---|
| **System prompt** | the exact string pi sends, its size (~tokens), and the parts it was assembled from: cwd, selected tools, tool snippets, guidelines, context files, skills, custom/append prompt | `before_agent_start` → `systemPrompt` + `systemPromptOptions` |
| **Context** | every message handed to the model: role, content types, size, preview, plus a share bar so you can see what is eating the window | `context` → `messages` |
| **Requests** | one row per LLM call: model, params, message roles, tool names, payload bytes, HTTP status and rate-limit headers, with the raw messages payload expandable | `before_provider_request` → `payload`, `after_provider_response` → `status`/`headers` |
| **Session file** | the append-only entry list: id, type, parentId and a compaction flag — compare this with the Context tab to see exactly what compaction dropped | `get_entries` |
| **Capabilities** | registered tools **with their source** (which extension/package they
  came from), commands/extensions, the model catalog, discovered skills, loaded
  context files, compaction history | `getAllTools`, `getCommands`, `get_commands`, `get_available_models` |
| **Replay** | scrub through one exchange event by event: pick the turn, drag the
  slider, and watch the visible state (accumulated text, thinking, tool statuses,
  usage, stop reason) rebuild, with the raw event at each step | the trace file |
| **Agents** | every agent in the session — the main one plus each sub-agent, with
  its model, task and record count. The header selector then re-points *all* the
  other tabs at the chosen agent | sub-agents reporting themselves |

Captures live in memory per session and are appended to `traces/inspect-*.jsonl`,
so they survive a reload. `--no-inspector` turns the whole thing off.

**Trace** — per-exchange execution log (toolbar → **Trace**)
- grouped per conversation turn with duration, tool count, tokens, cost
- prompts, assistant messages + stop reason + usage, tool calls with
  duration/status/output, dialogs **and the answers**, compaction, retries,
  queue updates, process/stderr, extension errors
- streaming `message_update` events behind a **deltas** toggle
- every row expands to raw JSON; persisted to `traces/run-<ts>.jsonl`; history
  dropdown, NDJSON export, clear
- each user bubble has a **trace** button that jumps to its exchange
- each group header carries a **waterfall** of tool durations and a **touched
  files** chip (`3 files`, hover for paths)
- **export the conversation as Markdown** (⌘K → *Export conversation (.md)*)

</details>

## Sub-agents

pi has **no built-in sub-agents** — that is a deliberate design choice:

> It intentionally does not include built-in MCP, sub-agents, permission popups,
> plan mode, to-dos, or background bash. (`docs/usage.md`)

The official example `examples/extensions/subagent/` is a complete implementation,
and this GUI observes it. Install it with three sets of links:

```bash
EXT="$(npm root -g)/@earendil-works/pi-coding-agent/examples/extensions/subagent"
mkdir -p ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts
ln -sf "$EXT/index.ts" "$EXT/agents.ts" ~/.pi/agent/extensions/subagent/
# agent definitions pin Anthropic models in the example — copy them so you can
# point them at a provider you can actually reach
for f in "$EXT"/agents/*.md; do sed 's/^model: claude-.*/model: deepseek\/deepseek-v4-pro/' "$f" > ~/.pi/agent/agents/$(basename "$f"); done
ln -sf "$EXT"/prompts/*.md ~/.pi/agent/prompts/
```

Then the model gets a `subagent` tool with three modes:

```
single    subagent({ agent: "scout", task: "…" })
parallel  subagent({ tasks: [{agent:"scout",task:"…"}, {agent:"reviewer",task:"…"}] })
chain     subagent({ chain: [{agent:"scout",task:"…"}, {agent:"worker",task:"use {previous}"}] })
```

Each sub-agent is **its own `pi` process** with its own context window, model and
tool allowlist. Workflow prompt templates (`/scout-and-plan`, `/implement`, …) are
installed alongside.

### Seeing what each sub-agent does

Sub-agents are spawned by pi, not by this GUI — but they inherit `PI_GUI_URL` /
`PI_GUI_SESSION` from the parent and pick up `extensions/inspector.ts` from
`~/.pi/agent/extensions/`, so **they report themselves**: their system prompt,
context assembly, provider requests, tool results — all tagged with their own
agent id. The server keys them by pid (it spawned the main pi, so any other pid is
a sub-agent) and links children to the parent through `ppid`.

In the GUI: **Inspector → Agents** lists the tree, and the header selector switches
every tab to that agent. Undo the install with
`rm -rf ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts`.

## Run — browser

```bash
./start.sh                             # http://127.0.0.1:4173/
./start.sh --port 5173
./start.sh --cwd ~/my-project
./start.sh -- -e ./dev/dialogs-demo.ts # everything after -- goes to pi
```

## Run — desktop (Electron)

```bash
npm install          # downloads Electron (mirror configured in .npmrc)
./start-desktop.sh   # or: npm run desktop
```

- starts the server on a free port (`--port 0`, server prints a
  `__PI_GUI_READY__` handshake), then opens it in a native window
- menu: **File → Open Folder…** (restart in another cwd), **Restart pi**,
  Reveal Working Folder; View/DevTools; window bounds remembered
- args: `npm run desktop -- --cwd ~/proj`, `npm run desktop -- -- --no-session`
- `./start-desktop.sh` falls back to the browser UI if Electron isn't installed

> `.npmrc` pins `electron_mirror=https://npmmirror.com/mirrors/electron/`
> because the GitHub release download stalls on some networks. Delete it if the
> official mirror works for you.

### One command (`pistudio`)

```bash
npm install -g pistudio   # from npm (adds `pistudio` and the `pigui` alias)
npm run link              # from a checkout: symlink ~/.local/bin/pistudio
pistudio                  # desktop GUI, pi runs in the current directory
pistudio --web            # the same in a browser tab
pistudio --cwd ~/proj     # run pi somewhere else
pistudio -- --no-session  # args after -- go to pi
```

`cli/pistudio` resolves its own symlink, builds `dist/` if it is missing, then hands
off to `start-desktop.sh` (Electron, browser fallback) or `start.sh` (`--web`).
The packaged `.app` can also be double-clicked: it remembers the last working
folder in `userData/cwd.json` and falls back to your home directory.

## Packaging (macOS)

Build a double-clickable app and a `.dmg`:

```bash
npm run package       # build + .app + .dmg
npm run package:app   # .app only
```

Output lands in `release/`:

```
release/
  PiStudio-darwin-arm64/PiStudio.app   # the app bundle
  pistudio-arm64.dmg                   # installer (hdiutil)
```

`dev/package.mjs` uses `@electron/packager` (ad-hoc signed) and ships only what runs:
`electron/`, `server.js`, `extensions/`, `dist/` and `package.json` — `server.js`
is zero-dependency, so `node_modules` is excluded, and `asar` is off because the
server is spawned as a child process. The packaged app writes traces to
`~/Library/Application Support/PiStudio/traces` and adds `~/.local/bin`,
`/opt/homebrew/bin` and `/usr/local/bin` to `PATH` so it finds `pi` when launched
from Finder.

Builds are ad-hoc signed (required for the app to launch at all on macOS). If
Gatekeeper still complains on first open:

```bash
xattr -dr com.apple.quarantine "release/PiStudio-darwin-arm64/PiStudio.app"
```

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `4173` | HTTP port (`0` = pick a free one) |
| `--host` | `127.0.0.1` | bind address (localhost only) |
| `--cwd` | current dir | working directory pi runs in |
| `--pi` | `pi` | path to the pi binary |
| `--trace-dir` | `./traces` | where trace files are written |
| `--trace-keep` | `30` | keep only the newest N trace runs |
| `--session-idle` | `600000` | reap a tab's pi after this long without clients (ms) |
| `--no-gui-extension` | – | don't auto-load `extensions/gui-bridge.ts` |
| `--no-inspector` | – | don't auto-load `extensions/inspector.ts` |
| `--` | – | remaining args are forwarded to `pi --mode rpc` |

Env overrides: `PORT`, `PI_GUI_CWD`, `PI_BIN`, `PI_GUI_TRACE_DIR`, `PI_GUI_TRACE_KEEP`,
`PI_GUI_SESSION_IDLE`.

Stop: `pkill -f "pi/server.js"`.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/events?c=<id>&since=N` | SSE stream for that tab's pi: `__hello` (+pending `dialogs`, current `seq`), `__proc`, `__stderr`, `__raw`, `__marker`, `__ui_response`, and all pi RPC events (tagged `__seq`/`__t`). With `since` the buffered events after `N` are replayed first, preceded by `__gap` when the range is no longer buffered |
| POST | `/api/command?c=<id>` | forward a raw RPC command (incl. `extension_ui_response`) |
| GET | `/api/info?c=<id>` | session id, cwd, pid, alive, trace file |
| GET | `/api/diagnostics?c=<id>` | self-check: clients, last command/event, uptime, active sessions |
| POST | `/api/restart?c=<id>` | restart that tab's pi |
| GET | `/api/inspect?c=` | internals captured by the inspector extension |
| GET | `/api/files?q=&limit=` | project file index for `@` completion (git-aware) |
| GET | `/api/traces` | list persisted trace files |
| GET | `/api/trace?c=&file=…` | read a trace (that session's run by default) |
| POST | `/api/trace/marker?c=` | append a marker to the session's trace |
| GET | `/api/sessions` | list saved sessions for the current cwd |
| POST | `/api/session/delete` | delete a session file (path-checked) |
| GET | `/api/sessions?scope=all\|workspace&limit=` | saved sessions **across all workspaces**, with `workspaceLabel` / `isCurrentWorkspace`, plus a `workspaces` summary |
| GET | `/api/search?q=&limit=` | full-text search across saved session transcripts |
| GET | `/api/changes?c=` | files this session wrote (+ git status when available) with per-file stats |
| GET | `/api/changes/diff?c=&path=` | line diff for one file (`source`: `session` \| `git` \| `file`) |
| POST | `/api/changes/revert` | back up and revert one file (path-checked) |

When the server is bound beyond loopback, every `/api/*` call also needs
`?token=…` (or an `x-pi-gui-token` header).

## Frontend (React + Vite)

The UI was migrated from the original vanilla `public/` app to React +
TypeScript + Tailwind + shadcn/ui, reusing the design tokens from the
`isometric-data-platform-landing-page` template.

```bash
node server.js --cwd . &          # API on :4173
npm run dev                       # Vite on :5173, proxies /api → :4173
npm run build                     # emits dist/, which server.js then serves
```

`server.js` serves the Vite build from `dist/` (`npm run build`). The original
vanilla frontend is archived under `legacy/vanilla-ui/` and is no longer served.

Ported to React: chat with streaming text/thinking + Markdown/code highlighting,
tool cards (args/output), image attachments, `@`-file and `/`-command
autocomplete, input history and draft persistence, edit & resend / retry (fork +
prefill), trace-jump chips, model/thinking picker, the session sidebar
(workspace/time grouping, collapsible groups, content search), the sessions
modal (live tree + saved-session list, rename / clone / export HTML / fork /
bookmark / delete), the dock (trace / changes / context-inspector, resizable,
persisted), extension-UI dialogs, desktop notifications, steering/follow-up
queue status, toasts, widgets, the ⌘K command palette, settings
(comfortable/compact transcript), light/dark/system theme, en/zh i18n,
stats/usage and diagnostics. The original vanilla frontend is archived under
`legacy/vanilla-ui/`.

## Files

```
pistudio/
  server.js               Node server: one pi process per tab, SSE, traces, sessions
  src/                    React + TypeScript frontend (Vite)
  index.html              Vite entry for the React UI
  vite.config.mts         dev proxy (/api → server), builds to dist/
  tailwind.config.ts      shadcn tokens ported from the isometric template
  dist/                   built React UI; server.js serves it when present
  legacy/                 archived vanilla UI + its old dev scripts (not used at runtime)
  electron/main.js        desktop shell (window, menu, lifecycle)
  extensions/             gui-bridge.ts (/gui-label) · inspector.ts (harness X-ray)
  cli/pistudio            one-command launcher; npm `bin` → pistudio + pigui
  start.sh                browser launcher
  start-desktop.sh        desktop launcher (Electron, browser fallback)
  package.json / .npmrc   Electron dependency + mirror
  INSTALL.md              install, update and troubleshooting guide
  LICENSE                 MIT
  CHANGELOG.md            what changed when, plus architecture notes
  .github/workflows/ci.yml  typecheck + build (node 20/22) and the smoke test
  dev/react-smoke.mjs     React UI end-to-end smoke test (own server + Chrome; `npm test`)
  dev/package.mjs         builds the macOS .app / .dmg (@electron/packager + hdiutil)
  dev/dialogs-demo.ts     extension exercising every dialog/UI method (/dialogtest)
  dev/shot-*.png          screenshots (referenced by this README)
  traces/                 persisted traces (gitignored)
```

## Testing

### React UI (current frontend)

```bash
npm test              # self-contained: own server + headless Chrome, exits 0/1
npm run test:quick    # same, skipping the real prompt round-trip
```

`dev/react-smoke.mjs` starts a throwaway `server.js` on a free port and a
headless Chrome, drives the real UI over CDP, then tears both down. It checks
the shell, the theme toggle, layout persistence, sidebar grouping, the ⌘K
palette, the sessions/settings modals, all three dock tabs, `@` completion and
(unless `--no-chat`) a real prompt round-trip — and fails on any console error.
Point it at a running instance with `--url http://127.0.0.1:4173/ --port 9222`;
it exits non-zero on failure, so it doubles as a CI gate. Selectors are
language-agnostic (structure / ARIA / lucide class names), so switching en/zh
never causes false failures.

Against the Electron shell it additionally asserts the desktop pieces: the
`is-electron` class, a draggable toolbar, and the preload bridge. Start the shell
with a debug port first:

```bash
node_modules/.bin/electron --remote-debugging-port=9222 . &
node dev/react-smoke.mjs --url http://127.0.0.1:<internal-port>/ --port 9222
```

### Legacy vanilla UI suite (archived)

The 250-check suite and its helpers targeted the original `public/` frontend.
They are archived under `legacy/dev/` and no longer run against the React app
(`server.js` only serves `dist/`):

```bash
# reference only — these need the vanilla UI restored to public/ and served
node legacy/dev/cdp-test.mjs          # 250 checks
node legacy/dev/i18n-check.mjs        # i18n key coverage (en/zh)
node legacy/dev/multi-tab-test.mjs    # two clients on one session
node legacy/dev/css-audit.mjs         # measured UI audit (scale, contrast, nesting)
node legacy/dev/make-screenshots.mjs  # wrote dev/shot-*.png
```

Covers (legacy): connection, theme + style tokens (soft default and the neobrutalist
variant), English/Chinese switching and persistence, `@`/`/` completion, the
command palette, dialog focus trapping, session-tree keyboard navigation, live
run state and the streaming caret, tool diff rendering / copy buttons / output
collapse, whole-answer copy, human-readable cost formatting, draft persistence
across a real reload, input history, scroll-to-latest, message pagination, the
diagnostics panel, edit & resend (fork + prefill), image attachments, all four
dialogs + fire-and-forget methods, a real streamed prompt, the session tree,
session filters, bookmark round-trip, saved-session list, the full trace
pipeline, server-unreachable recovery, stale-dialog pruning, and multi-client
message/dialog handling.

The suite pins the language to English (`pi-gui-lang`) because it asserts on
copy; the Chinese pass is covered by its own block of checks.

Two browser instances on the same session (legacy):

```bash
node legacy/dev/multi-tab-test.mjs
```

Regenerate README screenshots (legacy, needs the vanilla UI restored):

```bash
node legacy/dev/make-screenshots.mjs
```

Then type `/dialogtest` in the GUI to try the dialogs by hand. That extension is
**not** loaded by default — it only exists for this, so it never pops dialogs
during normal use.

The same dialog, seen from multiple tabs: extension UI requests are broadcast, so
every connected tab shows the modal. Whoever answers first wins; the rest close
theirs and show an *answered in another tab* toast.

## Notes / limitations

- Binds to localhost with **no authentication** — it exposes a shell-capable
  agent. Don't bind it to a public interface.
- `custom()` and TUI-only `ExtensionUIContext` methods are no-ops in RPC mode.
- `switch_session` only lists sessions for the current working directory.
- Traces are one file per server run; `new session` adds a marker rather than
  splitting the file.
- Session entries are immutable and append-only, so the GUI cannot delete a node
  or rewrite history — only bookmark it, fork from it, or delete the whole file.

---

<div align="center">

<sub><b>PiStudio</b> — built for <a href="https://pi.dev">pi</a>. Not affiliated with the pi project.<br>
<a href="INSTALL.md">Install</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="LICENSE">MIT License</a></sub>

</div>
