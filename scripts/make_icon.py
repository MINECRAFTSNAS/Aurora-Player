"""生成应用图标：圆角渐变底 + 中央声波竖条，输出多尺寸 .ico 与 .png。

用法：python scripts/make_icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
BUILD.mkdir(parents=True, exist_ok=True)

S = 256
SS = 4  # 超采样倍数，令圆角与圆头端点更平滑
W = S * SS

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# --- 圆角渐变底：用逐行插值模拟 45° 线性渐变 ---
from_c = (76, 194, 255)
to_c = (160, 108, 255)
pad = int(8 * SS)
radius = int(52 * SS)
box = (pad, pad, W - pad, W - pad)

grad = Image.new("RGB", (W, W))
gp = grad.load()
for y in range(W):
    for x in range(W):
        # 45° 方向投影
        t = (x + y) / (2 * (W - 1))
        gp[x, y] = (
            int(from_c[0] + (to_c[0] - from_c[0]) * t),
            int(from_c[1] + (to_c[1] - from_c[1]) * t),
            int(from_c[2] + (to_c[2] - from_c[2]) * t),
        )

mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# --- 中央声波竖条（圆头） ---
heights = [46, 92, 138, 100, 58]
bar_w = 16 * SS
gap = 33 * SS
mid = W // 2
start_x = mid - int(gap * (len(heights) - 1) / 2)

for i, h in enumerate(heights):
    x = start_x + i * gap
    hh = h * SS
    d.rounded_rectangle(
        (x - bar_w // 2, mid - hh // 2, x + bar_w // 2, mid + hh // 2),
        radius=bar_w // 2,
        fill=(16, 32, 44, 255),
    )

img = img.resize((S, S), Image.LANCZOS)
img.save(BUILD / "icon-256.png")

# --- 多尺寸 ICO（Windows 会按 DPI 自动挑最合适的一档） ---
sizes = [16, 24, 32, 48, 64, 128, 256]
img.save(BUILD / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes])

print(f"icon.ico     : {(BUILD / 'icon.ico').stat().st_size:,} bytes")
print(f"icon-256.png : {(BUILD / 'icon-256.png').stat().st_size:,} bytes")
print(f"sizes        : {sizes}")
