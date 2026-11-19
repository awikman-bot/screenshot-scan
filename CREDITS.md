# Credits

Screenshot Scan is licensed under **GPL-2.0-or-later** (see `LICENSE`).
Everything listed below is compatible with that license.

## Copied or adapted code

| Project | URL | Author | License | What was used | Where |
|---|---|---|---|---|---|
| GNOME Shell 50.6 | https://gitlab.gnome.org/GNOME/gnome-shell (tag `50.6`, `js/ui/screenshot.js`) | The GNOME Shell authors | GPL-2.0-or-later | The texture / geometry / scale logic of `ScreenshotUI._saveScreenshot()`, adapted to stop at the PNG bytes instead of saving a file | `extension/lib/screenshotUiPatch.js`, function `captureSelectionPng()` (header comment marks it) |
| GNOME Shell 50.6 | https://gitlab.gnome.org/GNOME/gnome-shell (`eslint.config.js`) | Florian Müllner | MIT OR LGPL-2.1-or-later | eslint presets and rule overrides | `eslint.config.js` (SPDX header kept) |

## Tools used at development time (not shipped)

| Project | URL | License | Use |
|---|---|---|---|
| eslint-config-gnome | https://gitlab.gnome.org/World/javascript/eslint-config-gnome | MIT OR LGPL-2.1-or-later | `make lint` (npm devDependency, pinned to the commit gnome-shell 50.6 uses) |
| Pillow, qrcode, python-barcode | pypi.org | MIT-CMU / BSD / MIT | `tests/fixtures/generate.py` |

## Studied, not copied

These extensions were read to learn how others hook the screenshot UI
(details in `docs/research.md`). No code was copied from them.

| Project | URL | Author | License |
|---|---|---|---|
| Native Screenshot UI OCR Extended | https://github.com/oreocapybara/gnome-native-screenshot-ui-ocr-extended | oreocapybara | GPL-2.0-or-later |
| Screenshot OCR | https://github.com/nbubis/gnome-screenshot-ocr | Nathaniel B (nbubis) | MIT |
| Gradia Capture | https://github.com/AlexanderVanhee/gradia-capture | Alexander Vanhee | GPL-3.0 (deliberately not copied: would force GPL-3.0) |
| gnome-ocr-screenshot | https://github.com/funinkina/gnome-ocr-screenshot | Aryan Kushwaha (funinkina) | MIT |

## Runtime dependencies (installed separately, not bundled)

- **ZBar** (`zbarimg`), LGPL-2.1: https://github.com/mchehab/zbar
- **Tesseract OCR** (`tesseract`), Apache-2.0: https://github.com/tesseract-ocr/tesseract

## Artwork

`extension/icons/screenshot-scan-symbolic.svg` is original to this project.

`docs/screenshot.png` (README) is a crop of the e2e snapshot. Its background
is Fedora 44's default wallpaper `f44-01-day` (package
`f44-backgrounds-base`, CC-BY-SA-4.0, Fedora Design Team).
