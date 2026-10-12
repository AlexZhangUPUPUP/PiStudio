/**
 * pi-gui inspector — makes the harness observable.
 *
 * Loaded automatically by the pi-gui server (disable with `--no-inspector`).
 * It is inert unless PI_GUI_URL is set, i.e. only when pi was spawned by the GUI.
 *
 * Nothing here changes behaviour: every handler returns undefined, so pi's own
 * payloads, prompts and tool arguments are passed through untouched. Captures are
 * POSTed to the GUI, which keeps them per session for the Inspector panel.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const base = process.env.PI_GUI_URL;
  if (!base) return;

  // The main pi gets this extension via `-e`; sub-agents (spawned by the
  // subagent tool) pick it up from ~/.pi/agent/extensions. Loading it twice in
  // one process must not register the hooks twice.
  const g = globalThis as any;
  if (g.__piGuiInspectorLoaded) return;
  g.__piGuiInspectorLoaded = true;

  const session = process.env.PI_GUI_SESSION || "default";
  const endpoint = `${base}/api/inspect?c=${encodeURIComponent(session)}`;

  /* ---- who am I? ------------------------------------------------------- *
   * The server spawns the main pi itself, so it knows that pid. Anything else
   * reporting for this session is a sub-agent; the task text and the model are
   * in the child's argv (the subagent tool passes them on the command line).  */
  const argv = process.argv.slice(1);
  const taskArg = argv.find((a) => a.startsWith("Task: ")) || "";
  const modelFlag = argv.indexOf("--model");
  const identity = {
    pid: process.pid,
    ppid: process.ppid,
    child: argv.includes("json") || argv.includes("--no-session"),
    task: taskArg.replace(/^Task:\s*/, "").slice(0, 400) || null,
    model: modelFlag >= 0 ? argv[modelFlag + 1] || null : null,
  };

  const clip = (s: unknown, n: number): string | null => {
    if (typeof s !== "string") return null;
    return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s;
  };

  const post = (kind: string, data: unknown): void => {
    try {
      void fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, at: Date.now(), data, agent: identity }),
      }).catch(() => {});
    } catch {
      /* never let instrumentation break the agent */
    }
  };

  const textOf = (message: any): string => {
    if (!message) return "";
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((c: any) => (c?.type === "text" ? c.text : c?.type === "thinking" ? `[thinking ${c.thinking?.length ?? 0}]` : `[${c?.type}]`))
        .join(" ");
    }
    return "";
  };

  /* ---- what pi decides to tell the model --------------------------------- */

  pi.on("before_agent_start", (event) => {
    const o: any = event.systemPromptOptions || {};
    post("system_prompt", {
      prompt: clip(event.prompt, 4000),
      systemPrompt: clip(event.systemPrompt, 300000),
      chars: event.systemPrompt?.length ?? 0,
      images: event.images?.length ?? 0,
      cwd: o.cwd,
      customPrompt: clip(o.customPrompt, 40000),
      appendSystemPrompt: clip(o.appendSystemPrompt, 40000),
      selectedTools: o.selectedTools || [],
      toolSnippets: o.toolSnippets || {},
      promptGuidelines: o.promptGuidelines || [],
      contextFiles: (o.contextFiles || []).map((f: any) => ({ path: f.path, chars: (f.content || "").length })),
      skills: (o.skills || []).map((s: any) => ({ name: s.name, description: s.description, path: s.filePath })),
    });
  });

  /* ---- the exact message array handed to the model ----------------------- */

  pi.on("context", (event) => {
    const msgs: any[] = event.messages || [];
    post("context", {
      count: msgs.length,
      chars: msgs.reduce((n, m) => n + textOf(m).length, 0),
      messages: msgs.map((m) => ({
        role: m?.role,
        types: Array.isArray(m?.content) ? m.content.map((c: any) => c?.type) : ["text"],
        chars: textOf(m).length,
        preview: clip(textOf(m).replace(/\s+/g, " ").trim(), 180),
      })),
    });
  });

  /* ---- what actually goes on the wire ----------------------------------- */

  pi.on("before_provider_request", (event) => {
    const p: any = event.payload || {};
    const messages = Array.isArray(p.messages) ? p.messages : [];
    const tools = Array.isArray(p.tools) ? p.tools : [];
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (k === "messages" || k === "tools") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) params[k] = v;
      else if (Array.isArray(v) && v.length < 12) params[k] = v;
    }
    post("request", {
      params,
      messageCount: messages.length,
      toolCount: tools.length,
      toolNames: tools.map((t: any) => t?.function?.name || t?.name || "?"),
      messageRoles: messages.map((m: any) => m?.role),
      bytes: JSON.stringify(p).length,
      raw: clip(JSON.stringify(messages, null, 1), 200000),
    });
    return undefined; // pass through unchanged
  });

  /* ---- extension / capability audit ------------------------------------- */

  /** keep only JSON-safe primitives so a fancy sourceInfo can never break us */
  const plain = (v: unknown, depth = 0): unknown => {
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    if (depth > 2) return undefined;
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => plain(x, depth + 1)).filter((x) => x !== undefined);
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === "function") continue;
        const p = plain(val, depth + 1);
        if (p !== undefined) out[k] = p;
      }
      return out;
    }
    return undefined;
  };

  const reportInventory = (reason: string) => {
    let tools: any[] = [];
    let commands: any[] = [];
    try {
      tools = (pi as any).getAllTools?.() || [];
    } catch {}
    try {
      commands = (pi as any).getCommands?.() || [];
    } catch {}
    post("inventory", {
      reason,
      tools: tools.map((t) => ({
        name: t?.name,
        description: t?.description,
        parameters: plain(t?.parameters),
        source: plain(t?.sourceInfo),
      })),
      commands: commands.map((c) => ({
        name: c?.name,
        description: c?.description,
        source: c?.source,
        path: c?.path,
      })),
    });
  };

  pi.on("resources_discover", (event) => {
    post("resources", { cwd: event.cwd, reason: event.reason });
    reportInventory(event.reason);
  });

  /* ---- was the payload touched by another extension? -------------------- */

  pi.on("after_provider_response", (event) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(event.headers || {})) {
      if (/rate|limit|request-id|retry-after|content-type|x-|anthropic-ratelimit/i.test(k)) headers[k] = String(v);
    }
    post("response", { status: event.status, headers });
    return undefined;
  });

  /* ---- compaction ------------------------------------------------------- */

  pi.on("session_compact", (event) => {
    const c: any = event.compactionEntry || {};
    post("compact", {
      reason: event.reason,
      willRetry: event.willRetry,
      fromExtension: event.fromExtension,
      tokensBefore: c.tokensBefore ?? null,
      firstKeptEntryId: c.firstKeptEntryId ?? null,
      retainedTail: Array.isArray(c.retainedTail) ? c.retainedTail.length : null,
      summaryChars: (c.summary || "").length,
      summary: clip(c.summary, 40000),
    });
  });

  /* ---- tool results, as the model receives them ------------------------- */

  pi.on("tool_result", (event) => {
    const text = (event.content || [])
      .map((c: any) => (c?.type === "text" ? c.text : c?.type === "image" ? "[image]" : ""))
      .join("\n");
    post("tool_result", {
      toolName: event.toolName,
      isError: event.isError,
      chars: text.length,
      inputKeys: Object.keys(event.input || {}),
      usage: event.usage ?? null,
      preview: clip(text.replace(/\s+/g, " ").trim(), 400),
    });
    return undefined;
  });

}
