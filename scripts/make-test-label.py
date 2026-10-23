"""Génère une étiquette produit de test pour valider l'OCR en conditions réelles."""
from PIL import Image, ImageDraw, ImageFont
import os

os.makedirs(".tmp", exist_ok=True)

W, H = 900, 600
img = Image.new("RGB", (W, H), "#F5EFE6")
d = ImageDraw.Draw(img)

# Flacon stylisé
d.rounded_rectangle([300, 60, 600, 520], radius=24, fill="#E8C55A", outline="#8a7530", width=3)
d.rectangle([390, 30, 510, 65], fill="#8a7530")

LINES = [
    ("VITAMIN C SERUM", 46),
    ("BRIGHTENING", 30),
    ("30 ml  e 1.01 fl.oz", 22),
    ("SANS PARFUM", 20),
    ("Fabriqué en France", 18),
]

y = 250
for text, size in LINES:
    try:
        font = ImageFont.truetype("arial.ttf", size)
    except Exception:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    d.text(((W - w) / 2, y), text, fill="#2b2b2b", font=font)
    y += size + 22

img.save(".tmp/label.png")
print("OK .tmp/label.png", img.size)
