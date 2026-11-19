# Research: hooking GNOME's native screenshot UI

Date: 2026-11-19. Target: Fedora 44, GNOME Shell 50.6, Wayland (verified with
`gnome-shell --version` → `GNOME Shell 50.6`, `/etc/fedora-release` →
`Fedora release 44 (Forty Four)`. The agent's shell had no graphical session,
so `$XDG_SESSION_TYPE` was empty there; the user's desktop session is
Wayland). The user plans to move to Fedora 45, which ships gnome-shell 51.1,
so 51 was also reviewed (see "GNOME 50 vs 51" below).

## The problem

The Print Screen UI is `Main.screenshotUI`, a single `ScreenshotUI` instance
from `resource:///org/gnome/shell/ui/screenshot.js`. There is **no public
extension API** for it. Every extension that adds to it touches private
members (names starting with `_`), which GNOME may rename in any release.

The relevant flow in gnome-shell 50.6 `js/ui/screenshot.js`:

- `open(mode)` freezes the screen into `_stageScreenshot` with
  `Shell.Screenshot.screenshot_stage_to_content()` and shows the overlay.
- The capture button, Enter, Space and Ctrl+C all call
  `this._onCaptureButtonClicked()`. That method is looked up on the instance
  at call time, so an instance property overrides it.
- `_onCaptureButtonClicked()` → `_saveScreenshot()` → module function
  `captureScreenshot()` → `Shell.Screenshot.composite_to_stream()` →
  `_storeScreenshot()`, which **copies the PNG to the clipboard, saves it to
  ~/Pictures/Screenshots, adds it to recent files and shows a notification**.
  It also plays the shutter sound. `captureScreenshot` is an ES module export,
  so it cannot be replaced from outside.
- `_shotCastContainer` holds the "Take Screenshot" (camera) and
  "Record Screen" toggles. They are bound together inversely with
  `bind_property(…, INVERT_BOOLEAN)`.
- `_typeButtonContainer` holds Selection / Screen / Window (homogeneous box).
- `close()` → `_finishClosing()` resets `_shotButton.checked = true` and
  emits `closed`.

## Reference extensions

| | Native Screenshot UI OCR Extended | Screenshot OCR (nbubis) | Gradia Capture | gnome-ocr-screenshot |
|---|---|---|---|---|
| Source | github.com/oreocapybara/gnome-native-screenshot-ui-ocr-extended | github.com/nbubis/gnome-screenshot-ocr | github.com/AlexanderVanhee/gradia-capture | github.com/funinkina/gnome-ocr-screenshot |
| EGO | 10254 | 9338 | — | not an extension (Python script) |
| GNOME versions | 45–50 | 49 | 49–51 | any (uses the D-Bus portal/CLI) |
| License | **GPL-2.0-or-later** | **MIT** | **GPL-3.0** | **MIT** |
| Hook point | Toggle button added to `_showPointerButtonContainer` (or optionally a 4th button in `_typeButtonContainer`). Clicking it closes and reopens the UI in an "OCR session" | Wraps `ScreenshotUI.prototype.open`. Adds a toggle to `_shotCastContainer` and replaces `_onCaptureButtonClicked` on the instance | Replaces `open` and `_saveScreenshot` on the instance. Adds its own toolbar to `_primaryMonitorBin` | n/a |
| How it gets the image | For one capture, swaps the instance's `_saveScreenshot` for a copy that calls `Shell.Screenshot.composite_to_stream` and writes a `/tmp` PNG, then emits `screenshot-taken` | Lets GNOME save the normal file (so it is also put on the clipboard and in recent files), then reads it from the `screenshot-taken` signal and deletes it | Its own `composite_to_stream` call from the stage/window texture | Calls an external screenshot tool, then pytesseract + pyzbar |
| Area / Screen / Window | Area only (Screen and Window are disabled during OCR) | Area only (button hidden otherwise) | all | area |
| Clipboard | `St.Clipboard.set_text` | `St.Clipboard.set_text` | `St.Clipboard.set_content` (image) | `wl-copy`/`xclip` |
| Barcodes / QR | no | no | no | yes (pyzbar) |
| Cleanup in `disable()` | removes widgets; the `_saveScreenshot` swap only lives for one capture | restores the prototype `open`; the `_onCaptureButtonClicked` instance override and its `notify::checked` handlers on native buttons are **not** removed | restores `open`, `_saveScreenshot` and signals | n/a |

Notes:

- **oreocapybara** documents a real Shell layout bug: a 4th child in the
  homogeneous `_typeButtonContainer` gets stretched after suspend. That is a
  good reason not to put our button there.
- **nbubis** picked the most natural place for a new *mode*
  (`_shotCastContainer`), but it saves a real screenshot file and leaves
  handlers behind after `disable()`.
