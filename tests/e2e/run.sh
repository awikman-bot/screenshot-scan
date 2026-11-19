#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# End-to-end test in a real, throwaway, headless GNOME Shell (no display,
# no sudo, nothing touches your desktop session or your settings).
#
#   tests/e2e/run.sh        (or: make e2e)
#
# It uses a fresh HOME / XDG_RUNTIME_DIR under tests/e2e/out/, installs the
# extension and the harness (tests/e2e/harness) there, and starts
#   dbus-run-session gnome-shell --headless --virtual-monitor 1280x800
# The harness drives the screenshot UI and writes out/result.json.
# Output per scenario in tests/e2e/out/<scenario>/: shell.log, result.json
# and screen snapshots (screenshot-ui-scan-mode.png, prefs.png) to eyeball.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
ROOT=$(cd ../.. && pwd)
SCENARIO=${E2E_SCENARIO:-main}
OUT=$PWD/out/$SCENARIO
UUID=screenshot-scan@awikman-bot.github.io
HARNESS=screenshot-scan-e2e@awikman-bot.github.io
TIMEOUT=${E2E_TIMEOUT:-180}

rm -rf "$OUT"
mkdir -p "$OUT/home" "$OUT/run"
chmod 700 "$OUT/run"
EXT_DIR="$OUT/home/.local/share/gnome-shell/extensions"
mkdir -p "$EXT_DIR"

cp -r "$ROOT/extension" "$EXT_DIR/$UUID"
glib-compile-schemas "$EXT_DIR/$UUID/schemas"
cp -r harness "$EXT_DIR/$HARNESS"
# Give the fake user a real Pictures dir, like a normal desktop account.
mkdir -p "$OUT/home/.config" "$OUT/home/Pictures"
echo 'XDG_PICTURES_DIR="$HOME/Pictures"' > "$OUT/home/.config/user-dirs.dirs"

export HOME="$OUT/home"
export XDG_RUNTIME_DIR="$OUT/run"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_SESSION_ID
export E2E_OUT="$OUT"
export E2E_FIXTURES="$ROOT/tests/fixtures"
export E2E_SHOW_IMAGE="$PWD/show-image.js"
export GSK_RENDERER=cairo   # the GTK test window needs no GPU
export NO_AT_BRIDGE=1
export GTK_A11Y=none

# E2E_SCENARIO=missing-tools hides zbarimg and tesseract from $PATH to test
# the "needs more software" notifications.
if [[ "${E2E_SCENARIO:-}" == "missing-tools" ]]; then
    SHIM="$OUT/bin"
    mkdir -p "$SHIM"
    for p in /usr/bin/*; do
        case "${p##*/}" in zbarimg|tesseract) ;; *) ln -s "$p" "$SHIM/" ;; esac
    done
    export PATH="$SHIM"
fi
export E2E_SCENARIO="$SCENARIO"

echo "Starting headless GNOME Shell ($(gnome-shell --version)), scenario $E2E_SCENARIO, log: $OUT/shell.log"
set +e
timeout "$TIMEOUT" dbus-run-session -- bash -c "
    gsettings set org.gnome.shell enabled-extensions \"['$UUID', '$HARNESS']\"
    gsettings set org.gnome.desktop.interface enable-animations false
    gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
    exec gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800
" >"$OUT/shell.log" 2>&1
status=$?
set -e

grep -E '^E2E |screenshot-scan|JS ERROR|Error' "$OUT/shell.log" | grep -v 'dbus-daemon' || true

if [[ ! -f "$OUT/result.json" ]]; then
    echo "E2E: no result.json (shell exit $status). See $OUT/shell.log" >&2
    exit 1
fi

python3 - "$OUT/result.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
bad = [x for x in r if not x["ok"]]
print(f"\nE2E: {len(r) - len(bad)} passed, {len(bad)} failed")
for x in bad:
    print(f"  FAIL {x['name']}: {x['detail']}")
sys.exit(1 if bad or not r else 0)
PY
