#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Tests that uninstall.sh removes only this extension's folder, and removes
# nothing when it cannot read the UUID from metadata.json.
#
#   tests/uninstall.test.sh        (or: make test)
#
# Runs a copy of uninstall.sh in a scratch dir with a fake data dir and stub
# gnome-extensions/gsettings/dconf commands, so it never touches the real
# session, settings or installed extensions.

set -euo pipefail
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT

UUID=screenshot-scan@awikman-bot.github.io
OTHER=someone-elses@example.com
passed=0
failed=0

check() { # check <name> <command…>
    local name=$1
    shift
    if "$@"; then
        echo "ok   $name"
        passed=$((passed + 1))
    else
        echo "FAIL $name"
        failed=$((failed + 1))
    fi
}

# Stubs: accept anything, change nothing. gsettings prints an empty list.
mkdir -p "$WORK/bin"
for cmd in gnome-extensions dconf; do
    printf '#!/bin/sh\nexit 0\n' > "$WORK/bin/$cmd"
done
printf '#!/bin/sh\n[ "$1" = get ] && echo "@as []"\nexit 0\n' > "$WORK/bin/gsettings"
chmod +x "$WORK/bin/"*

# run_uninstall <case name> <metadata.json content>; sets $status and $EXT
run_uninstall() {
    local dir="$WORK/$1"
    EXT="$dir/data/gnome-shell/extensions"
    mkdir -p "$dir/repo/extension" "$EXT/$UUID" "$EXT/$OTHER"
    touch "$EXT/$UUID/extension.js" "$EXT/$OTHER/extension.js"
    cp "$ROOT/uninstall.sh" "$dir/repo/"
    printf '%s\n' "$2" > "$dir/repo/extension/metadata.json"
    status=0
    PATH="$WORK/bin:$PATH" XDG_DATA_HOME="$dir/data" HOME="$dir/home" \
        bash "$dir/repo/uninstall.sh" >"$dir/out.log" 2>&1 || status=$?
}

run_uninstall valid "$(cat "$ROOT/extension/metadata.json")"
check "valid uuid: exits 0" test "$status" -eq 0
check "valid uuid: removes this extension" test ! -e "$EXT/$UUID"
check "valid uuid: keeps other extensions" test -e "$EXT/$OTHER/extension.js"

bad_case() { # bad_case <case name> <description> <metadata.json content>
    run_uninstall "$1" "$3"
    check "$2: exits with an error" test "$status" -ne 0
    check "$2: removes nothing" test -e "$EXT/$UUID/extension.js" -a -e "$EXT/$OTHER/extension.js"
}

bad_case missing    "no uuid key"          '{"name": "Screenshot Scan"}'
bad_case empty      "empty uuid"           '{"uuid": ""}'
bad_case multiline  "uuid on its own line" $'{"uuid":\n"screenshot-scan@awikman-bot.github.io"}'
bad_case traversal  "uuid with a path"     '{"uuid": "../../x@y"}'
bad_case dots       "uuid that is .."      '{"uuid": ".."}'

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
