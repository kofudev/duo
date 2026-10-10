"""Rasterize the code-native Duo mark for the Windows executable."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
scale = 4
image = Image.new('RGBA', (256 * scale, 256 * scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 256 * scale - 1, 256 * scale - 1), radius=58 * scale, fill='#182019')
draw.ellipse((47 * scale, 71 * scale, 161 * scale, 185 * scale), fill='#b4d5a5')
draw.ellipse((100 * scale, 71 * scale, 214 * scale, 185 * scale), outline='#b4d5a5', width=11 * scale)
image = image.resize((256, 256), Image.Resampling.LANCZOS)
image.save(root / 'icon.png')
image.save(root / 'icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
