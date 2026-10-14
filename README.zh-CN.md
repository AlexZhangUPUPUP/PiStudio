<div align="center">

# PiStudio

**一个用于 [pi](https://pi.dev) 的、安静好用的 Web & 桌面 GUI。**

[![CI](https://github.com/AlexZhangUPUPUP/PiStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexZhangUPUPUP/PiStudio/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-3da639.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-5fa04e.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-6e7681.svg)](#)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-8a5cf6.svg)](https://github.com/AlexZhangUPUPUP/PiStudio/pulls)

[English](README.md) · **简体中文** · [安装](INSTALL.md) · [更新日志](CHANGELOG.md)

<img src="dev/shot-chat-light.png?v=2" alt="PiStudio —— 浅色主题下的对话、轨迹与更改" width="860">

</div>

## 快速开始

```bash
# 从源码（当前可用）
git clone https://github.com/AlexZhangUPUPUP/PiStudio.git
cd PiStudio && npm install && npm run link
cd ~/my-project && pistudio          # 桌面窗口；未装 Electron 时回退到浏览器

# 发布到 npm 后
npm install -g pistudio
```

`pistudio` 会在**当前目录**运行 pi —— 它启动 `pi --mode rpc` 并在上层提供 UI。PiStudio **不打包 pi**，请先安装（`npm i -g @earendil-works/pi-coding-agent`）并完成一次配置。完整说明见 **[INSTALL.md](INSTALL.md)**。

## 亮点

| | |
|---|---|
| 💬 **对话** | 流式文本 + thinking、Markdown、语法高亮、粘贴图片 |
| 🧰 **工具卡片** | pi 的真实 diff、按文件分组的 grep、带行号的 read、复制按钮 |
| 🔭 **停靠面板** | 轨迹 · 更改（审阅与回滚）· 上下文 —— 可调宽并记住 |
| 🗂 **会话** | 跨所有工作区、分支树、书签、fork、全文搜索 |
| 🧩 **子 agent** | 各自独立面板；Inspector 实时展示其内部 |
| 🌗 **两种外壳** | 浏览器标签页 **或** 原生 Electron 窗口 —— 同服务器、同 UI |
| 🌍 **多语言** | 中文 / English，就地切换，无需刷新 |
| 🛡 **本地优先** | 只绑定回环地址；对外暴露时启用 CSP + token |

<details>
<summary><b>工作原理</b></summary>

```
browser / Electron ──SSE  /api/events──▶  Node server ──stdout JSONL──▶ pi --mode rpc
                   ──POST /api/command─▶              ──stdin  JSONL──▶ pi --mode rpc
```

服务器（`server.js`）是零依赖的原生 Node；前端是 React + TypeScript + Vite + Tailwind（`src/` → 构建到 `dist/`）；Electron 仅用于可选的桌面外壳。

</details>

<details>
<summary><b>迁移说明</b> —— UI 从原生前端迁移到 React</summary>

原始前端归档在 `legacy/vanilla-ui/` 下。本文档中提及 `public/*`、纯 CSS 设计 token 或 `dev/cdp-test.mjs` 测试套件的部分描述的是它，而不是当前应用。关于当前应用，请参见 **前端（React + Vite）** 和 **测试 → React UI**。

</details>

---

## 目录

- [截图](#截图)
- [多标签页](#多标签页) · [语言](#语言) · [桌面外壳](#桌面外壳) · [设计语言](#设计语言)
- [功能](#功能)
- [子 agent](#子-agent)
- [运行 —— 浏览器](#运行--浏览器) · [运行 —— 桌面](#运行--桌面electron) · [打包（macOS）](#打包macos)
- [选项](#选项) · [HTTP API](#http-api)
- [前端](#前端react--vite) · [文件](#文件) · [测试](#测试)
- [注意事项 / 局限](#注意事项--局限)

## 截图

**浅色 / 深色 / 跟随系统** —— 工具栏按钮循环切换主题，并针对每个浏览器持久化

| 浅色 | 深色 |
|---|---|
| ![chat in the light theme](dev/shot-chat-light.png?v=2) | ![chat in the dark theme](dev/shot-chat-dark.png?v=2) |

**Trace** —— 每次交互一个分组；每一行都可以展开为原始 JSON 事件

| 浅色 | 深色 |
|---|---|
| ![trace panel in the light theme](dev/shot-trace-light.png?v=2) | ![trace panel in the dark theme](dev/shot-trace-dark.png?v=2) |

**Sessions** —— 带书签、分支/克隆、已保存文件的只追加（append-only）分支树

| 分支树 | 已保存会话 |
|---|---|
| ![session branch tree](dev/shot-sessions-light.png?v=2) | ![saved sessions](dev/shot-session-list.png?v=2) |

**扩展对话框**和**图片附件**

| 对话框（来自 `select`） | 附件 |
|---|---|
| ![extension select dialog](dev/shot-dialog-light.png?v=2) | ![image attachments](dev/shot-attachments-light.png?v=2) |

**每个工具专属的渲染器** —— `edit`/`write` 的 diff、按文件分组的 grep、`read` 的行号边栏（gutter）

![tool renderers](dev/shot-tool-renderers.png?v=2)

**pi 工作期间**，补全弹窗、诊断信息和命令面板

| 运行中 | `@` 文件 | `/` 命令 | 诊断 |
|---|---|---|---|
| ![live run state](dev/shot-running.png?v=2) | ![file completion](dev/shot-autocomplete.png?v=2) | ![command completion](dev/shot-commands.png?v=2) | ![diagnostics](dev/shot-diagnostics.png?v=2) |

![command palette](dev/shot-palette.png?v=2)

**Settings** —— 主题、语言、面板启动器、导出、诊断和重启 pi，都从工具栏进入

![settings modal](dev/shot-settings.png?v=2)

**Inspector** —— 实时捕获的 pi 内部信息：系统提示词的构成、上下文预算、每次调用的 provider 负载、会话条目树和能力清单

| 系统提示词 | 上下文 | 请求 | 能力 |
|---|---|---|---|
| ![system prompt](dev/shot-inspect-prompt.png?v=2) | ![context](dev/shot-inspect-context.png?v=2) | ![requests](dev/shot-inspect-requests.png?v=2) | ![capabilities](dev/shot-inspect-caps.png?v=2) |

### 停靠面板（dock）—— 轨迹、更改和上下文，始终一键可达

![changes dock view with diff and revert](dev/shot-changes.png?v=2)

![context dock view](dev/shot-context.png?v=2)

使用 `node dev/make-screenshots.mjs` 重新生成这些截图 —— 它会自包含地启动一个临时服务器和无头 Chrome，驱动真实的 React UI，并抓取下面每一张图（参见测试）。

## 多标签页

每个浏览器标签页都驱动**属于它自己的 `pi` 进程**。标签页在 `sessionStorage` 中保存一个随机 id，并把它附加到每次 API 调用上（`/api/events?c=…`），因此：

- **刷新后仍停留在同一会话**（对话、轨迹和 pi 进程都会保留）
- **新标签页启动一个独立的 pi** —— 可以在同一个仓库里并行工作，而不会让两个标签页争抢同一个对话
- 关闭的标签页会留下它的 pi；没有已连接客户端的空闲会话会在 `--session-idle` 之后被回收（默认 10 分钟）
- 不带 `c` 的请求会回退到一个共享的 `default` 会话，过期的缓存页面或裸 `curl` 使用的就是它

轨迹文件、已保存会话列表和文件索引按工作目录（而非按标签页）保存。

## Agent 任务（实验性）

一个 **task** 是由 GUI 自己启动的一组 `pi` 进程 —— 不绑定浏览器标签页 —— 因此一条 prompt 可以同时分发给多个 agent，各自使用不同的模型、角色或工具白名单。这是后续编排界面（并行 agent、模型对拍）的运行时。

```bash
curl -s localhost:4173/api/tasks -H 'content-type: application/json' -d '{
  "label": "race",
  "agents": [
    { "name": "flash", "prompt": "用一句话概括 server.js。" },
    { "name": "pro", "model": "deepseek/deepseek-v4-pro",
      "prompt": "用一句话概括 server.js。" }
  ]
}'
```

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/tasks` | 列出任务 |
| POST | `/api/tasks` | 创建任务 —— `{ label?, cwd?, agents: [{ name?, model?, systemPrompt?, tools?, thinking?, prompt? }] }` |
| GET | `/api/tasks/:id` | 任务详情（agent + 缓存事件） |
| GET | `/api/tasks/:id/events` | 所有 agent 事件的 SSE 流，每条带 `__agent` 标记 |
| POST | `/api/tasks/:id/agents/:aid/command` | 给某个 agent 发 RPC 命令（`{ "message": "…" }` 是 prompt 简写） |
| POST | `/api/tasks/:id/stop` | 停止任务中的所有 agent |
| DELETE | `/api/tasks/:id` | 停止并移除任务 |

一个临时调试面板在 **`/tasks`**（无需构建）：添加 agent、启动、看每个 agent 流式输出、发后续消息。正式的 React 界面会替换它。

> task 是 PiStudio 自己启动的，和 **Inspector → Agents**（只是观察 pi 自带的 `subagent` 示例扩展）不同 —— 见 **子 agent**。

## 语言

UI 内置英文和中文。工具栏的 `中 / EN` 按钮可以即时切换：状态栏、轨迹面板、会话树、过滤器、对话框和通知都会原位重新渲染——无需刷新页面。该选择保存在 `localStorage`（`pi-gui-lang`）中；首次访问时它会跟随 `navigator.language`。

| 中文 | English |
|---|---|
| ![中文界面](dev/shot-zh-chat.png?v=2) | ![English UI](dev/shot-chat-light.png?v=2) |

**会话面板 / trace 面板**

| 会话 | 轨迹 |
|---|---|
| ![中文会话面板](dev/shot-zh-sessions.png?v=2) | ![中文轨迹面板](dev/shot-zh-trace.png?v=2) |

每一条字符串都放在 `src/lib/i18n-data.js`（`{ en: {...}, zh: {...} }`，逐字复制自旧版的 `legacy/vanilla-ui/i18n.js`）中，并通过 `t(key, vars)`（`src/lib/i18n.ts`）读取；缺失的 key 会回退到英文，因此添加一种语言只需要再增加一个顶层 key。组件直接调用 `t()`，并在语言切换时原位重新渲染。

## 桌面外壳

`npm run desktop` 在 Electron 内运行同一个 UI，此时由窗口（而不是页面）提供 chrome：

| | |
|---|---|
| 标题栏 | 隐藏（`titleBarStyle: 'hiddenInset'`）；红绿灯按钮悬浮在侧边栏上方 |
| 侧边栏 | `vibrancy: 'sidebar'` —— 系统的材质透过来，因此页面在那里是透明的（`html.is-electron`） |
| 边框 | 无：没有边框、没有圆角、没有阴影、没有页面内边距 —— 应用是边到边（edge to edge）的 |
| 拖动 | 侧边栏头部、工具栏和状态栏设置为 `-webkit-app-region: drag`；每个控件都选择退出 |

浏览器构建也去掉了边框，所以两者看起来都像一个应用程序，而不是页面上的一张卡片。

## 设计语言

一种平静、低对比度的风格——没有硬阴影，没有粗轮廓，没有第二套主题。在旧版前端中，这些是 `legacy/vanilla-ui/style.css` 中的普通 CSS 自定义属性；React 应用把同样的理念映射到 `src/index.css` 和 `tailwind.config.ts` 中的 Tailwind / shadcn token 上：

| Token 组 | 值 | 用途 |
|---|---|---|
| surfaces | `--bg`, `--bg-soft`, `--bg-elev`, `--page-bg` | 页面、面板、卡片、弹出层（文件顶部的浅色 + 深色两个块） |
| text | `--text`, `--muted`, `--faint` | 正文、次要文本、三级文本 —— 三者都在每个表面上达到 4.5:1 的对比度 |
| lines | `--line`, `--hairline`, `--line-w: 1px` | 边框是发丝线；除了工具卡片上刻意保留的左侧竖线，没有任何 2px |
| accents | `--accent`, `--ok`, `--warn`, `--danger`, `--blue`, `--purple`, `--teal` | 状态、徽章、diff 增删、语法 token |
| radii | `--r-xs: 6px`, `--r-sm: 8px`, `--r: 10px`, `--r-lg: 14px`, `--r-pill: 999px` | 标签和输入框 → 卡片和代码 → 面板和模态框 → 胶囊 |
| type | `--fs-1: 10px`, `--fs-2: 11px`, `--fs-3: 12px`, `--fs-4: 13px`, `--fs-5: 14px`, `--fs-6: 15px`, `--fs-7: 17px`, `--fs-8: 20px` | 8 级字号刻度；正文是 `--fs-5` |

两条规则防止它跑偏，而且都由测试套件强制执行：

1. **不允许临时（ad-hoc）数字** —— 任何渲染出的 `font-size` 或 `border-radius` 如果不在上述档位之一，`node legacy/dev/cdp-test.mjs` 就会失败
2. **表面最多嵌套两层** —— 一个带边框/背景的盒子套在另一个里面、再套在另一个里面，正是让 agent 日志显得嘈杂的原因，所以工具卡片使用左侧竖线而不是完整边框

`node legacy/dev/css-audit.mjs` 在驱动真实页面的同时打印测量到的状态（字号刻度、圆角档位、相对 WCAG AA 的对比度、以 `ch` 计的阅读行长、点击目标尺寸、表面嵌套深度）——用它来代替肉眼观察截图。正文由 `.bubble` 限制在 `740px`（约 70–85 个字符）；代码、表格和 diff 允许使用全宽。

要调整旧版外观，只需编辑 `legacy/vanilla-ui/style.css` 顶部的 token 块——每个旧版组件都从它们那里读取。

## 功能

<details>
<summary>📖 <b>展开完整功能清单</b> —— 会话、对话、停靠面板、运维、扩展 UI、Inspector</summary>

**Sessions —— 每个会话，始终可见**
- 一个**常驻侧边栏**，列出 pi **跨所有工作区**保存的每个会话，按项目分组——服务器的当前工作目录不是过滤器，因此昨天在另一个仓库里的会话也只需一次点击
- 每一行都显示一个**派生标题**（去掉指令包装后的第一条用户消息：`Reply with exactly: PIPE OK` → `PIPE OK`），外加一行统计信息 —— `3 turns · $0.0003 · just now` —— 从 transcript 中读取，因此你可以在打开会话之前就看到它的成本
- **当前会话会被高亮**，点击其他任何一行都会把本标签页的 pi 切换到该会话，并重新加载对话、树、统计、轨迹和更改面板
- 分组可以折叠并保持折叠状态（按工作区记忆）；`⌘\` / `⌘B` 收起整个侧边栏，`⌘⇧[` / `⌘⇧]` 切换到上一个 / 下一个会话
- **在你使用期间列表不会重新洗牌**：行按路径进行调和（reconcile）而不是重建，排序是稳定的（你正在工作的分组保持在前，然后按字母顺序），一个完成的轮次只重绘它自己的那一行——旧行为在每一轮都按 mtime 重新排序，导致指针下的行被移动，并可能把你切换到错误的会话
- 搜索框会过滤标题**并**对 transcript 进行 grep：输入两个字符，匹配的会话就会出现，命中的内容在下方高亮显示
- **按工作区或按时间分组** —— 当你在找“我昨天做了什么”时使用 *Today / Yesterday / Earlier this week / This month / Earlier*，当你在一个仓库中工作时使用项目分组；该选择会被记住
- 深度会话工具（分支树、书签、分支/克隆、重命名、删除）仍然位于 Sessions 面板中——侧边栏是为了让你快速到达那里

**两种 transcript 布局**
- **紧凑日志（Compact log）**（默认）—— 一份带左侧导轨的连续文档，每个工具调用一行密集的内容，思考以淡淡的单行显示，没有冗余徽章
- **舒适（Comfortable）** —— 每一轮都放入盒子中，适合阅读对话
- 通过 `Settings → Appearance` 或命令面板切换。紧凑布局也更*正确*：盒式布局会把一条 assistant 回复渲染成两张卡片（工具和正文是作为独立消息到达的），而紧凑布局画出的正是它所是的那单独一轮

**聊天（Chat）**
- 流式 assistant 文本和可折叠的思考块
- **正文保持阅读行长（74ch），而代码、表格和 diff 占用整列宽度** —— 宽表格或长代码行不再被挤进对话宽度
- **显示真实发生了什么的工具卡片**
  - `edit` 用 `+/-` 着色和 `+N −M` 徽章渲染 pi 自己的 unified diff
  - `write` 把新内容渲染为新增行，并带 `+N` 徽章
  - `read` 得到带行号的边栏（如果 pi 已经编号，则跳过）
  - `grep`（以及 grep 形式的 `bash` 输出）按文件分组，带行号和匹配数徽章
  - `find`/`ls` 渲染为整洁的列表；表头显示路径、范围或模式
  - 长输出（>40 行）默认折叠，藏在 *show all N lines* 后面，而且每个代码/输出块都有复制按钮
  - 为围栏代码提供**语法高亮**（js/ts、json、python、bash、html、css、yaml、sql、diff、go、rust、java、c-like）—— 一个小巧的手写 tokenizer，无依赖，而且它从不改动文本本身
- **分块的 Markdown 渲染** —— 一条消息被拆分为段落/围栏块，只有发生变化的块会被重新解析，因此流式渲染长回复时不再重新渲染（或重新解析）它上方的所有内容
- 流式增量被合并为每动画帧一次 DOM 更新，因此长回复和思考块不再每个 token 都重新解析它们的 Markdown
- 通过 `get_messages` 恢复历史；自定义/扩展消息也会渲染
- **多客户端安全** —— 在一个标签页输入的提示词会从其他每个标签页的 `message_start` 事件中绘制（并且在发送方永远不会重复）
- 模型选择器、思考级别选择器、工具栏中的 token/成本/上下文用量
- 中止、新建会话；Enter 发送，Shift+Enter 换行
- 流式输出期间发送的内容会变成一条 steering 消息
- 状态栏中的**实时运行状态**：一个 spinner、pi 正在做什么（`thinking…` / `writing…` / `running bash…` / `compacting…`）以及已用时间，外加流式文本末尾闪烁的光标
- 对最后一条用户消息的**编辑并重发 / 重试** —— 在该消息处分叉会话（因此不会丢失任何内容）并把原始文本放回输入框，或者原样重发

**停靠面板（右侧窗格）**
- **Trace**、**Changes** 和 **Context** 是同一个停靠面板的三个视图，而不是三个对话框：拖动左边缘来调整大小（或者在拖柄上使用 ←/→），并且它会记住
- **Context** 回答“模型实际得到了什么？”—— 系统提示词大小、工具列表、上下文文件、带角色栏的消息台账，以及最后一次请求的模型、工具、消息数和负载大小
- 用它的 ✕ 关闭它；从工具栏、`Settings → Panels`、命令面板或用于更改的 `⌘⇧D` 打开某个视图

**Changes —— diff 审查与还原**
- 工具栏中的 **Δ Changes**（或 ⌘/Ctrl+Shift+D）会为 agent 写下的所有内容打开一个审查面板
- 每个被 `edit`/`write` 工具触碰的文件都会在**第一次编辑之前**被记录下来，并与磁盘上**现在**的内容做 diff —— 因此你看到的是累积的更改，而不是一次一个工具调用
- 每个文件的 `+N −M` 统计、过滤框，以及 *this session only* 开关；当目录是一个 git 仓库时，也会列出整个仓库中已修改的文件（包括通过 `bash` 做出的更改）
- **还原单个文件** —— 两步确认，而且当前内容总是会先复制到 `traces/revert-<stamp>/…`，因此一次误点不会毁掉工作
- 工具栏徽章统计本会话更改过的文件数

**再次找到内容**
- **对已保存会话的全文搜索** —— 在命令面板中输入 ≥2 个字符，它就会 grep 磁盘上的每个会话 transcript（先搜本项目），显示匹配的角色和一段摘录；Enter 会把 pi 切换到该会话
- **导出一个自包含的 HTML 包**（⌘/Ctrl+Shift+E）—— 整个对话、工具调用、原始轨迹和内联 CSS 放在一个离线文件中，外加一份供工具使用的 JSON 负载

**输入（Composing）**
- **`@` 文件补全** —— 在整个项目上做模糊搜索；使用 `git ls-files`，因此会尊重 `.gitignore`，在仓库之外则回退到有界遍历
- **`/` 命令补全** —— 通过 `get_commands` 获取扩展命令、提示词模板和技能，带描述和来源徽章
- ↑/↓ 移动，Tab 或 Enter 接受，Esc 关闭
- **草稿会保留**在刷新之间（`localStorage`），**↑ / ↓ 浏览之前的提示词**（shell 风格），而且每当你滚动离开底部时都会出现一个浮动的 **↓ latest** 按钮

**操作（Operations）**
- **一个 Settings 模态框容纳你在对话过程中不需要的一切** —— 主题、语言、面板启动器（Trace / Sessions / Inspector）、导出、诊断和重启 pi —— 这样工具栏就精简到只有模型选择器、思考级别、用量、Settings、New 和 Stop
- **诊断面板**：pi 的 pid、服务器、cwd、已连接的客户端、最后一条命令、最后一个事件、运行时长、轨迹文件 —— 外加一个 **Restart pi** 按钮
- **⌘/Ctrl+K 命令面板**：新建会话、重启 pi、轨迹面板、会话、诊断、主题、视觉风格、语言、每个模型，以及每个 `/command` —— 输入以过滤，↑/↓，Enter 运行
- **默认加固**：在每个响应上设置严格的 `Content-Security-Policy`（无内联脚本）、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: no-referrer`；会话树、会话面板和检查器都是真正的带焦点陷阱（focus trap）的 `role=dialog` `aria-modal` 区域，Escape 可以关闭每一个
- **有界内存**：轨迹事件和检查器捕获按**字节**（而非仅按数量）对每个会话设上限（8 MB / 4 MB），因此单个巨大的负载不会撑爆一个标签页；`/api/diagnostics` 报告当前用量
- **没有静默的 i18n 回退**（旧版检查）：`legacy/dev/i18n-check.mjs` 断言 vanilla 代码或标记中用到的每个 key 都存在于每种语言中
- **可恢复的事件流**：每个事件都携带 `__seq`，重新连接的客户端会请求 `&since=N`，因此刷新或服务器重启会重放它错过的事件；如果缓冲区已不再覆盖该缺口，客户端会被告知，并从 `get_messages` 重新同步，而不是静默丢弃轮次
- 轨迹文件会被裁剪为最新的 `--trace-keep` 次运行（默认 30）
- 当一次运行完成而标签页在后台时，会发出**桌面通知**
- **绑定到 localhost 之外需要 token** —— 服务器会生成一个 token，打印完整 URL，并对未认证的 API 调用返回 401
- **键盘 / 辅助技术友好**：对话框是真正的带焦点陷阱和焦点恢复的 `role=dialog` `aria-modal`，聊天是一个 `aria-live` 日志，会话树是一个支持方向键导航的 `role=tree`，图标按钮带有 `aria-label`

**长对话**
- DOM 中只保留最新的 30 条消息；更早的消息位于 *load earlier* 按钮之后，加载时阅读位置会被保留

**English / 中文**
- 工具栏 `中 / EN` 按钮；整个 UI 原位重新渲染，无需刷新
- 首次访问时跟随 `navigator.language`，之后记住你的选择
- 每种语言在 `src/lib/i18n-data.js` 中有一个字典

**主题（Theme）**
- 工具栏中的 `system → light → dark` 循环，持久化在 `localStorage` 中，在 `system` 模式下跟随 `prefers-color-scheme`
- 一种完全由 CSS 自定义属性定义的平静、低对比度风格，因此重新设定主题只需要编辑两个 token 块

**图片（Images）**
- 从剪贴板粘贴、任意位置拖放，或使用 📎 按钮
- 输入框上方的缩略图托盘，可逐张移除，上限 12 MB
- 随提示词以 `images: [{type: "image", data, mimeType}]` 形式发送
- 在对话中以内联方式渲染

**扩展 UI 桥接**（`docs/rpc.md` → Extension UI Protocol）
- 对话框 —— `select`、`confirm`、`input`、`editor` —— 作为真正的模态框，一次排队一个，键盘驱动（↑/↓/Enter/1-9/Esc，编辑器中 ⌘/Ctrl+Enter），当请求携带 `timeout` 时显示实时倒计时
- **多客户端安全**：请求会广播到每个已连接的标签页，因此先回答者胜出 —— 其他标签页会关闭它们自己的副本，并显示 *"answered in another tab"* 的 toast，而不是留下一个死掉的模态框
- **不会卡住的对话框**：服务器跟踪哪些对话框真正处于待处理状态（并让携带 `timeout` 的过期），并在 SSE 的 `__hello` 握手中发送该列表，因此错过答案（或中途刷新）的标签页会修剪掉它的陈旧模态框，而不是一直显示
- 即发即忘 —— `notify`（toast）、`setStatus`、`setWidget`、`setTitle`、`setEditorText`
- 只有当扩展请求输入时才会出现对话框；普通聊天永远不会触发对话框，而且唯一自动加载的扩展（`gui-bridge.ts`）没有 UI

**会话（Sessions）**
- **分支树（Branch tree）** —— 完整的 `get_tree` 结构，高亮活动路径、标记叶子节点、显示条目标签，以及压缩/分支摘要/模型变更节点
- **书签（Bookmarks）** —— 选择任意节点并附加标签；标签通过捆绑的 `extensions/gui-bridge.ts` 用 pi 自己的 `setLabel()` 写入（命令 `/gui-label`），因此它们也会出现在 pi 的 TUI `/tree` 中
- 点击一条用户消息 → **Fork from here**；还有 **Clone branch**、**Export HTML**、**Rename session**
- **已保存会话（Saved sessions）** —— 列出当前目录的 `.jsonl` 会话，显示名称/预览/时间/大小，点击切换，两步删除（`/api/sessions`、`/api/session/delete`）
- **过滤（Filtering）**
  - *分支树*：对节点文本 / 角色 / 标签 / 条目 id 的自由文本搜索，角色标签（`user`、`assistant`、`tool`、`meta`、`custom`）和**仅活动路径**。匹配的节点被高亮，它们的祖先被保留但变暗，使树仍然读起来像一棵树，计数器显示 `N match · shown/total nodes`
  - *已保存会话*：按名称 / 预览 / id / 文件名搜索，时间范围（any / today / 7d / 30d），排序（newest / oldest / largest / most entries），仅已命名，带 `matched / total` 计数器
- 注意：会话历史是只追加的（pi 自身的保证），因此无法删除单个节点——只能删除整个会话文件。面板明确说明了这一点。

**Inspector** —— 针对 harness 本身的 X 光（工具栏 **Inspect**）
一个捆绑的扩展（`extensions/inspector.ts`）报告 pi 内部做了什么；每个 handler 都是直通的（pass-through），因此 pi 的行为不会发生任何改变。

| 标签页 | 你看到的内容 | 它来自哪里 |
|---|---|---|
| **System prompt** | pi 发送的精确字符串、它的大小（约 token 数），以及它由哪些部分组成：cwd、选中的工具、工具片段、指南、上下文文件、技能、自定义/追加提示词 | `before_agent_start` → `systemPrompt` + `systemPromptOptions` |
| **Context** | 交给模型的每条消息：角色、内容类型、大小、预览，外加一个占比条，让你看出是什么在占用上下文窗口 | `context` → `messages` |
| **Requests** | 每次 LLM 调用一行：模型、参数、消息角色、工具名称、负载字节数、HTTP 状态和限流头，原始消息负载可展开 | `before_provider_request` → `payload`，`after_provider_response` → `status`/`headers` |
| **Session file** | 只追加的条目列表：id、类型、parentId 和压缩标志 —— 把它与 Context 标签页对比，就能确切看到压缩丢弃了什么 | `get_entries` |
| **Capabilities** | 已注册的工具**及其来源**（它们来自哪个扩展/包）、命令/扩展、模型目录、发现的技能、加载的上下文文件、压缩历史 | `getAllTools`、`getCommands`、`get_commands`、`get_available_models` |
| **Replay** | 按事件逐个回放一次交互：选择轮次、拖动滑块，观察可见状态（累积文本、思考、工具状态、用量、停止原因）逐步重建，每一步都有原始事件 | 轨迹文件 |
| **Agents** | 会话中的每个 agent —— 主 agent 加上每个子 agent，以及它的模型、任务和记录数。头部选择器随后会把*所有*其他标签页重新指向选定的 agent | 子 agent 自我报告 |

捕获内容按会话存放在内存中，并追加到 `traces/inspect-*.jsonl`，因此刷新后仍然存在。`--no-inspector` 会关闭整个功能。

**Trace** —— 每次交互的执行日志（工具栏 → **Trace**）
- 按对话轮次分组，包含时长、工具数、token、成本
- 提示词、assistant 消息 + 停止原因 + 用量、带时长/状态/输出的工具调用、对话框**以及答案**、压缩、重试、队列更新、进程/stderr、扩展错误
- 流式 `message_update` 事件位于 **deltas** 开关之后
- 每一行都可展开为原始 JSON；持久化到 `traces/run-<ts>.jsonl`；历史下拉框、NDJSON 导出、清除
- 每个用户气泡都有一个 **trace** 按钮，可以跳转到它对应的交互
- 每个分组头部带有一个工具时长的**瀑布图**和一个 **touched files** 标签（`3 files`，悬停查看路径）
- **将对话导出为 Markdown**（⌘K → *Export conversation (.md)*）

</details>

## 子 agent

pi **没有内置的子 agent** —— 这是一个刻意的设计选择：

> 它刻意不包含内置的 MCP、子 agent、权限弹窗、计划模式、待办事项或后台 bash。（`docs/usage.md`）

官方示例 `examples/extensions/subagent/` 是一个完整的实现，这个 GUI 观察它。用三组链接来安装它：

```bash
EXT="$(npm root -g)/@earendil-works/pi-coding-agent/examples/extensions/subagent"
mkdir -p ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts
ln -sf "$EXT/index.ts" "$EXT/agents.ts" ~/.pi/agent/extensions/subagent/
# agent definitions pin Anthropic models in the example — copy them so you can
# point them at a provider you can actually reach
for f in "$EXT"/agents/*.md; do sed 's/^model: claude-.*/model: deepseek\/deepseek-v4-pro/' "$f" > ~/.pi/agent/agents/$(basename "$f"); done
ln -sf "$EXT"/prompts/*.md ~/.pi/agent/prompts/
```

然后模型就获得了一个带三种模式的 `subagent` 工具：

```
single    subagent({ agent: "scout", task: "…" })
parallel  subagent({ tasks: [{agent:"scout",task:"…"}, {agent:"reviewer",task:"…"}] })
chain     subagent({ chain: [{agent:"scout",task:"…"}, {agent:"worker",task:"use {previous}"}] })
```

每个子 agent 都是**它自己的 `pi` 进程**，拥有自己的上下文窗口、模型和工具允许列表。工作流提示词模板（`/scout-and-plan`、`/implement` 等）也会一并安装。

### 查看每个子 agent 做了什么

子 agent 由 pi 生成，而不是由这个 GUI 生成 —— 但它们从父进程继承了 `PI_GUI_URL` / `PI_GUI_SESSION`，并从 `~/.pi/agent/extensions/` 获取 `extensions/inspector.ts`，因此**它们会自我报告**：它们的系统提示词、上下文组装、provider 请求、工具结果 —— 全部带有它们自己的 agent id 标记。服务器按 pid 对它们建立索引（它生成了主 pi，因此任何其他 pid 都是子 agent），并通过 `ppid` 把子进程链接到父进程。

在 GUI 中：**Inspector → Agents** 列出该树，头部选择器会把每个标签页切换到该 agent。用 `rm -rf ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts` 撤销安装。

## 运行 —— 浏览器

```bash
./start.sh                             # http://127.0.0.1:4173/
./start.sh --port 5173
./start.sh --cwd ~/my-project
./start.sh -- -e ./dev/dialogs-demo.ts # everything after -- goes to pi
```

## 运行 —— 桌面（Electron）

```bash
npm install          # downloads Electron (mirror configured in .npmrc)
./start-desktop.sh   # or: npm run desktop
```

- 在一个空闲端口上启动服务器（`--port 0`，服务器打印 `__PI_GUI_READY__` 握手），然后在原生窗口中打开它
- 菜单：**File → Open Folder…**（在另一个 cwd 中重启）、**Restart pi**、Reveal Working Folder；View/DevTools；窗口边界会被记住
- 参数：`npm run desktop -- --cwd ~/proj`、`npm run desktop -- -- --no-session`
- 如果未安装 Electron，`./start-desktop.sh` 会回退到浏览器 UI

> `.npmrc` 固定了 `electron_mirror=https://npmmirror.com/mirrors/electron/`，因为 GitHub release 的下载在某些网络上会卡住。如果官方镜像对你有用，就删掉它。

### 一条命令（`pistudio`）

```bash
npm install -g pistudio   # 从 npm 安装（同时提供 pistudio 和 pigui 别名）
npm run link              # 从源码：软链到 ~/.local/bin/pistudio
pistudio                  # 桌面 GUI，pi 在当前目录运行
pistudio --web            # 在浏览器标签页中打开
pistudio --cwd ~/proj     # 在其他目录运行 pi
pistudio -- --no-session  # `--` 之后的参数传给 pi
```

`cli/pistudio` 会解析它自己的符号链接，如果 `dist/` 缺失就构建它，然后交给 `start-desktop.sh`（Electron，浏览器回退）或 `start.sh`（`--web`）。打包好的 `.app` 也可以双击运行：它会在 `userData/cwd.json` 中记住最后的工作文件夹，并回退到你的主目录。

## 打包（macOS）

构建一个可双击的应用和一个 `.dmg`：

```bash
npm run package       # build + .app + .dmg
npm run package:app   # .app only
```

输出落在 `release/`：

```
release/
  PiStudio-darwin-arm64/PiStudio.app   # the app bundle
  pistudio-arm64.dmg                   # installer (hdiutil)
```

`dev/package.mjs` 使用 `@electron/packager`（ad-hoc 签名），并且只打包运行所需的内容：`electron/`、`server.js`、`extensions/`、`dist/` 和 `package.json` —— `server.js` 是零依赖的，因此排除了 `node_modules`，而且 `asar` 是关闭的，因为服务器是作为子进程启动的。打包后的应用把轨迹写到 `~/Library/Application Support/PiStudio/traces`，并把 `~/.local/bin`、`/opt/homebrew/bin` 和 `/usr/local/bin` 加入 `PATH`，这样从 Finder 启动时就能找到 `pi`。

构建产物是 ad-hoc 签名的（在 macOS 上应用要能启动就必需这样做）。如果首次打开时 Gatekeeper 仍然抱怨：

```bash
xattr -dr com.apple.quarantine "release/PiStudio-darwin-arm64/PiStudio.app"
```

## 选项

| 选项 | 默认值 | 含义 |
|---|---|---|
| `--port` | `4173` | HTTP 端口（`0` = 选一个空闲端口） |
| `--host` | `127.0.0.1` | 绑定地址（仅 localhost） |
| `--cwd` | 当前目录 | pi 运行的工作目录 |
| `--pi` | `pi` | pi 二进制文件的路径 |
| `--trace-dir` | `./traces` | 轨迹文件的写入位置 |
| `--trace-keep` | `30` | 只保留最新的 N 次轨迹运行 |
| `--session-idle` | `600000` | 标签页的 pi 在没有客户端这么久之后被回收（毫秒） |
| `--no-gui-extension` | – | 不自动加载 `extensions/gui-bridge.ts` |
| `--no-inspector` | – | 不自动加载 `extensions/inspector.ts` |
| `--` | – | 剩余参数转发给 `pi --mode rpc` |

环境变量覆盖：`PORT`、`PI_GUI_CWD`、`PI_BIN`、`PI_GUI_TRACE_DIR`、`PI_GUI_TRACE_KEEP`、`PI_GUI_SESSION_IDLE`。

停止：`pkill -f "pi/server.js"`。

## HTTP API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/events?c=<id>&since=N` | 该标签页 pi 的 SSE 流：`__hello`（+待处理的 `dialogs`、当前 `seq`）、`__proc`、`__stderr`、`__raw`、`__marker`、`__ui_response`，以及所有 pi RPC 事件（标记 `__seq`/`__t`）。带 `since` 时，会先重放 `N` 之后缓冲的事件；当范围已不再被缓冲时，前面会加上 `__gap` |
| POST | `/api/command?c=<id>` | 转发原始 RPC 命令（包括 `extension_ui_response`） |
| GET | `/api/info?c=<id>` | 会话 id、cwd、pid、存活状态、轨迹文件 |
| GET | `/api/diagnostics?c=<id>` | 自检：客户端、最后命令/事件、运行时长、活动会话 |
| POST | `/api/restart?c=<id>` | 重启该标签页的 pi |
| GET | `/api/inspect?c=` | 检查器扩展捕获的内部信息 |
| GET | `/api/files?q=&limit=` | 用于 `@` 补全的项目文件索引（感知 git） |
| GET | `/api/traces` | 列出持久化的轨迹文件 |
| GET | `/api/trace?c=&file=…` | 读取一条轨迹（默认是该会话的运行） |
| POST | `/api/trace/marker?c=` | 向会话轨迹追加一个标记 |
| GET | `/api/sessions` | 列出当前 cwd 的已保存会话 |
| POST | `/api/session/delete` | 删除一个会话文件（检查路径） |
| GET | `/api/sessions?scope=all\|workspace&limit=` | **跨所有工作区**的已保存会话，带 `workspaceLabel` / `isCurrentWorkspace`，外加一个 `workspaces` 汇总 |
| GET | `/api/search?q=&limit=` | 跨已保存会话 transcript 的全文搜索 |
| GET | `/api/changes?c=` | 本会话写入的文件（+可用时的 git 状态），带每个文件的统计 |
| GET | `/api/changes/diff?c=&path=` | 单个文件的行 diff（`source`：`session` \| `git` \| `file`） |
| POST | `/api/changes/revert` | 备份并还原一个文件（检查路径） |

当服务器绑定到回环地址（loopback）之外时，每个 `/api/*` 调用还需要 `?token=…`（或 `x-pi-gui-token` 头）。

## 前端（React + Vite）

UI 已从原始的 vanilla `public/` 应用迁移到 React + TypeScript + Tailwind + shadcn/ui，复用了 `isometric-data-platform-landing-page` 模板中的设计 token。

```bash
node server.js --cwd . &          # API on :4173
npm run dev                       # Vite on :5173, proxies /api → :4173
npm run build                     # emits dist/, which server.js then serves
```

`server.js` 从 `dist/` 提供 Vite 构建产物（`npm run build`）。原始的 vanilla 前端归档在 `legacy/vanilla-ui/` 下，不再提供。

已移植到 React：带流式文本/思考 + Markdown/代码高亮的聊天、工具卡片（参数/输出）、图片附件、`@` 文件与 `/` 命令自动补全、输入历史与草稿持久化、编辑并重发 / 重试（分支 + 预填）、轨迹跳转标签、模型/思考选择器、会话侧边栏（工作区/时间分组、可折叠分组、内容搜索）、会话模态框（实时树 + 已保存会话列表，重命名 / 克隆 / 导出 HTML / 分支 / 书签 / 删除）、停靠面板（轨迹 / 更改 / 上下文检查器，可调整大小、持久化）、扩展 UI 对话框、桌面通知、steering/后续队列状态、toast、小组件、⌘K 命令面板、设置（舒适/紧凑 transcript）、浅色/深色/系统主题、英/中 i18n、统计/用量和诊断。原始的 vanilla 前端归档在 `legacy/vanilla-ui/` 下。

## 文件

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
  dev/make-screenshots.mjs regenerates dev/shot-*.png from the React UI
  dev/package.mjs         builds the macOS .app / .dmg (@electron/packager + hdiutil)
  dev/dialogs-demo.ts     extension exercising every dialog/UI method (/dialogtest)
  dev/task-debug.html     /tasks — debug board for the agent-task runtime
  dev/task-debug.js
  dev/shot-*.png          screenshots (referenced by this README)
  traces/                 persisted traces (gitignored)
```

## 测试

### React UI（当前前端）

```bash
npm test              # self-contained: own server + headless Chrome, exits 0/1
npm run test:quick    # same, skipping the real prompt round-trip
```

`dev/react-smoke.mjs` 在一个空闲端口上启动一个一次性的 `server.js` 和一个无头 Chrome，通过 CDP 驱动真实 UI，然后拆掉两者。它检查外壳、主题切换、布局持久化、侧边栏分组、⌘K 命令面板、会话/设置模态框、停靠面板的全部三个标签页、`@` 补全，以及（除非 `--no-chat`）一次真实的提示词往返 —— 并在任何控制台错误时失败。用 `--url http://127.0.0.1:4173/ --port 9222` 把它指向一个正在运行的实例；它在失败时以非零退出，因此可以兼作 CI 关卡。选择器与语言无关（结构 / ARIA / lucide 类名），因此切换英/中永远不会造成误报失败。

针对 Electron 外壳，它还会断言桌面相关部分：`is-electron` 类、可拖动的工具栏，以及 preload 桥。先给外壳开一个调试端口：

```bash
node_modules/.bin/electron --remote-debugging-port=9222 . &
node dev/react-smoke.mjs --url http://127.0.0.1:<internal-port>/ --port 9222
```

### 旧版 vanilla UI 套件（已归档）

这个 250 项检查的套件及其辅助工具针对的是原始的 `public/` 前端。它们归档在 `legacy/dev/` 下，不再针对 React 应用运行（`server.js` 只提供 `dist/`）：

```bash
# reference only — these need the vanilla UI restored to public/ and served
node legacy/dev/cdp-test.mjs          # 250 checks
node legacy/dev/i18n-check.mjs        # i18n key coverage (en/zh)
node legacy/dev/multi-tab-test.mjs    # two clients on one session
node legacy/dev/css-audit.mjs         # measured UI audit (scale, contrast, nesting)
node legacy/dev/make-screenshots.mjs  # 旧版截图（已被 dev/make-screenshots.mjs 取代）
```

覆盖（旧版）：连接、主题 + 样式 token（柔和默认和 neobrutalist 变体）、中英文切换与持久化、`@`/`/` 补全、命令面板、对话框焦点陷阱、会话树键盘导航、实时运行状态和流式光标、工具 diff 渲染 / 复制按钮 / 输出折叠、整条回答复制、人类可读的成本格式、跨真实刷新的草稿持久化、输入历史、滚动到最新、消息分页、诊断面板、编辑并重发（分支 + 预填）、图片附件、全部四种对话框 + 即发即忘方法、一次真实的流式提示词、会话树、会话过滤器、书签往返、已保存会话列表、完整轨迹流水线、服务器不可达恢复、陈旧对话框修剪，以及多客户端消息/对话框处理。

该套件把语言固定为英文（`pi-gui-lang`），因为它断言的是文案；中文部分由它自己的一组检查来覆盖。

同一会话上的两个浏览器实例（旧版）：

```bash
node legacy/dev/multi-tab-test.mjs
```

从 React UI 重新生成 README 截图（自包含 —— 会自己启动服务器和无头 Chrome，然后写出每个 `dev/shot-*.png`）：

```bash
node dev/make-screenshots.mjs
```

然后在 GUI 中输入 `/dialogtest` 手动试用这些对话框。该扩展默认**不会**加载 —— 它只为此而存在，因此在正常使用中永远不会弹出对话框。

从多个标签页看到同一个对话框：扩展 UI 请求会被广播，因此每个已连接的标签页都会显示该模态框。先回答者胜出；其余标签页关闭自己的模态框，并显示 *answered in another tab* toast。

## 注意事项 / 局限

- 绑定到 localhost 且**无认证** —— 它暴露了一个具备 shell 能力的 agent。不要把它绑定到公网接口。
- `custom()` 和仅 TUI 可用的 `ExtensionUIContext` 方法在 RPC 模式下是空操作（no-op）。
- `switch_session` 只列出当前工作目录的会话。
- 轨迹是每次服务器运行一个文件；`new session` 会添加一个标记，而不是拆分文件。
- 会话条目是不可变且只追加的，因此 GUI 无法删除节点或改写历史 —— 只能为它加书签、从它分叉，或删除整个文件。

---

<div align="center">

<sub><b>PiStudio</b> —— 为 <a href="https://pi.dev">pi</a> 而做。与 pi 项目无隶属关系。<br>
<a href="INSTALL.md">安装</a> · <a href="CHANGELOG.md">更新日志</a> · <a href="LICENSE">MIT 许可</a></sub>

</div>
