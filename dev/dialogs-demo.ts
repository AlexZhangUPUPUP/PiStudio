/**
 * Demo extension for exercising the pi-gui extension UI bridge.
 * Load with:  pi --mode rpc -e ./dev/dialogs-demo.ts
 *
 * Then type `/dialogtest` in the GUI. It walks through every dialog method
 * plus the fire-and-forget UI methods.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("dialogtest", {
    description: "Exercise pi-gui dialogs (select/confirm/input/editor/notify/…)",
    handler: async (_args, ctx) => {
      ctx.ui.notify("dialogtest: starting", "info");
      ctx.ui.setTitle("π GUI — dialogtest");
      ctx.ui.setStatus("dialogtest", "running dialogs…");
      ctx.ui.setWidget("dialogtest", ["--- dialogtest ---", "step 1/4: select"]);

      const choice = await ctx.ui.select("Pick a fruit", ["apple", "banana", "cherry"]);
      ctx.ui.notify(`select -> ${choice ?? "(cancelled)"}`, choice ? "info" : "warning");

      ctx.ui.setWidget("dialogtest", ["--- dialogtest ---", "step 2/4: confirm"]);
      const ok = await ctx.ui.confirm("Proceed?", "This is a yes/no confirmation.");
      ctx.ui.notify(`confirm -> ${ok}`, ok ? "info" : "warning");

      ctx.ui.setWidget("dialogtest", ["--- dialogtest ---", "step 3/4: input"]);
      const text = await ctx.ui.input("Your name", "type here…");
      ctx.ui.notify(`input -> ${text ?? "(cancelled)"}`, "info");

      ctx.ui.setWidget("dialogtest", ["--- dialogtest ---", "step 4/4: editor"]);
      const edited = await ctx.ui.editor("Edit some text", "line one\nline two\nline three");
      ctx.ui.setEditorText("prefilled by dialogtest");

      ctx.ui.setStatus("dialogtest", "");
      ctx.ui.setWidget("dialogtest", []);
      ctx.ui.setTitle("π GUI");

      pi.sendMessage?.({
        customType: "dialogtest",
        content: `dialogtest results: select=${choice} confirm=${ok} input=${text} editor=${(edited ?? "").length} chars`,
        display: true,
      });
    },
  });

  pi.registerCommand("force-dialogs", {
    description: "Trigger a confirm + select from a tool-call guard style flow",
    handler: async (_args, ctx) => {
      const ok = await ctx.ui.confirm("Force confirm", "Do you allow this?");
      if (!ok) {
        ctx.ui.notify("blocked by user", "warning");
        return;
      }
      const pick = await ctx.ui.select("Choose severity", ["low", "medium", "high"], { timeout: 15000 });
      ctx.ui.notify(`severity: ${pick ?? "(timed out)"}`, "info");
    },
  });
}
