#!/usr/bin/env python3
"""Write two original sample PDFs: one with a text layer, one made only of images."""
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
OUT = Path(__file__).resolve().parent.parent / 'samples'


def text_pdf(path):
    pages = [
        ('Harbor Notes', [
            'A small booklet about a quiet port.',
            'Written for the Flipbook sample, and nothing else.',
        ]),
        ('The marigold lighthouse', [
            'The marigold lighthouse keeps watch over the channel.',
            'Its lamp was lit by hand for ninety years.',
        ]),
        ('Stories on the quay', [
            'Sailors trade stories of a glass compass.',
            'Nobody agrees which drawer it was lost in.',
        ]),
        ('The copper bell', [
            'Chapter 3. The copper bell rings at dusk.',
            'Children race the last echo down the stone steps.',
        ]),
        ('Low tide', [
            'Low tide reveals the old stone steps.',
            'Kelp writes a dark line along each one.',
        ]),
        ('Index', [
            'bell, compass, lighthouse, marigold, tide',
            'Every word above is in this booklet on purpose.',
        ]),
    ]
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setTitle('Harbor Notes')
    c.setAuthor('Flipbook sample')
    width, height = letter
    for number, (title, lines) in enumerate(pages, start=1):
        c.setFillColorRGB(0.12, 0.14, 0.18)
        c.rect(0, 0, width, height, fill=1, stroke=0)
        c.setFillColorRGB(0.96, 0.93, 0.86)
        c.rect(36, 36, width - 72, height - 72, fill=1, stroke=0)
        c.setFillColorRGB(0.15, 0.16, 0.2)
        c.setFont('Times-Bold', 28)
        c.drawString(64, height - 120, title)
        c.setFont('Times-Roman', 16)
        y = height - 170
        for line in lines:
            c.drawString(64, y, line)
            y -= 28
        c.setFont('Times-Italic', 12)
        c.setFillColorRGB(0.35, 0.32, 0.28)
        c.drawString(64, 72, f'Harbor Notes  ·  page {number}')
        c.showPage()
    c.save()


def image_pdf(path):
    font = ImageFont.truetype(FONT, 72)
    small = ImageFont.truetype(FONT, 42)
    pages = [
        'COBALT LANTERN',
        'The north quay sells wool and ink.',
        'SCANNED PAGE THREE',
    ]
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setTitle('')
    width, height = letter
    for index, line in enumerate(pages):
        image = Image.new('RGB', (1275, 1650), 'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 1235, 1610), outline=(30, 30, 30), width=4)
        draw.text((90, 180), line, fill=(10, 10, 10), font=font)
        draw.text((90, 320), 'Image only. No text layer.', fill=(40, 40, 40), font=small)
        draw.text((90, 1500), f'page {index + 1}', fill=(40, 40, 40), font=small)
        buf = io.BytesIO()
        image.save(buf, format='JPEG', quality=92)
        buf.seek(0)
        c.drawImage(ImageReader(buf), 0, 0, width, height)
        c.showPage()
    c.save()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    text = OUT / 'harbor-notes.pdf'
    image = OUT / 'lantern-scan.pdf'
    text_pdf(text)
    image_pdf(image)
    print(text)
    print(image)


if __name__ == '__main__':
    main()