- **Gradia** shows that instance-level `composite_to_stream` capture works
  for area, screen and window on GNOME 49–51. It is GPL-3.0, so **no code
  was copied** from it; GPL-3.0 code would force this project to GPL-3.0.
- **funinkina** only served as a reference for the decode-to-clipboard logic
  (codes first, then text). We use the `zbarimg`/`tesseract` CLIs instead
  of Python bindings, so no code was copied.

## Chosen approach

1. **Button placement:** a third toggle in `_shotCastContainer` (Screenshot ·
   Record · **Scan**), styled with the native `screenshot-ui-shot-cast-button`
   class, using GNOME's own exported `Tooltip`. Scan is a *capture mode*, not
   an area type, so it combines with Selection, Screen and Window. This
   satisfies "capture an area, a window or the screen" without touching the
   homogeneous type row.
2. **Radio behaviour:** with Scan on, `_shotButton` stays `checked`
   underneath, so all of GNOME's screenshot-mode logic (frozen screen, window
   picking) keeps working unchanged. Only its `:checked` highlight is removed.
   Clicking the camera or switching to Record turns Scan off. Closing the UI
   resets it, like GNOME resets Record.
3. **Capture hook:** an **instance** property `_onCaptureButtonClicked` that
   passes straight through to the original unless Scan is on. Reasons:
   - It is one method, called from every capture path (button, Enter, Space,
     Ctrl+C), and its signature has not changed between 50 and 51.
   - It never touches the prototype, so other `ScreenshotUI` instances and
     other extensions' prototype patches are unaffected.
   - `disable()` deletes the property, which exposes the prototype method
     again. If another extension wrapped ours in the meantime, we leave a
     pure pass-through in place instead of breaking their chain.
4. **Getting the pixels:** a copy of `_saveScreenshot()`'s texture/geometry
   logic, stopping at `Shell.Screenshot.composite_to_stream()` → PNG bytes
   in memory. This means no file in ~/Pictures/Screenshots, no image on the
   clipboard, no recent-files entry, no shutter sound and no pointer in the
   image. This duplicates about 30 lines of gnome-shell code (credited in
   `CREDITS.md`), but it is the only way to avoid `_storeScreenshot()`. The
   alternative (let GNOME save, then delete the file) leaves recent-files
   entries and overwrites the clipboard image, and it fails when
   `org.gnome.desktop.lockdown disable-save-to-disk` is set.
5. **Pipeline in the extension itself, no Python helper:** `zbarimg --raw -q`
   and `tesseract <png> - -l <langs>` run via `Gio.Subprocess` (async). The
   PNG goes to a mode-0600 file in `$XDG_RUNTIME_DIR` and is deleted in a
   `finally` block. Leftovers from a crash are purged on `enable()`. The
   module `lib/pipeline.js` has no Shell imports, so `gjs` can test it
   headless. In `auto` mode zbar runs first (milliseconds) and tesseract only
   if no code was found. `OMP_THREAD_LIMIT=1` stops tesseract's OpenMP
   busy-spinning, which is slower for screenshot-sized images.
6. **Not offered in portal mode:** when an app requests an interactive
   screenshot via D-Bus/portal (`open(UIMode.SCREENSHOT_ONLY)`), the caller
   expects a file back, so the Scan button is hidden.

Deviations from the original design guidance: none of substance. Code was
copied only from gnome-shell itself (GPL-2.0-or-later, the same license as
this project). The eslint setup is adapted from gnome-shell's
(MIT OR LGPL-2.1-or-later, compatible).

## GNOME 50 vs 51

`git diff 50.6 51.1 -- js/ui/screenshot.js` (+559/−215 lines) mostly
rewrites the area selector (pan gestures, keyboard resizing). Everything this
extension relies on is unchanged:

- `_saveScreenshot()` / `_getSelectedGeometry()` / `_onCaptureButtonClicked()`:
  identical apart from one blank line.
- `_shotCastContainer`, `_shotButton`, `_castButton`, `_captureButton`
  construction: identical.
- `UIMode` values, `Tooltip` export, `closed` signal: unchanged.
- `messageTray.js`: `MessageTray` became an ES class; the `Source` and
  `Notification` constructors we use are unchanged.

So `metadata.json` lists `["50", "51"]`. 51 has been checked against the
source only; it will be tested at runtime (`make e2e`) after the Fedora 45
upgrade.

## Testing strategy discovered during research

`gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800` under
`dbus-run-session` runs a complete, real GNOME Shell with no display, no
`mutter-devkit` and no sudo. `tests/e2e/` uses it to run the real
screenshot UI with a harness extension. That is stronger than the
`--devkit` nested session, which needs a person watching a window.
