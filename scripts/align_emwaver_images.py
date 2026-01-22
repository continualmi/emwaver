#!/usr/bin/env python3
"""Align EMWaver board variant screenshots.

This script is meant to solve a common problem with variant screenshots:
each PNG is "almost" the same, but with small pixel shifts (and sometimes
tiny rotation/scale differences). We align each image to a chosen reference
using the PCB outline.

Approach (robust to component differences):
- Treat the background as a mostly-uniform color (sample corners).
- Build a foreground mask (non-background) and clean it with morphology.
- Find the largest contour (the board).
- Use the contour's oriented bounding box to estimate orientation + size.
- Warp each image (rotation + uniform scale + translation) into the reference
  canvas so all variants share the same alignment.

Outputs:
- Aligned PNGs in --output-dir.
- Optional preview images to quickly inspect results.

Notes:
- We do not overwrite your original screenshots by default.
- Background segmentation assumes a mostly-flat background (e.g. grey).
"""

from __future__ import annotations

import argparse
import dataclasses
import math
import os
from pathlib import Path
from typing import Iterable

import cv2  # type: ignore
import numpy as np


@dataclasses.dataclass(frozen=True)
class BoardStats:
    center_xy: tuple[float, float]
    rect_wh: tuple[float, float]
    angle_deg: float


