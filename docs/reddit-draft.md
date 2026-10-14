# Reddit launch draft

> Not posted automatically — PiStudio has no Reddit integration and posting needs
> your account. This is the copy to review/edit, then paste.

## Suggested subreddits (pick 1–2, don't cross-post everywhere at once)

| Subreddit | Why |
|---|---|
| **r/LocalLLaMA** | largest audience for local/agentic coding tools |
| **r/selfhosted** | browser UI served on localhost fits the crowd |
| **r/commandline** | CLI-first users who live in a terminal agent |
| **r/opensource** | general launch + feedback |
| **r/ClaudeAI** / **r/ChatGPTCoding** | if you lean on those providers via pi |

Post **one** sub first, answer comments, then adapt the copy elsewhere.

## Title options

- PiStudio – an open-source web + desktop GUI for the `pi` coding agent
- I built a GUI for `pi` (browser or Electron) — looking for feedback
- PiStudio: a local GUI that drives `pi --mode rpc`, in the browser or a desktop app

## Body

```markdown
Hi all — I built **PiStudio**, an open-source GUI for [pi](https://pi.dev),
the terminal coding agent.

I like agent CLIs but not staring at a scrollback buffer all day, so PiStudio
runs `pi --mode rpc` as a child process and puts a real UI on top:

- **Chat** with streaming text/thinking, Markdown, code highlighting and image
  attachments
- **Tool cards** — args, output, timing, status, per-step index
- **Dock** — trace (every raw JSON event, expandable), file changes and context
- **Sessions** — list, search, bookmark, resume; **sub-agents** get their own panes
- **`@` file** and **`/` command** autocomplete, command palette (⌘K), themes
- Two shells from the same server: **browser** (`pistudio --web`) or **Electron**
  desktop window

It's a thin layer: a zero-dependency Node server for the JS and a React + Vite +
Tailwind frontend. It does **not** bundle a model or `pi` itself — you point it
at the `pi` you already have.

**Stack:** Node (no deps) · React 19 + TypeScript + Vite + Tailwind · Electron
for the optional desktop shell. MIT.

Links:
- GitHub: https://github.com/AlexZhangUPUPUP/PI-GUI
- npm: https://www.npmjs.com/package/pistudio
- Install guide: https://github.com/AlexZhangUPUPUP/PI-GUI/blob/main/INSTALL.md

Quick start:
    npm install -g pistudio
    cd ~/my-project
    pistudio

I'm mostly looking for honest feedback — what's missing, what's broken, whether
the trace/session model matches how you actually use an agent. Happy to answer
anything.
```

## Before posting

- [ ] Push `main` so the GitHub + `INSTALL.md` links resolve.
- [ ] Publish to npm (`npm publish`) so the npm link is live.
- [ ] Add 2–3 screenshots or a short GIF to the post (light + dark chat, the
      trace dock). Reddit posts with media get far more traction.
- [ ] Make sure `LICENSE` is picked up by GitHub (shows "MIT" in the sidebar).
- [ ] Read the target sub's self-promotion rules; flairs are often required.
- [ ] Be around for the first few hours to reply.

## After posting (capture the feedback)

- [ ] Reply to every substantive comment.
- [ ] Turn recurring asks/bugs into GitHub issues.
- [ ] Note the top 3 requested features for the roadmap.
