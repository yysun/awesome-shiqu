#!/usr/bin/env python3
"""Extract selected public Shiqu ZIP content for article layout; never publish."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
from zipfile import BadZipFile, ZipFile


def check_member(info):
    name = info.filename
    path = PurePosixPath(name)
    if "\\" in name or path.is_absolute() or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError(f"Unsafe archive entry: {name!r}")
    if path.parts and ":" in path.parts[0]:
        raise ValueError(f"Unsafe archive entry: {name!r}")
    if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
        raise ValueError(f"Unsupported symlink or encrypted entry: {name!r}")


def prepare(archive, output, author):
    archive = archive.resolve(strict=True)
    output = output.absolute()
    if output.exists():
        raise ValueError("Output must be a new directory; existing files will not be overwritten")
    if archive.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("Archive exceeds 100 MiB")
    images = []
    publication_notice = None
    with ZipFile(archive) as package:
        members = package.infolist()
        names = [m.filename for m in members]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive entry names")
        if sum(m.file_size for m in members) > 200 * 1024 * 1024:
            raise ValueError("Expanded archive exceeds 200 MiB")
        entries = {m.filename: m for m in members}
        info = entries.get("故事.json")
        if info is None or info.file_size > 8 * 1024 * 1024:
            raise ValueError("A public 故事.json is required (maximum 8 MiB)")
        check_member(info)
        story = json.loads(package.read(info).decode("utf-8-sig"))
        if not isinstance(story, dict):
            raise ValueError("Story must be a JSON object")
        notice = entries.get("署名与转载.txt")
        if notice is not None:
            check_member(notice)
            if notice.file_size > 128 * 1024:
                raise ValueError("Publication notice exceeds 128 KiB")
            publication_notice = package.read(notice).decode("utf-8-sig")
        pages = story.get("pages")
        if not isinstance(pages, list) or not 1 <= len(pages) <= 80:
            raise ValueError("Story must contain 1–80 pages")
        for index, page in enumerate(pages, 1):
            if not isinstance(page, dict) or not isinstance(page.get("caption"), str):
                raise ValueError(f"Page {index} requires a caption string")
            image_name = page.get("image")
            if not isinstance(image_name, str) or image_name not in entries:
                raise ValueError(f"Page {index} is missing its local image")
            image_info = entries[image_name]
            check_member(image_info)
            suffix = PurePosixPath(image_name).suffix.lower()
            if suffix not in {".webp", ".png", ".jpg", ".jpeg"} or not 0 < image_info.file_size <= 20 * 1024 * 1024:
                raise ValueError(f"Page {index} has an unsupported image type or size")
            content = package.read(image_info)
            valid = (
                suffix == ".webp" and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
                or suffix == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n")
                or suffix in {".jpg", ".jpeg"} and content.startswith(b"\xff\xd8\xff")
            )
            if not valid:
                raise ValueError(f"Page {index} image signature does not match its extension")
            expected = page.get("sha256")
            if expected and (not isinstance(expected, str) or hashlib.sha256(content).hexdigest() != expected.lower()):
                raise ValueError(f"Page {index} image SHA-256 does not match")
            images.append((f"images/{index:03d}{suffix}", content, page["caption"]))
    keys = ("title", "summary", "bookId", "author", "sourceReference", "sourceUrl",
            "aiGenerated", "aiDisclosure", "adaptationNote", "reflection")
    public = {key: story[key] for key in keys if key in story}
    if publication_notice is not None:
        public["publicationNotice"] = publication_notice
    if author is not None:
        if story.get("author") != author:
            public["sourceAuthor"] = story.get("author")
        public["author"] = author
    public["pages"] = [
        {"index": index, "caption": caption, "image": name}
        for index, (name, _, caption) in enumerate(images, 1)
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".toutiao-prepare-", dir=output.parent) as temporary:
        staged = Path(temporary) / "prepared"
        (staged / "images").mkdir(parents=True)
        for name, content, _ in images:
            (staged / name).write_bytes(content)
        (staged / "article.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        staged.rename(output)
    return {"manifest": str(output / "article.json"), "imageCount": len(images)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--author", help="Article attribution; does not alter images or source archive")
    args = parser.parse_args()
    try:
        result = prepare(args.archive, args.out, args.author)
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        print(f"Preparation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
