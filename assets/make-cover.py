"""生成封面图：宽版（仓库/社交预览）与方版（市场列表）。"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_CJK = "C:/Windows/Fonts/msyh.ttc"
FONT_MONO = "C:/Windows/Fonts/consola.ttf"
FALLBACK = "C:/Windows/Fonts/simhei.ttf"

INK_TOP = (13, 15, 19)
INK_BOTTOM = (28, 31, 37)
CREAM = (243, 238, 230)
AMBER = (232, 192, 125)
MINT = (143, 208, 168)
GREY = (158, 160, 169)
DIM = (105, 107, 115)


def font(path, size):
    for candidate in (path, FALLBACK):
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    raise SystemExit(f"找不到字体: {path}")


def background(width, height):
    img = Image.new("RGB", (width, height), INK_TOP)
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(int(INK_TOP[i] + (INK_BOTTOM[i] - INK_TOP[i]) * t) for i in range(3)),
        )
    return img.convert("RGBA")


def glow(img, center, radius, color, alpha):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x, y = center
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (alpha,))
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(max(40, radius // 2))))


def chip(draw, xy, text, font_obj, color):
    x, y = xy
    pad_x, pad_y = 17, 10
    w = draw.textlength(text, font=font_obj)
    h = font_obj.size
    draw.rounded_rectangle(
        [x, y, x + w + pad_x * 2, y + h + pad_y * 2],
        radius=(h + pad_y * 2) // 2,
        outline=(color[0], color[1], color[2], 150),
        width=2,
    )
    draw.text((x + pad_x, y + pad_y - 2), text, font=font_obj, fill=color)
    return w + pad_x * 2


def text_lines(draw, x0, x1, y0, gap, count, scale):
    widths = [1.0, 0.86, 0.93, 0.62, 0.9, 0.5, 0.78, 0.4]
    for i in range(count):
        y = y0 + i * gap
        x_end = x0 + (x1 - x0) * widths[i % len(widths)]
        highlight = i == 2
        fill = (232, 192, 125, 88) if highlight else (255, 255, 255, 26)
        draw.rounded_rectangle([x0, y, x_end, y + int(5 * scale)], radius=int(2 * scale), fill=fill)
        if highlight:
            draw.rounded_rectangle(
                [x0, y + int(13 * scale), x0 + int(38 * scale), y + int(16 * scale)],
                radius=int(2 * scale),
                fill=(232, 192, 125, 150),
            )
    return count * gap


def compose(width, height, scale, stacked):
    img = background(width, height)
    img = glow(img, (int(width * 0.12), int(height * 0.30)), int(height * 0.70), AMBER, 54)
    img = glow(img, (int(width * 0.95), int(height * 0.90)), int(height * 0.55), MINT, 30)
    draw = ImageDraw.Draw(img, "RGBA")

    s = scale
    left = int(72 * s)
    title_size = int(84 * s)
    sub_size = int(25 * s)
    tag_size = int(25 * s)
    chip_size = int(18 * s)

    f_title = font(FONT_BOLD, title_size)
    f_sub = font(FONT_MONO, sub_size)
    f_tag = font(FONT_CJK, tag_size)
    f_chip = font(FONT_CJK, chip_size)
    f_small = font(FONT_MONO, int(15 * s))

    gap_a, gap_b, gap_c = int(24 * s), int(20 * s), int(56 * s)
    chip_h = chip_size + 20
    block_h = title_size + gap_a + sub_size + gap_b + tag_size + gap_c + chip_h
    if stacked:
        block_h += int(96 * s) + 5 * int(26 * s)

    bar_top = max(int(44 * s), (height - block_h) // 2)

    draw.rounded_rectangle(
        [left, bar_top, left + int(5 * s), bar_top + int(118 * s)], radius=int(3 * s), fill=AMBER
    )

    text_left = left + int(32 * s)
    y = bar_top - int(18 * s)
    draw.text((text_left, y), "文风锻造", font=f_title, fill=CREAM)
    y += title_size + gap_a
    draw.text((text_left, y), "PROSE FORGE", font=f_sub, fill=AMBER)
    y += sub_size + gap_b
    draw.text((text_left, y), "中文AI腔与排版硬伤的检查器", font=f_tag, fill=GREY)

    chip_y = y + tag_size + gap_c
    x = left
    for text, color in [("17 项检查", AMBER), ("常驻文风契约", MINT), ("零依赖", GREY)]:
        x += chip(draw, (x, chip_y), text, f_chip, color) + int(13 * s)

    if stacked:
        text_lines(draw, left, width - left - int(10 * s), chip_y + int(96 * s), int(26 * s), 6, s * 0.9)
    else:
        text_lines(
            draw,
            int(width * 0.60),
            width - left - int(10 * s),
            bar_top + int(10 * s),
            int(30 * s),
            8,
            s,
        )

    repo = "github.com/LGD-Haichao/dsh-prose-forge"
    rw = draw.textlength(repo, font=f_small)
    draw.text((width - left - rw, height - int(44 * s)), repo, font=f_small, fill=DIM)
    draw.rectangle([0, 0, width - 1, height - 1], outline=(255, 255, 255, 18), width=1)
    return img.convert("RGB")


out = Path("assets")
out.mkdir(exist_ok=True)
compose(1200, 630, 1.0, stacked=False).save(out / "cover-wide.png")
compose(880, 880, 1.0, stacked=True).save(out / "cover-square.png")
print("已生成两张")