def _median_corner_color_bgr(img_bgr: np.ndarray, corner_size: int = 12) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    cs = max(1, min(corner_size, h // 8, w // 8))
    corners = [
        img_bgr[0:cs, 0:cs],
        img_bgr[0:cs, w - cs : w],
        img_bgr[h - cs : h, 0:cs],
        img_bgr[h - cs : h, w - cs : w],
    ]
    stacked = np.concatenate([c.reshape(-1, 3) for c in corners], axis=0)
    return np.median(stacked, axis=0).astype(np.float32)


def _mask_foreground(
    img_bgr: np.ndarray,
    *,
    bg_bgr: np.ndarray,
    bg_tol: int,
) -> np.ndarray:
    # L1 distance to background color; tolerant of compression/antialiasing.
    diff = np.sum(np.abs(img_bgr.astype(np.float32) - bg_bgr[None, None, :]), axis=2)
    mask = (diff >= float(bg_tol) * 3.0).astype(np.uint8) * 255

    # Clean up edge noise.
    mask = cv2.medianBlur(mask, 5)
    kernel = np.ones((7, 7), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    return mask


def _largest_contour(mask: np.ndarray) -> np.ndarray | None:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    return max(contours, key=cv2.contourArea)


def _rect_angle_deg(rect) -> float:
    # OpenCV's minAreaRect returns angle in [-90, 0), where it represents the
    # rotation of the rectangle's width side. Normalize to a stable "board" angle.
    (_, _), (w, h), angle = rect
    if w < h:
        # Tall rectangle: angle already corresponds to its orientation.
        return float(angle)
    # Wide rectangle: rotate by 90 to get the long side's orientation.
    return float(angle) + 90.0


def compute_board_stats(img_bgr: np.ndarray, *, bg_tol: int) -> tuple[BoardStats, np.ndarray]:
    bg_bgr = _median_corner_color_bgr(img_bgr)
    mask = _mask_foreground(img_bgr, bg_bgr=bg_bgr, bg_tol=bg_tol)
    contour = _largest_contour(mask)
    if contour is None:
        raise RuntimeError("Could not find board contour")

    rect = cv2.minAreaRect(contour)
    (cx, cy), (rw, rh), _ = rect
    angle_deg = _rect_angle_deg(rect)
    stats = BoardStats(center_xy=(float(cx), float(cy)), rect_wh=(float(rw), float(rh)), angle_deg=angle_deg)
    return stats, mask


def _uniform_scale_to_match(reference: BoardStats, current: BoardStats) -> float:
    r_w, r_h = reference.rect_wh
    c_w, c_h = current.rect_wh
    # Use the long side ratio (stable even if minAreaRect swaps w/h).
    r_long = max(r_w, r_h)
    c_long = max(c_w, c_h)
    if c_long <= 1e-6:
        return 1.0
    return float(r_long / c_long)


def align_image(
    img_bgr: np.ndarray,
    *,
    current: BoardStats,
    reference: BoardStats,
    out_size_wh: tuple[int, int],
    allow_rotate: bool,
    allow_scale: bool,
    max_scale_delta: float,
) -> tuple[np.ndarray, np.ndarray]:
    cx, cy = current.center_xy
    rx, ry = reference.center_xy

    # Delta such that current rotates into reference orientation.
    angle_delta = reference.angle_deg - current.angle_deg if allow_rotate else 0.0

    scale = _uniform_scale_to_match(reference, current) if allow_scale else 1.0
    if abs(scale - 1.0) > max_scale_delta:
        scale = 1.0

    m = cv2.getRotationMatrix2D((cx, cy), angle_delta, scale)
    # Move the (rotated/scaled) current center to the reference center.
    m[0, 2] += rx - cx
    m[1, 2] += ry - cy

    out_w, out_h = out_size_wh
    aligned = cv2.warpAffine(
        img_bgr,
        m,
        (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=tuple(int(x) for x in _median_corner_color_bgr(img_bgr)),
    )

    # Also warp the mask for verification/debug previews.
    bg = _median_corner_color_bgr(img_bgr)
    mask = _mask_foreground(img_bgr, bg_bgr=bg, bg_tol=18)
    aligned_mask = cv2.warpAffine(mask, m, (out_w, out_h), flags=cv2.INTER_NEAREST)
    return aligned, aligned_mask


def refine_with_ecc(
    *,
    reference_bgr: np.ndarray,
    reference_mask: np.ndarray,
    aligned_bgr: np.ndarray,
    max_iters: int,
) -> np.ndarray:
    # ECC expects single-channel float32 images.
    ref_gray = cv2.cvtColor(reference_bgr, cv2.COLOR_BGR2GRAY)
    ali_gray = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY)
    ref_gray_f = ref_gray.astype(np.float32) / 255.0
    ali_gray_f = ali_gray.astype(np.float32) / 255.0

    # Use the reference board mask so background doesn't dominate correlation.
    mask = (reference_mask > 0).astype(np.uint8)

    warp = np.eye(2, 3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, int(max_iters), 1e-6)
    try:
        cv2.findTransformECC(
            ref_gray_f,
            ali_gray_f,
            warp,
            motionType=cv2.MOTION_EUCLIDEAN,
            criteria=criteria,
            inputMask=mask,
            gaussFiltSize=5,
        )
    except Exception:
        return aligned_bgr

    h, w = aligned_bgr.shape[:2]
    return cv2.warpAffine(
        aligned_bgr,
        warp,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=tuple(int(x) for x in _median_corner_color_bgr(aligned_bgr)),
    )


def _write_contact_sheet(paths: list[Path], out_path: Path, thumb_wh: tuple[int, int] = (360, 360)) -> None:
    # Lazy import to keep script runtime lean when previews are disabled.
    from PIL import Image

    thumbs: list[Image.Image] = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        im.thumbnail(thumb_wh)
        canvas = Image.new("RGB", thumb_wh, (24, 24, 24))
        ox = (thumb_wh[0] - im.size[0]) // 2
        oy = (thumb_wh[1] - im.size[1]) // 2
        canvas.paste(im, (ox, oy))
        thumbs.append(canvas)

    if not thumbs:
        return

    cols = 4
    rows = int(math.ceil(len(thumbs) / cols))
    sheet = Image.new("RGB", (thumb_wh[0] * cols, thumb_wh[1] * rows), (24, 24, 24))
    for i, t in enumerate(thumbs):
        x = (i % cols) * thumb_wh[0]
        y = (i // cols) * thumb_wh[1]
        sheet.paste(t, (x, y))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


def _write_overlay_mean(in_paths: list[Path], out_path: Path) -> None:
    from PIL import Image

    if not in_paths:
        return

    acc = None
    n = 0
    for p in in_paths:
        im = np.array(Image.open(p).convert("RGB"), dtype=np.float32)
        if acc is None:
            acc = np.zeros_like(im, dtype=np.float32)
        if im.shape != acc.shape:
            continue
        acc += im
        n += 1

    if acc is None or n == 0:
        return

    mean = np.clip(acc / float(n), 0, 255).astype(np.uint8)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(mean, mode="RGB").save(out_path)


def _write_outline_edge_overlay_mean(in_paths: list[Path], out_path: Path, *, bg_tol: int) -> None:
    """Write an overlay that only includes the PCB outline.

    This is a better alignment diagnostic than averaging full images, because
    component differences across variants will blur any mean-of-RGB preview.
    """

    from PIL import Image

    if not in_paths:
        return

    acc = None
    n = 0
    for p in in_paths:
        img_bgr = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img_bgr is None:
            continue

        try:
            _, mask = compute_board_stats(img_bgr, bg_tol=bg_tol)
        except Exception:
            continue

        edges = cv2.Canny(mask, 80, 160)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

        if acc is None:
            acc = np.zeros_like(edges, dtype=np.float32)
        if edges.shape != acc.shape:
            continue

        acc += edges.astype(np.float32) / 255.0
        n += 1

    if acc is None or n == 0:
        return

    # Normalize counts -> grayscale.
    mean = np.clip((acc / float(n)) * 255.0, 0, 255).astype(np.uint8)
    # Convert to RGB so it previews nicely.
    rgb = np.stack([mean, mean, mean], axis=2)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, mode="RGB").save(out_path)


def _iter_pngs(input_dir: Path) -> list[Path]:
    return sorted([p for p in input_dir.glob("*.png") if p.is_file()])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--input-dir",
        default="docs/content/hardware-catalog/hardware/emwaver",
        help="Directory containing PNG screenshots",
    )
    ap.add_argument(
        "--output-dir",
        default="docs/content/hardware-catalog/hardware/emwaver_aligned",
        help="Output directory for aligned PNGs",
    )
    ap.add_argument(
        "--reference",
        default="emwaver_all.png",
        help="Reference PNG filename within --input-dir",
    )
    ap.add_argument(
        "--exclude",
        action="append",
        default=["emwaver.png"],
        help="Exclude PNG filename (repeatable). Default excludes the legacy isometric emwaver.png",
    )
    ap.add_argument("--bg-tol", type=int, default=18, help="Background color tolerance")
    ap.add_argument(
        "--allow-rotate",
        action="store_true",
        help="Enable outline-based rotation correction",
    )
    ap.add_argument(
        "--allow-scale",
        action="store_true",
        help="Enable outline-based uniform scaling correction",
    )
    ap.add_argument(
        "--max-scale-delta",
        type=float,
        default=0.06,
        help="Max abs(scale-1) allowed before clamping to 1.0",
    )
    ap.add_argument(
        "--write-previews",
        action="store_true",
        help="Write contact sheet + mean overlay previews",
    )
    ap.add_argument(
        "--refine-ecc",
        action="store_true",
        help="Run an ECC refinement pass after outline alignment",
    )
    ap.add_argument(
        "--ecc-iters",
        type=int,
        default=80,
        help="ECC max iterations (only used with --refine-ecc)",
    )

    args = ap.parse_args(argv)

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    in_paths = [p for p in _iter_pngs(input_dir) if p.name not in set(args.exclude or [])]
    if not in_paths:
        raise SystemExit(f"No PNGs found in {input_dir}")

    ref_path = input_dir / args.reference
    if not ref_path.exists():
        raise SystemExit(f"Reference not found: {ref_path}")

    ref_img = cv2.imread(str(ref_path), cv2.IMREAD_COLOR)
    if ref_img is None:
        raise SystemExit(f"Failed reading reference: {ref_path}")
    ref_stats, ref_mask = compute_board_stats(ref_img, bg_tol=args.bg_tol)

    out_w, out_h = int(ref_img.shape[1]), int(ref_img.shape[0])

    aligned_paths: list[Path] = []
    failures: list[str] = []
    center_errs: list[float] = []
    angle_errs: list[float] = []
    for p in in_paths:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            failures.append(f"read: {p.name}")
            continue
        try:
            cur_stats, _ = compute_board_stats(img, bg_tol=args.bg_tol)
            aligned, _ = align_image(
                img,
                current=cur_stats,
                reference=ref_stats,
                out_size_wh=(out_w, out_h),
                allow_rotate=bool(args.allow_rotate),
                allow_scale=bool(args.allow_scale),
                max_scale_delta=float(args.max_scale_delta),
            )
            if args.refine_ecc:
                aligned = refine_with_ecc(
                    reference_bgr=ref_img,
                    reference_mask=ref_mask,
                    aligned_bgr=aligned,
                    max_iters=int(args.ecc_iters),
                )
        except Exception as e:
            failures.append(f"{p.name}: {e}")
            continue

        out_path = output_dir / p.name
        cv2.imwrite(str(out_path), aligned)
        aligned_paths.append(out_path)

        try:
            out_stats, _ = compute_board_stats(aligned, bg_tol=args.bg_tol)
            dx = out_stats.center_xy[0] - ref_stats.center_xy[0]
            dy = out_stats.center_xy[1] - ref_stats.center_xy[1]
            center_errs.append(float(math.hypot(dx, dy)))
            angle_errs.append(float(abs(out_stats.angle_deg - ref_stats.angle_deg)))
        except Exception:
            # Ignore diagnostics failures; alignment result still may be usable.
            pass

    if args.write_previews:
        _write_contact_sheet(aligned_paths, output_dir / "_preview_contact_sheet.png")
        _write_overlay_mean(aligned_paths, output_dir / "_preview_overlay_mean.png")
        _write_outline_edge_overlay_mean(
            aligned_paths,
            output_dir / "_preview_outline_edges_mean.png",
            bg_tol=int(args.bg_tol),
        )

    print(f"Aligned: {len(aligned_paths)}/{len(in_paths)} -> {output_dir}")
    if center_errs:
        print(
            "Post-align board fit: "
            f"max center err {max(center_errs):.2f}px, mean {sum(center_errs)/len(center_errs):.2f}px; "
            f"max angle err {max(angle_errs) if angle_errs else 0.0:.2f}deg"
        )
    if failures:
        print("Failures:")
        for f in failures:
            print(f"- {f}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
