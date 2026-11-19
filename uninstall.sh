#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Removes Screenshot Scan for the current user. Never uses sudo.
#
#   ./uninstall.sh          disable and remove the extension
#   ./uninstall.sh --purge  also delete its settings

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' extension/metadata.json)
# Stop unless the UUID is one plain name. An empty value would make the
# `rm -rf` below delete the folder that holds ALL of the user's extensions.
if [[ ! "$UUID" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]]; then
    echo "ERROR: could not read a valid \"uuid\" from extension/metadata.json. Nothing was changed." >&2
    exit 1
fi
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

# Disable: via the Shell if it knows the extension, else edit the list directly.
gnome-extensions disable "$UUID" 2>/dev/null || true
current=$(gsettings get org.gnome.shell enabled-extensions)
if [[ "$current" == *"'$UUID'"* ]]; then
    new=$(sed -e "s/'$UUID', //; s/, '$UUID'//; s/'$UUID'//" <<<"$current")
    [[ "$new" == "[]" ]] && new="@as []"
    gsettings set org.gnome.shell enabled-extensions "$new"
fi

gnome-extensions uninstall "$UUID" 2>/dev/null || true
rm -rf -- "$DIR"
echo "Removed $UUID."

if [[ "${1:-}" == "--purge" ]]; then
    dconf reset -f /org/gnome/shell/extensions/screenshot-scan/
    echo "Settings deleted."
fi

echo "Log out and back in to unload it from the running GNOME Shell."
