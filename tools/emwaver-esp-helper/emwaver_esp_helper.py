#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import esptool
from serial.tools import list_ports


def _run_esptool(argv: list[str]) -> int:
    try:
        result = esptool.main(argv)
        return 0 if result is None else int(result)
    except SystemExit as exc:
        code = exc.code
        if isinstance(code, int):
            return code
        return 1 if code else 0
    except Exception:
        return 1


def cmd_list_ports(_: argparse.Namespace) -> int:
    for port in list_ports.comports():
        desc = (port.description or "").replace("\n", " ").strip()
        hwid = (port.hwid or "").replace("\n", " ").strip()
        print(f"PORT={port.device}\tDESC={desc}\tHWID={hwid}")
    return 0


def cmd_chip_id(args: argparse.Namespace) -> int:
    argv = ["--chip", "esp32s3", "--port", args.port, "--before", "no_reset", "--after", "no_reset"]
    if args.baud:
        argv.extend(["--baud", str(args.baud)])
    if args.no_stub:
        argv.append("--no-stub")
    argv.append("chip_id")
    return _run_esptool(argv)


def _require_file(path: str, label: str) -> str:
    candidate = Path(path)
    if not candidate.is_file():
        raise SystemExit(f"Missing {label} file: {path}")
    return str(candidate)


def cmd_flash(args: argparse.Namespace) -> int:
    bootloader = _require_file(args.bootloader, "bootloader")
    partition_table = _require_file(args.partition_table, "partition-table")
    ota_data = _require_file(args.ota_data, "ota-data")
    app = _require_file(args.app, "app")

    argv = [
        "--chip", "esp32s3",
        "--port", args.port,
        "--baud", str(args.baud),
        "--before", args.before,
        "--after", args.after,
    ]
    if args.no_stub:
        argv.append("--no-stub")
    argv.extend([
        "write_flash",
        "--flash_mode", "dio",
        "--flash_freq", "80m",
        "--flash_size", "4MB",
        "0x0", bootloader,
        "0x20000", app,
        "0x8000", partition_table,
        "0x10000", ota_data,
    ])
    return _run_esptool(argv)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="emwaver-esp-helper")
    sub = parser.add_subparsers(dest="command", required=True)

    list_ports_parser = sub.add_parser("list-ports")
    list_ports_parser.set_defaults(func=cmd_list_ports)

    chip_id = sub.add_parser("chip-id")
    chip_id.add_argument("--port", required=True)
    chip_id.add_argument("--baud", type=int, default=115200)
    chip_id.add_argument("--no-stub", action="store_true")
    chip_id.set_defaults(func=cmd_chip_id)

    flash = sub.add_parser("flash")
    flash.add_argument("--port", required=True)
    flash.add_argument("--bootloader", required=True)
    flash.add_argument("--partition-table", required=True)
    flash.add_argument("--ota-data", required=True)
    flash.add_argument("--app", required=True)
    flash.add_argument("--baud", type=int, default=115200)
    flash.add_argument("--before", default="no_reset")
    flash.add_argument("--after", default="hard_reset")
    flash.add_argument("--no-stub", action="store_true")
    flash.set_defaults(func=cmd_flash)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
