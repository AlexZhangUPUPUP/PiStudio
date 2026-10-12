/**
 * pi-gui bridge extension — loaded automatically by the pi-gui server
 * (disable with `--no-gui-extension`).
 *
 * Provides the RPC-driven commands the GUI needs but the RPC protocol does not
 * expose directly. Currently: bookmark labels on session entries.
 *
 *   /gui-label <entryId> [label...]   set a label (empty label clears it)
 *
 * Labels are written through pi's own SessionManager, so they show up in both
 * the GUI session tree and pi's TUI `/tree`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("gui-label", {
    description: "Set or clear a bookmark label on a session entry (used by pi-gui)",
    handler: async (args, ctx) => {
      const input = String(args ?? "").trim();
      const sp = input.indexOf(" ");
      const entryId = sp === -1 ? input : input.slice(0, sp);
      const label = sp === -1 ? "" : input.slice(sp + 1).trim();
      if (!entryId) {
        ctx.ui.notify("gui-label: expected an entry id", "error");
        return;
      }
      pi.setLabel(entryId, label || undefined);
      ctx.ui.notify(label ? `bookmarked ${entryId}: ${label}` : `removed bookmark from ${entryId}`, "info");
    },
  });
}
