#!/usr/bin/env python3
"""从本站公开故事清单和原图生成临时的小红书配文图。"""

import argparse
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont, ImageOps


DEFAULT_FONT = Path("/System/Library/Fonts/Hiragino Sans GB.ttc")


def wrap_caption(draw, caption, font, width):
    lines = []
    for paragraph in caption.splitlines():
        line = ""
        for segment in re.findall(r"[（《「『“‘【]*.[，。！？；：、…）》」』”’】]*", paragraph):
            if line and draw.textlength(line + segment, font=font) > width:
                lines.append(line.rstrip())
                line = ""
            if line or not segment.isspace():
                line += segment
        lines.append(line.rstrip())
    return "\n".join(lines)


def render_caption(source, output, caption, font_path):
    with Image.open(source) as original:
        art = ImageOps.exif_transpose(original)
        art.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
        rgba = art.convert("RGBA")
    image = Image.new("RGB", rgba.size, "#f7f4ed")
    image.paste(rgba, mask=rgba.getchannel("A"))
    width, height = image.size
    if caption.strip():
        draw = ImageDraw.Draw(image)
        inset = round(width * 0.05)
        padding = round(width * 0.023)
        fade = max(2, round(height * 0.09))
        footer = round(height * 0.045)
        fade_out = max(2, round(height * 0.035))
        largest = max(12, round(width * 0.043))
        smallest = max(12, round(width * 0.029))
        for size in range(largest, smallest - 1, -1):
            font = ImageFont.truetype(str(font_path), size)
            spacing = round(size * 0.36)
            text = wrap_caption(draw, caption, font, width - 2 * inset)
            left, top, right, bottom = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing)
            band = bottom - top + 2 * padding
            if band + fade + fade_out + footer <= height * 0.45 and right - left <= width - 2 * inset:
                break
        else:
            raise ValueError("旁白过长，无法在画面底部完整排版")

        # 文字区采用阅读站的渐变色，画面底部留给原图署名。
        shade_height = fade + band + fade_out
        shade_bottom = height - footer
        alpha = Image.new("L", (1, shade_height))
        alpha.putdata(
            [round(158 * row / fade) for row in range(fade)]
            + [round(158 + 21 * row / max(1, band - 1)) for row in range(band)]
            + [round(179 * (1 - (row + 1) / fade_out)) for row in range(fade_out)]
        )
        image.paste("#171a15", (0, shade_bottom - shade_height, width, shade_bottom),
                    alpha.resize((width, shade_height), Image.Resampling.NEAREST))
        draw.multiline_text((inset - left, shade_bottom - fade_out - band + padding - top), text,
                            font=font, spacing=spacing, fill="#fffdf7")
    image.save(output, "JPEG", quality=92, subsampling=0, optimize=True)


def prepare(manifest, limit, font):
    manifest = manifest.resolve(strict=True)
    story = json.loads(manifest.read_text(encoding="utf-8"))
    pages = story.get("pages") if isinstance(story, dict) else None
    if not isinstance(pages, list) or not pages:
        raise ValueError("需要包含画页的公开 story.json")

    folder = Path(tempfile.mkdtemp(prefix="shiqu-rednote-"))
    try:
        for index, page in enumerate(pages[:limit], 1):
            try:
                if not isinstance(page, dict) or not all(
                    isinstance(page.get(key), str) for key in ("image", "caption")
                ):
                    raise ValueError("缺少图片路径或旁白")
                relative = Path(page["image"])
                image = (manifest.parent / relative).resolve(strict=True)
                if relative.is_absolute() or not image.is_relative_to(manifest.parent):
                    raise ValueError("图片路径超出故事目录")
                render_caption(image, folder / f"{index:03d}.jpg", page["caption"], font)
            except (OSError, ValueError) as error:
                raise ValueError(f"第 {index} 幅：{error}") from error
        return folder
    except BaseException:
        shutil.rmtree(folder)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="本站构建生成的公开 story.json")
    parser.add_argument("--limit", type=int, help="仅生成按原顺序排列的前 N 幅")
    parser.add_argument("--font", type=Path, default=DEFAULT_FONT, help="支持中文的字体文件")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit 至少为 1")
    if not args.font.is_file():
        parser.error("找不到中文字体，请用 --font 指定字体文件")
    try:
        print(prepare(args.manifest, args.limit, args.font))
    except (OSError, ValueError) as error:
        print(f"无法准备小红书图片：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
