#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path


DEFAULT_ROOTS = [
    Path("/Volumes/T7/iPhone"),
]
DEFAULT_DESTINATION = Path("/Volumes/T7/EMWaver_Final_Video/clips")
VIDEO_EXTENSIONS = {".mov", ".mp4", ".m4v"}
IPHONE_PREFIXES = ("IMG_",)


@dataclass
class Candidate:
    path: Path
    sort_ts: float
    birth_ts: float
    modified_ts: float
    size_bytes: int

    @property
    def timestamp(self) -> datetime:
        return datetime.fromtimestamp(self.sort_ts)


def file_sort_timestamp(path: Path) -> tuple[float, float]:
    stat = path.stat()
    birth = getattr(stat, "st_birthtime", stat.st_mtime)
    modified = stat.st_mtime
    return max(birth, modified), birth


def format_size(size_bytes: int) -> str:
    size = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(size)}{unit}"
            return f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size_bytes}B"


def looks_like_iphone_video(path: Path) -> bool:
    suffix = path.suffix.lower()
    if suffix not in VIDEO_EXTENSIONS:
        return False
    name = path.name.upper()
    return name.startswith(IPHONE_PREFIXES)


def iter_candidates(roots: list[Path], days: int, include_all_videos: bool) -> list[Candidate]:
    cutoff = datetime.now() - timedelta(days=days)
    results: list[Candidate] = []

    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            suffix = path.suffix.lower()
            if suffix not in VIDEO_EXTENSIONS:
                continue
            if not include_all_videos and not looks_like_iphone_video(path):
                continue
            sort_ts, birth_ts = file_sort_timestamp(path)
            ts = datetime.fromtimestamp(sort_ts)
            if ts < cutoff:
                continue
            stat = path.stat()
            results.append(
                Candidate(
                    path=path,
                    sort_ts=sort_ts,
                    birth_ts=birth_ts,
                    modified_ts=stat.st_mtime,
                    size_bytes=stat.st_size,
                )
            )

    results.sort(key=lambda item: item.sort_ts, reverse=True)
    return results


def unique_destination(destination_dir: Path, filename: str) -> Path:
    candidate = destination_dir / filename
    if not candidate.exists():
        return candidate

    stem = candidate.stem
    suffix = candidate.suffix
    counter = 2
    while True:
        next_candidate = destination_dir / f"{stem}-{counter}{suffix}"
        if not next_candidate.exists():
            return next_candidate
        counter += 1


def print_candidates(candidates: list[Candidate], limit: int) -> int:
    shown = candidates[:limit]
    if not shown:
        print("No matching recent iPhone video imports found.")
        return 1

    for idx, item in enumerate(shown, start=1):
        timestamp = item.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        print(f"{idx}\t{timestamp}\t{format_size(item.size_bytes)}\t{item.path}")
    return 0


def resolve_selection(
    candidates: list[Candidate],
    path_arg: str | None,
    index_arg: int | None,
) -> Path:
    if path_arg:
        path = Path(path_arg).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        return path

    if index_arg is None:
        raise ValueError("Provide either --path or --index.")

    if index_arg < 1 or index_arg > len(candidates):
        raise IndexError(f"Index {index_arg} is out of range for {len(candidates)} candidate(s).")

    return candidates[index_arg - 1].path


def cmd_list(args: argparse.Namespace) -> int:
    roots = [Path(root).expanduser() for root in args.roots]
    candidates = iter_candidates(roots, args.days, args.all_videos)
    return print_candidates(candidates, args.limit)


def cmd_migrate(args: argparse.Namespace) -> int:
    destination = Path(args.destination).expanduser()
    if not destination.exists() or not destination.is_dir():
        print(f"Destination directory not available: {destination}", file=sys.stderr)
        return 2

    roots = [Path(root).expanduser() for root in args.roots]
    candidates = iter_candidates(roots, args.days, args.all_videos)

    try:
        source = resolve_selection(candidates, args.path, args.index)
    except (FileNotFoundError, ValueError, IndexError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    target = unique_destination(destination, source.name)
    if args.mode == "copy":
        shutil.copy2(source, target)
    else:
        shutil.move(str(source), str(target))

    print(f"{args.mode}\t{source}\t{target}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="List likely recent iPhone video exports in the T7 iPhone staging folder and migrate one into the T7 clips folder."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common_arguments(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument(
            "--roots",
            nargs="+",
            default=[str(path) for path in DEFAULT_ROOTS],
            help="Folders to search for imported clips.",
        )
        subparser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Only include clips newer than this many days.",
        )
        subparser.add_argument(
            "--all-videos",
            action="store_true",
            help="Include non-IMG video files too.",
        )

    list_parser = subparsers.add_parser("list", help="List recent likely iPhone imports.")
    add_common_arguments(list_parser)
    list_parser.add_argument("--limit", type=int, default=10, help="Maximum number of results to show.")
    list_parser.set_defaults(func=cmd_list)

    migrate_parser = subparsers.add_parser("migrate", help="Move or copy a selected clip to the destination.")
    add_common_arguments(migrate_parser)
    migrate_parser.add_argument("--index", type=int, help="1-based index from the current list ordering.")
    migrate_parser.add_argument("--path", help="Explicit path to migrate instead of selecting by index.")
    migrate_parser.add_argument(
        "--destination",
        default=str(DEFAULT_DESTINATION),
        help="Destination folder for the migrated clip.",
    )
    migrate_parser.add_argument(
        "--mode",
        choices=("move", "copy"),
        default="move",
        help="Whether to move or copy the file.",
    )
    migrate_parser.set_defaults(func=cmd_migrate)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
