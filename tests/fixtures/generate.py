#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Regenerate the fixture PNGs in this folder.

The PNGs are committed, so you only need this when adding or changing a
fixture. Run it with `make fixtures`, which creates a throwaway venv
(no sudo) with Pillow, qrcode and python-barcode.

Text is drawn with the GNOME UI font (Adwaita Sans) at screen sizes
(no anti-aliasing tricks, 1x scale), so the images look like real
screenshots rather than ideal 300 dpi scans.

After changing anything here, update EXPECTED in ../pipeline.test.js.
"""

import io
import subprocess
from pathlib import Path

import barcode
import qrcode
from barcode.writer import ImageWriter
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent

# Payloads. Keep in sync with tests/pipeline.test.js.
QR_PAYLOAD = "https://example.com/screenshot-scan?id=42"
EAN13_PAYLOAD = "4006381333931"  # valid check digit
CODE128_PAYLOAD = "SCAN-128-TEST"
TEXT_LINES = [
    "Screenshot Scan reads text locally.",
    "Order number 58213 ships on Friday.",
    "Contact: matti.meikalainen@example.com",
]


def font(size):
    path = subprocess.run(
        ["fc-match", "-f", "%{file}", "Adwaita Sans"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return ImageFont.truetype(path, size)


def text_image(lines, size=16, fg="#1e1e1e", bg="#ffffff", pad=24):
    f = font(size)
    line_h = int(size * 1.6)
    width = max(int(f.getlength(line)) for line in lines) + 2 * pad
    height = line_h * len(lines) + 2 * pad
    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((pad, pad + i * line_h), line, font=f, fill=fg)
    return img


def qr_image(payload, box=6):
    qr = qrcode.QRCode(box_size=box, border=4)
    qr.add_data(payload)
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").convert("RGB")


def barcode_image(kind, payload):
    buf = io.BytesIO()
    code = barcode.get(kind, payload, writer=ImageWriter())
    # module_width 0.254 mm at 200 dpi = exactly 2 px per bar, like a crisp
    # barcode on screen (fractional widths blur and break decoding).
    code.write(buf, options={"module_width": 0.254, "module_height": 12.0,
                             "quiet_zone": 4.0,
                             "font_size": 8, "text_distance": 4.0,
                             "dpi": 200})
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def compose(parts, bg="#ffffff", pad=24, gap=24):
    width = max(p.width for p in parts) + 2 * pad
    height = sum(p.height for p in parts) + gap * (len(parts) - 1) + 2 * pad
    img = Image.new("RGB", (width, height), bg)
    y = pad
    for p in parts:
        img.paste(p, (pad, y))
        y += p.height + gap
    return img


def main():
    out = {
        "text.png": text_image(TEXT_LINES),
        "text-dark.png": text_image(TEXT_LINES, fg="#ffffff", bg="#242424"),
        "qr.png": qr_image(QR_PAYLOAD),
        "ean13.png": barcode_image("ean13", EAN13_PAYLOAD[:12]),
        "code128.png": barcode_image("code128", CODE128_PAYLOAD),
        "blank.png": Image.new("RGB", (320, 200), "#ffffff"),
        "mixed.png": compose([
            text_image(TEXT_LINES[:2]),
            qr_image(QR_PAYLOAD),
            barcode_image("ean13", EAN13_PAYLOAD[:12]),
        ]),
    }
    for name, img in out.items():
        img.save(HERE / name, optimize=True)
        print(f"wrote {name} {img.size[0]}x{img.size[1]}")


if __name__ == "__main__":
    main()
