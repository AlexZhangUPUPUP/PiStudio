#!/usr/bin/env bash
# Launch the pi web GUI in the current directory.
#   ./start.sh                              # GUI in $PWD
#   ./start.sh --cwd /path/to/project       # GUI in another dir
#   ./start.sh --port 5173 -- --no-session  # args after -- go to pi
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/server.js" --cwd "${PI_GUI_CWD:-$PWD}" "$@"
