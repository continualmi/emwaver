#!/usr/bin/env python3

"""General-purpose image generation utility (Gemini 2.5 Flash Image).

This is a small, repo-local helper for generating/transforming images with Gemini.

Requirements:
- Python 3.10+
- pip install google-genai pillow
- GEMINI_API_KEY in your environment (or in a repo-root .env)

Examples:

  # txt2img
  python scripts/gen_image_gemini.py \
    --prompt "Clean product shot, dark studio, soft rim light" \
    --out out.png --overwrite

  # img2img (one or more input images)
  python scripts/gen_image_gemini.py \
    --in ref.png \
    --prompt "Turn this into a flat icon on black" \
    --out out.png --overwrite
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple


DEFAULT_MODEL = "gemini-2.5-flash-image"


class UserError(RuntimeError):
    pass


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def find_repo_root(start: Path) -> Optional[Path]:
    cur = start.resolve()
    if cur.is_file():
        cur = cur.parent
    for p in [cur, *cur.parents]:
        if (p / ".git").exists():
            return p
    return None


def try_load_dotenv(dotenv_path: Path) -> None:
    """Best-effort .env loader (no external dependency).

    Supports simple KEY=VALUE lines; does not override already-set env vars.
    """

    try:
        text = dotenv_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        if not k:
            continue
        if k in os.environ:
            continue
        if v and v[0] not in ('"', "'"):
            for sep in (" #", "\t#"):
                idx = v.find(sep)
                if idx != -1:
                    v = v[:idx].rstrip()
                    break
        if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
            v = v[1:-1]
        os.environ[k] = v


def import_genai() -> Tuple[Any, Any]:
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore
    except Exception as e:
        raise UserError(
            "Missing dependency: google-genai. Install with: pip install google-genai"
        ) from e
    return genai, types


def ensure_pillow() -> Any:
    try:
        from PIL import Image  # type: ignore
    except Exception as e:
        raise UserError("Missing dependency: pillow. Install with: pip install pillow") from e
    return Image


def parse_size(s: str) -> Tuple[int, int]:
    s = s.strip().lower().replace(" ", "")
    if "x" not in s:
        raise UserError("--size must be like 512x768")
    w_s, h_s = s.split("x", 1)
    try:
        w = int(w_s)
        h = int(h_s)
    except ValueError as e:
        raise UserError("--size must be like 512x768") from e
    if w <= 0 or h <= 0:
        raise UserError("--size must be positive")
    return w, h


def load_image_bytes(path: Path) -> Tuple[bytes, str]:
    data = path.read_bytes()
    ext = (path.suffix or "").lower()
    if ext == ".png":
        return data, "image/png"
    if ext in (".jpg", ".jpeg"):
        return data, "image/jpeg"
    return data, "application/octet-stream"


def part_from_image_bytes(types_mod: Any, data: bytes, mime_type: str) -> Any:
    Part = getattr(types_mod, "Part")
    if hasattr(Part, "from_bytes"):
        return Part.from_bytes(data=data, mime_type=mime_type)
    if hasattr(Part, "from_inline_data"):
        return Part.from_inline_data(data=data, mime_type=mime_type)
    Blob = getattr(types_mod, "Blob", None)
    if Blob is not None:
        return Part(inline_data=Blob(data=data, mime_type=mime_type))
    raise UserError("google-genai SDK: cannot construct image Part from bytes")


def extract_first_image_bytes_from_stream(chunk: Any) -> Optional[Tuple[bytes, str]]:
    try:
        candidates = getattr(chunk, "candidates", None)
        if not candidates:
            return None
        content = getattr(candidates[0], "content", None)
        if content is None:
            return None
        parts = getattr(content, "parts", None)
        if not parts:
            return None
        for p in parts:
            inline = getattr(p, "inline_data", None)
            if not inline:
                continue
            data = getattr(inline, "data", None)
            mime = getattr(inline, "mime_type", None)
            if data:
                return (data, mime or "application/octet-stream")
        return None
    except Exception:
        return None


def generate_one(
    *,
    client: Any,
    types_mod: Any,
    model: str,
    aspect_ratio: Optional[str],
    image_size: Optional[str],
    prompt: str,
    init_images: List[Tuple[bytes, str]],
    max_retries: int,
    retry_sleep_s: float,
) -> bytes:
    parts: List[Any] = []
    for img_bytes, mime in init_images:
        parts.append(part_from_image_bytes(types_mod, img_bytes, mime))
    parts.append(types_mod.Part.from_text(text=prompt))

    contents = [types_mod.Content(role="user", parts=parts)]

    cfg_img: Dict[str, Any] = {}
    if aspect_ratio:
        cfg_img["aspect_ratio"] = aspect_ratio
    if image_size:
        cfg_img["image_size"] = image_size
    image_config = types_mod.ImageConfig(**cfg_img) if cfg_img else None

    cfg_kwargs: Dict[str, Any] = {
        "response_modalities": ["IMAGE", "TEXT"],
    }
    if image_config is not None:
        cfg_kwargs["image_config"] = image_config
    config = types_mod.GenerateContentConfig(**cfg_kwargs)

    last_err: Optional[Exception] = None
    for attempt in range(max_retries + 1):
        try:
            stream = client.models.generate_content_stream(
                model=model,
                contents=contents,
                config=config,
            )
            for chunk in stream:
                hit = extract_first_image_bytes_from_stream(chunk)
                if hit is not None:
                    data, _mime = hit
                    return data
            raise UserError("model returned no image data")
        except Exception as e:
            last_err = e
            if attempt >= max_retries:
                break
            time.sleep(retry_sleep_s * (attempt + 1))
    raise UserError(f"generation failed: {last_err}")


def _resize(img: Any, *, resize_to: Optional[Tuple[int, int]], fit: str) -> Any:
    if not resize_to:
        return img
    Image = ensure_pillow()
    target_w, target_h = resize_to
    src_w, src_h = img.size
    if src_w <= 0 or src_h <= 0:
        raise UserError("invalid image dimensions from model")

    if fit == "stretch":
        return img.resize((target_w, target_h), Image.LANCZOS)

    src_ratio = src_w / src_h
    dst_ratio = target_w / target_h
    if fit == "crop":
        if src_ratio > dst_ratio:
            scale = target_h / src_h
        else:
            scale = target_w / src_w
        new_w = max(1, int(round(src_w * scale)))
        new_h = max(1, int(round(src_h * scale)))
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        left = max(0, (new_w - target_w) // 2)
        top = max(0, (new_h - target_h) // 2)
        return resized.crop((left, top, left + target_w, top + target_h))
    if fit == "contain":
        if src_ratio > dst_ratio:
            scale = target_w / src_w
        else:
            scale = target_h / src_h
        new_w = max(1, int(round(src_w * scale)))
        new_h = max(1, int(round(src_h * scale)))
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 255))
        left = (target_w - new_w) // 2
        top = (target_h - new_h) // 2
        canvas.paste(resized, (left, top))
        return canvas
    raise UserError(f"unknown fit mode: {fit}")


def save_converted(
    *,
    raw_bytes: bytes,
    out_path: Path,
    out_format: str,
    resize_to: Optional[Tuple[int, int]],
    fit: str,
    jpg_quality: int,
) -> None:
    Image = ensure_pillow()
    img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
    img = _resize(img, resize_to=resize_to, fit=fit)

    out_format = out_format.lower()
    if out_format in ("jpg", "jpeg"):
        img = img.convert("RGB")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_path, format="JPEG", quality=jpg_quality, optimize=True)
        return
    if out_format == "png":
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_path, format="PNG", optimize=True)
        return
    raise UserError("--format must be png or jpg")


def main(argv: Sequence[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="gen_image_gemini.py",
        description="General-purpose image generation (img2img/txt2img) via Gemini.",
    )

    ap.add_argument(
        "--in",
        dest="inputs",
        action="append",
        default=[],
        help="Input image path (repeatable)",
    )
    ap.add_argument("--prompt", type=str, required=True, help="Prompt text")
    ap.add_argument("--out", type=Path, required=True, help="Output image path")

    ap.add_argument("--model", type=str, default=DEFAULT_MODEL)
    ap.add_argument("--aspect-ratio", type=str, default=None)
    ap.add_argument(
        "--image-size",
        type=str,
        default=None,
        help="Model image size hint (e.g. 1K) when supported",
    )

    ap.add_argument(
        "--format",
        type=str,
        default=None,
        help="Output format: png or jpg (default: inferred from --out)",
    )
    ap.add_argument("--jpg-quality", type=int, default=92)

    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-retries", type=int, default=2)
    ap.add_argument("--retry-sleep", type=float, default=2.0)

    ap.add_argument("--size", type=str, default=None, help="Resize output to WxH")
    ap.add_argument(
        "--fit",
        type=str,
        default="contain",
        choices=("crop", "contain", "stretch"),
        help="Resize strategy when --size is used",
    )

    args = ap.parse_args(list(argv))

    out_path: Path = args.out
    if out_path.exists() and not args.overwrite:
        print(f"skip  {out_path} (exists)")
        return 0

    out_format = str(args.format or "").strip().lower()
    if not out_format:
        ext = (out_path.suffix or "").lower()
        if ext in (".jpg", ".jpeg"):
            out_format = "jpg"
        else:
            out_format = "png"

    resize_to = parse_size(args.size) if args.size else None

    init_images: List[Tuple[bytes, str]] = []
    for p in args.inputs:
        if not p:
            continue
        path = Path(p)
        if not path.exists():
            raise UserError(f"missing input image: {path}")
        init_images.append(load_image_bytes(path))

    repo_root = find_repo_root(Path(__file__))
    if repo_root is not None:
        try_load_dotenv(repo_root / ".env")
    try_load_dotenv(Path(__file__).resolve().parent / ".env")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise UserError("GEMINI_API_KEY is not set in the environment")

    genai, types_mod = import_genai()
    client = genai.Client(api_key=api_key)

    print(f"Model:  {args.model}")
    if args.aspect_ratio:
        print(f"Aspect: {args.aspect_ratio}")
    if resize_to:
        print(f"Resize: {resize_to[0]}x{resize_to[1]} ({args.fit})")
    print(f"Out:    {out_path} ({out_format})")
    if init_images:
        print(f"Mode:   img2img ({len(init_images)} input image(s))")
    else:
        print("Mode:   txt2img")

    if args.dry_run:
        return 0

    raw = generate_one(
        client=client,
        types_mod=types_mod,
        model=str(args.model),
        aspect_ratio=str(args.aspect_ratio).strip() if args.aspect_ratio else None,
        image_size=str(args.image_size).strip() if args.image_size else None,
        prompt=str(args.prompt),
        init_images=init_images,
        max_retries=int(args.max_retries),
        retry_sleep_s=float(args.retry_sleep),
    )

    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    save_converted(
        raw_bytes=raw,
        out_path=tmp_path,
        out_format=out_format,
        resize_to=resize_to,
        fit=str(args.fit),
        jpg_quality=int(args.jpg_quality),
    )
    tmp_path.replace(out_path)
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except UserError as e:
        eprint(f"error: {e}")
        raise SystemExit(2)
