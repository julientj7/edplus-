#!/usr/bin/env python3
"""Génère les icônes de l'extension.

Pourquoi un script plutôt que des PNG committés à la main : une icône doit
pouvoir être régénérée en une commande quand la charte change, et le dépôt reste
léger et lisible (aucun binaire opaque).

Choix technique : encodeur PNG écrit à la main, avec la bibliothèque standard
uniquement (zlib + struct). Pillow n'est donc PAS nécessaire — le script tourne
sur n'importe quelle machine ayant Python 3, y compris une CI minimale.

Usage :
    python3 scripts/make-icons.py

Produit :
    icons/icon-16.png, icon-32.png, icon-48.png, icon-96.png, icon-128.png
    icons/icon.svg
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"

SIZES = (16, 32, 48, 96, 128)

# Dégradé bleu (identique à --edp-accent de styles/tokens.css, éclairci en haut).
BG_TOP = (47, 128, 245)
BG_BOTTOM = (13, 66, 150)
PLUS_COLOR = (255, 255, 255)

SUPERSAMPLE = 4  # 4x4 sous-échantillons par pixel : arêtes lisses dès 16 px.


def in_rounded_rect(x: float, y: float, size: float, radius: float) -> bool:
    """Point dans un carré aux coins arrondis, à bords pleins.

    Un carré arrondi est exactement l'union d'UNE CROIX ([r, size-r] × [0, size]
    et [0, size] × [r, size-r]) et des QUATRE DISQUES de rayon r centrés sur les
    coins.

    Piège déjà rencontré ici : tester la distance aux quatre centres de coin pour
    chaque point perce la forme avec les cercles opposés (le coin (20,20) d'une
    icône de 128 devient transparent). Seul le disque du quadrant auquel
    appartient le point peut le contenir.
    """
    if x < 0 or y < 0 or x > size or y > size:
        return False
    if radius <= x <= size - radius or radius <= y <= size - radius:
        return True
    cx = radius if x < size / 2 else size - radius
    cy = radius if y < size / 2 else size - radius
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def in_plus(x: float, y: float, cx: float, cy: float, arm: float, thickness: float) -> bool:
    """Point dans le « + » : deux barres centrées."""
    half_arm = arm / 2
    half_thick = thickness / 2
    horizontal = abs(x - cx) <= half_arm and abs(y - cy) <= half_thick
    vertical = abs(y - cy) <= half_arm and abs(x - cx) <= half_thick
    return horizontal or vertical


def render(size: int) -> bytearray:
    """Rend l'icône en RGBA non prémultiplié, avec anticrénelage."""
    pixels = bytearray(size * size * 4)
    radius = size * 0.22
    center = size / 2
    thickness = max(1.0, size * 0.17)
    arm = size * 0.54
    samples = SUPERSAMPLE * SUPERSAMPLE

    for py in range(size):
        for px in range(size):
            red = green = blue = 0.0
            covered = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = px + (sx + 0.5) / SUPERSAMPLE
                    y = py + (sy + 0.5) / SUPERSAMPLE
                    if not in_rounded_rect(x, y, size, radius):
                        continue
                    covered += 1
                    if in_plus(x, y, center, center, arm, thickness):
                        r, g, b = PLUS_COLOR
                    else:
                        t = y / size
                        r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t
                        g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t
                        b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t
                    red += r
                    green += g
                    blue += b

            index = (py * size + px) * 4
            if covered:
                pixels[index] = round(red / covered)
                pixels[index + 1] = round(green / covered)
                pixels[index + 2] = round(blue / covered)
                pixels[index + 3] = round(255 * covered / samples)
    return pixels


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    """Encode un PNG RGBA 8 bits minimal (un seul IDAT, filtre 0)."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # type de filtre : aucun
        raw.extend(pixels[y * stride : (y + 1) * stride])

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 6 = RGBA
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(payload)


def write_svg(path: Path) -> None:
    """Version vectorielle, pour la documentation et les fonds d'écran retina."""
    top = "#%02x%02x%02x" % BG_TOP
    bottom = "#%02x%02x%02x" % BG_BOTTOM
    path.write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="École Directe Plus+">
  <defs>
    <linearGradient id="edp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{top}"/>
      <stop offset="1" stop-color="{bottom}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="28" fill="url(#edp)"/>
  <path d="M64 30v68M30 64h68" stroke="#ffffff" stroke-width="22" stroke-linecap="butt"/>
</svg>
""",
        encoding="utf-8",
    )


def main() -> int:
    ICONS.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        target = ICONS / f"icon-{size}.png"
        write_png(target, size, size, render(size))
        print(f"écrit {target.relative_to(ROOT)} ({target.stat().st_size} octets)")
    write_svg(ICONS / "icon.svg")
    print("écrit icons/icon.svg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
