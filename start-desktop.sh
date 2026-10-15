#!/usr/bin/env bash
# Launch the desktop (Electron) shell. Falls back to the browser UI if Electron
# is not installed yet.
#
#   ./start-desktop.sh
#   ./start-desktop.sh --cwd ~/my-project
#   ./start-desktop.sh -- --no-session
set -euo pipefail
CALLER_PWD="$PWD"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
# The desktop shell must run as Electron, not as Node. If this script was
# launched from a process whose environment carries ELECTRON_RUN_AS_NODE (e.g.
# a `pi` started by a PiStudio server), clear it or Electron runs as Node and
# crashes in electron/main.js. See the guard there.
unset ELECTRON_RUN_AS_NODE

if [ ! -x "$DIR/node_modules/.bin/electron" ] || [ ! -f "$DIR/node_modules/electron/path.txt" ]; then
  echo "Electron is not installed — run 'npm install' first (mirror is configured in .npmrc)." >&2
  echo "Falling back to the browser UI." >&2
  exec "$DIR/start.sh" --cwd "${PI_GUI_CWD:-$CALLER_PWD}" "$@"
fi

exec "$DIR/node_modules/.bin/electron" "$DIR" --cwd "${PI_GUI_CWD:-$CALLER_PWD}" "$@"
