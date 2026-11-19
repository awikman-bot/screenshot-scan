#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Installs Screenshot Scan for the current user. Never uses sudo.
#
#   ./install.sh            check dependencies, install, enable
#   ./install.sh --no-enable  install only
#
# If system packages are missing, prints the exact `sudo dnf install …`
# command and exits 1 without installing anything.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' extension/metadata.json)
# Stop unless the UUID is one plain name (uninstall.sh has the same check).
if [[ ! "$UUID" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]]; then
    echo "ERROR: could not read a valid \"uuid\" from extension/metadata.json. Nothing was changed." >&2
    exit 1
fi
SCHEMA_ID=org.gnome.shell.extensions.screenshot-scan
ENABLE=1
[[ "${1:-}" == "--no-enable" ]] && ENABLE=0

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

# ---- 1. dependencies ------------------------------------------------------
missing_pkgs=()
missing_build=()

command -v gnome-extensions >/dev/null     || missing_build+=(gnome-shell)
command -v glib-compile-schemas >/dev/null || missing_build+=(glib2)
command -v zbarimg >/dev/null              || missing_pkgs+=(zbar)
if command -v tesseract >/dev/null; then
    # Languages the user configured earlier (default eng) must be installed.
    configured=eng
    if command -v glib-compile-schemas >/dev/null && glib-compile-schemas extension/schemas 2>/dev/null; then
        configured=$(gsettings --schemadir extension/schemas get "$SCHEMA_ID" ocr-languages 2>/dev/null \
            | tr -d "'" || true)
    fi
    installed_langs=$(tesseract --list-langs 2>/dev/null | tail -n +2)
    for l in ${configured//+/ }; do
        grep -qx "$l" <<<"$installed_langs" || missing_pkgs+=("tesseract-langpack-$l")
    done
else
    missing_pkgs+=(tesseract tesseract-langpack-eng)
fi

all_missing=("${missing_build[@]}" "${missing_pkgs[@]}")
if (( ${#all_missing[@]} > 0 )); then
    say "Screenshot Scan needs some system packages. Run this, then run ./install.sh again:"
    say ""
    say "    sudo dnf install ${all_missing[*]}"
    say ""
    say "  zbar        -> zbarimg, reads QR codes and barcodes"
    say "  tesseract   -> OCR engine; tesseract-langpack-XXX = language data"
    exit 1
fi

# ---- 2. GNOME Shell version ------------------------------------------------
if command -v gnome-shell >/dev/null; then
    shell_major=$(gnome-shell --version | sed -n 's/^GNOME Shell \([0-9]*\).*/\1/p')
    if ! grep -q "\"$shell_major\"" extension/metadata.json; then
        warn "GNOME Shell $shell_major is not listed in extension/metadata.json (shell-version)."
        warn "The extension will refuse to load. See AGENTS.md, 'Porting to a new GNOME version'."
    fi
fi

# ---- 3. build and install ----------------------------------------------------
mkdir -p build
glib-compile-schemas extension/schemas
zip="build/$UUID.shell-extension.zip"
gnome-extensions pack extension --force --out-dir=build \
    --extra-source=lib --extra-source=icons \
    --extra-source=../LICENSE --extra-source=../CREDITS.md >/dev/null
gnome-extensions install --force "$zip"
say "Installed to ${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

# ---- 4. enable ----------------------------------------------------------------
if (( ENABLE )); then
    # `gnome-extensions enable` only works once the running Shell has seen the
    # extension (on Wayland: after the next login), so fall back to GSettings.
    if ! gnome-extensions enable "$UUID" 2>/dev/null; then
        current=$(gsettings get org.gnome.shell enabled-extensions)
        if [[ "$current" != *"'$UUID'"* ]]; then
            if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
                new="['$UUID']"
            else
                new="${current%]}, '$UUID']"
            fi
            gsettings set org.gnome.shell enabled-extensions "$new"
        fi
    fi
    if [[ "$(gsettings get org.gnome.shell disable-user-extensions)" == "true" ]]; then
        warn "All user extensions are switched off (Extensions app → 'Use Extensions')."
    fi
    say "Enabled $UUID."
fi

say ""
if [[ "${XDG_SESSION_TYPE:-wayland}" == "wayland" ]]; then
    say "Log out and back in to load it (Wayland cannot reload GNOME Shell in place)."
else
    say "Press Alt+F2, type r, press Enter to reload GNOME Shell (X11), or log out and back in."
fi
say "Then press Print Screen and pick the new Scan button next to the camera/video buttons."
