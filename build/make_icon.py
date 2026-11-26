# -*- coding: utf-8 -*-
"""51 实验台图标：由源素材 icon_src.png 生成 512 母版与多尺寸 ICO。

桌面应用图标（electron-builder win.icon 引用 build/icon.ico）。
网页 favicon 仍由根目录 icon.svg 与内联 SVG 负责，不在本脚本范围。
"""
import os
from PIL import Image

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(OUT_DIR, "icon_src.png")
SIZES = [16, 24, 32, 48, 64, 128, 256]


def main():
    src = Image.open(SRC).convert("RGBA")
    side = min(src.size)
    if src.size[0] != src.size[1]:
        left = (src.size[0] - side) // 2
        top = (src.size[1] - side) // 2
        src = src.crop((left, top, left + side, top + side))

    master = src.resize((512, 512), Image.LANCZOS)
    master.save(os.path.join(OUT_DIR, "icon.png"))

    master.save(
        os.path.join(OUT_DIR, "icon.ico"),
        format="ICO",
        sizes=[(s, s) for s in SIZES],
    )
    print("saved build/icon.png / build/icon.ico")


if __name__ == "__main__":
    main()
