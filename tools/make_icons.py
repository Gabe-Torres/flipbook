#!/usr/bin/env python3
"""Draw the Flipbook icons: an open book and a small glowing fairy. Original art."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'docs' / 'icons'


def pt(size, pad, x, y):
    return ((pad + x * (1 - 2 * pad)) * size, (pad + y * (1 - 2 * pad)) * size)


def background(size):
    im = Image.new('RGBA', (size, size))
    px = im.load()
    for y in range(size):
        t = y / max(1, size - 1)
        for x in range(size):
            cx = x / size - 0.5
            cy = y / size - 0.48
            vignette = max(0.0, 1 - (cx * cx * 1.35 + cy * cy * 1.15) * 2.1)
            r = 12 + 16 * (1 - t)
            g = 18 + 28 * (1 - t)
            b = 36 + 32 * (1 - t)
            lift = 0.45 + 0.55 * vignette
            px[x, y] = (int(r * lift), int(g * lift), int(b * lift), 255)
    return im


def draw_icon(size, pad):
    im = background(size)
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([pt(size, pad, 0.16, 0.66), pt(size, pad, 0.84, 0.80)], fill=(0, 0, 0, 110))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(radius=max(1, size * 0.018))))

    d = ImageDraw.Draw(im, 'RGBA')
    left = [pt(size, pad, 0.18, 0.42), pt(size, pad, 0.48, 0.36), pt(size, pad, 0.50, 0.72), pt(size, pad, 0.20, 0.76)]
    right = [pt(size, pad, 0.52, 0.36), pt(size, pad, 0.82, 0.42), pt(size, pad, 0.80, 0.76), pt(size, pad, 0.50, 0.72)]
    d.polygon(left, fill=(244, 236, 214, 255))
    d.polygon(right, fill=(255, 250, 240, 255))
    d.polygon([
        pt(size, pad, 0.43, 0.375), pt(size, pad, 0.50, 0.36),
        pt(size, pad, 0.50, 0.72), pt(size, pad, 0.43, 0.73),
    ], fill=(214, 196, 160, 255))
    d.polygon([
        pt(size, pad, 0.50, 0.36), pt(size, pad, 0.57, 0.375),
        pt(size, pad, 0.56, 0.73), pt(size, pad, 0.50, 0.72),
    ], fill=(226, 210, 176, 255))
    edge = max(2, size // 90)
    d.line([pt(size, pad, 0.18, 0.42), pt(size, pad, 0.48, 0.36)], fill=(212, 175, 55, 255), width=edge)
    d.line([pt(size, pad, 0.52, 0.36), pt(size, pad, 0.82, 0.42)], fill=(212, 175, 55, 255), width=edge)
    d.line([pt(size, pad, 0.20, 0.76), pt(size, pad, 0.50, 0.72)], fill=(186, 164, 120, 255), width=max(1, size // 160))
    d.line([pt(size, pad, 0.50, 0.72), pt(size, pad, 0.80, 0.76)], fill=(186, 164, 120, 255), width=max(1, size // 160))
    ink = (92, 78, 58, 170)
    lw = max(1, size // 170)
    for i, yy in enumerate((0.48, 0.54, 0.60)):
        shift = 0.008 * i
        d.line([pt(size, pad, 0.28, yy), pt(size, pad, 0.41, yy - 0.012)], fill=ink, width=lw)
        d.line([pt(size, pad, 0.59, yy - 0.012), pt(size, pad, 0.73, yy)], fill=ink, width=lw)
        if i == 0:
            d.line([pt(size, pad, 0.28, yy + shift), pt(size, pad, 0.36, yy - 0.006)], fill=(176, 146, 72, 220), width=lw)

    fx, fy = pt(size, pad, 0.64, 0.27)
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for rad, alpha, color in (
        (0.15, 36, (120, 170, 255)),
        (0.09, 70, (160, 205, 255)),
        (0.045, 120, (210, 230, 255)),
    ):
        r = rad * size * (1 - 2 * pad)
        gd.ellipse((fx - r, fy - r, fx + r, fy + r), fill=(*color, alpha))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(radius=max(1, size * 0.012))))

    wings = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wings)
    wd.ellipse([pt(size, pad, 0.46, 0.20), pt(size, pad, 0.62, 0.31)], fill=(214, 236, 255, 150))
    wd.ellipse([pt(size, pad, 0.66, 0.20), pt(size, pad, 0.82, 0.31)], fill=(214, 236, 255, 150))
    wd.ellipse([pt(size, pad, 0.50, 0.29), pt(size, pad, 0.61, 0.36)], fill=(186, 216, 255, 120))
    wd.ellipse([pt(size, pad, 0.67, 0.29), pt(size, pad, 0.78, 0.36)], fill=(186, 216, 255, 120))
    im.alpha_composite(wings)

    d = ImageDraw.Draw(im, 'RGBA')
    r = max(2, 0.026 * size * (1 - 2 * pad))
    d.ellipse((fx - r, fy - r, fx + r, fy + r), fill=(255, 255, 255, 245))
    arm = r * 2.4
    sw = max(1, size // 200)
    d.line((fx - arm, fy, fx + arm, fy), fill=(255, 255, 255, 210), width=sw)
    d.line((fx, fy - arm, fx, fy + arm), fill=(255, 255, 255, 210), width=sw)
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    full = draw_icon(512, 0.04).convert('RGB')
    mask = draw_icon(512, 0.14).convert('RGB')
    full.save(OUT / 'icon-512.png', optimize=True)
    mask.save(OUT / 'icon-maskable-512.png', optimize=True)
    full.resize((192, 192), Image.Resampling.LANCZOS).save(OUT / 'icon-192.png', optimize=True)
    full.resize((180, 180), Image.Resampling.LANCZOS).save(OUT / 'apple-touch-icon.png', optimize=True)
    full.resize((32, 32), Image.Resampling.LANCZOS).save(OUT / 'favicon-32.png', optimize=True)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
