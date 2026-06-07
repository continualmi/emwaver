#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import esptool
from esptool.cmds import detect_chip
from serial.tools import list_ports

CHIP_FEATURE_EMB_FLASH = 1 << 0
CHIP_FEATURE_WIFI_BGN = 1 << 1
CHIP_FEATURE_BLE = 1 << 4
CHIP_FEATURE_EMB_PSRAM = 1 << 7


def _chip_id_for_name(chip_name: str) -> int:
    normalized = chip_name.strip().lower().replace("-", "")
    if normalized.startswith("esp8266"):
        return 1
    if normalized == "esp32":
        return 0
    if normalized == "esp32s2":
        return 2
    if normalized == "esp32s3":
        return 9
    return -1


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
    argv = ["--chip", args.chip, "--port", args.port, "--before", "no-reset", "--after", "no-reset"]
    if args.baud:
        argv.extend(["--baud", str(args.baud)])
    if args.no_stub:
        argv.append("--no-stub")
    argv.append("chip_id")
    return _run_esptool(argv)


def _feature_mask_for_chip(esp: object) -> int:
    chip_name = str(getattr(esp, "CHIP_NAME", "")).strip().lower().replace("-", "")
    features = CHIP_FEATURE_WIFI_BGN
    if chip_name in ("esp32", "esp32s3"):
        features |= CHIP_FEATURE_BLE

    get_flash_cap = getattr(esp, "get_flash_cap", None)
    if callable(get_flash_cap):
        try:
            if int(get_flash_cap()) > 0:
                features |= CHIP_FEATURE_EMB_FLASH
        except Exception:
            pass

    get_psram_cap = getattr(esp, "get_psram_cap", None)
    if callable(get_psram_cap):
        try:
            if int(get_psram_cap()) > 0:
                features |= CHIP_FEATURE_EMB_PSRAM
        except Exception:
            pass

    return features


def _hardware_uid_hex_for_chip(esp: object) -> str:
    mac = tuple(int(x) & 0xFF for x in esp.read_mac("BASE_MAC"))
    return bytes(mac).hex().upper()


def cmd_read_identity(args: argparse.Namespace) -> int:
    esp = None
    try:
        esp = detect_chip(
            port=args.port,
            baud=args.baud,
            connect_mode=_esptool_connect_mode(args.before),
            trace_enabled=False,
        )
        mac = tuple(int(x) & 0xFF for x in esp.read_mac("BASE_MAC"))
        get_chip_revision = getattr(esp, "get_chip_revision", None)
        revision = int(get_chip_revision()) if callable(get_chip_revision) else 0
        cores = int(getattr(esp, "CHIP_CORES", 1))
        features = _feature_mask_for_chip(esp)

        print(f"CHIP_NAME={esp.CHIP_NAME}")
        print(f"MAC={':'.join(f'{b:02X}' for b in mac)}")
        print(f"CHIP_MODEL={_chip_id_for_name(str(esp.CHIP_NAME))}")
        print(f"CHIP_REVISION={revision}")
        print(f"FEATURES=0x{features:04X}")
        print(f"CORES={cores}")
        print(f"HARDWARE_UID_HEX={_hardware_uid_hex_for_chip(esp)}")
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        if esp is not None:
            port = getattr(esp, "_port", None)
            if port is not None:
                try:
                    port.close()
                except Exception:
                    pass


def _require_file(path: str, label: str) -> str:
    candidate = Path(path)
    if not candidate.is_file():
        raise SystemExit(f"Missing {label} file: {path}")
    return str(candidate)


def _esptool_reset_choice(value: str) -> str:
    return value.strip().lower().replace("-", "_")


def _esptool_connect_mode(value: str) -> str:
    return value.strip().lower().replace("-", "_")


def cmd_flash(args: argparse.Namespace) -> int:
    bootloader = _require_file(args.bootloader, "bootloader")
    partition_table = _require_file(args.partition_table, "partition-table")
    ota_data = _require_file(args.ota_data, "ota-data") if args.ota_data else None
    app = _require_file(args.app, "app")

    argv = [
        "--chip", args.chip,
        "--port", args.port,
        "--baud", str(args.baud),
        "--before", _esptool_reset_choice(args.before),
        "--after", _esptool_reset_choice(args.after),
    ]
    if args.no_stub:
        argv.append("--no-stub")
    argv.extend([
        "write_flash",
        "--flash_mode", "dio",
        "--flash_freq", args.flash_freq,
        "--flash_size", args.flash_size,
        args.bootloader_offset, bootloader,
        args.app_offset, app,
        args.partition_table_offset, partition_table,
    ])
    if ota_data:
        argv.extend([args.ota_data_offset, ota_data])
    return _run_esptool(argv)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="emwaver-esp-helper")
    sub = parser.add_subparsers(dest="command", required=True)

    list_ports_parser = sub.add_parser("list-ports")
    list_ports_parser.set_defaults(func=cmd_list_ports)

    chip_id = sub.add_parser("chip-id")
    chip_id.add_argument("--port", required=True)
    chip_id.add_argument("--chip", default="auto")
    chip_id.add_argument("--baud", type=int, default=115200)
    chip_id.add_argument("--no-stub", action="store_true")
    chip_id.set_defaults(func=cmd_chip_id)

    read_identity = sub.add_parser("read-identity")
    read_identity.add_argument("--port", required=True)
    read_identity.add_argument("--baud", type=int, default=115200)
    read_identity.add_argument("--before", default="default-reset")
    read_identity.set_defaults(func=cmd_read_identity)

    flash = sub.add_parser("flash")
    flash.add_argument("--chip", default="esp32s3")
    flash.add_argument("--port", required=True)
    flash.add_argument("--bootloader", required=True)
    flash.add_argument("--partition-table", required=True)
    flash.add_argument("--ota-data")
    flash.add_argument("--app", required=True)
    flash.add_argument("--bootloader-offset", default="0x0")
    flash.add_argument("--partition-table-offset", default="0x8000")
    flash.add_argument("--ota-data-offset", default="0x10000")
    flash.add_argument("--app-offset", default="0x20000")
    flash.add_argument("--flash-freq", default="80m")
    flash.add_argument("--flash-size", default="4MB")
    flash.add_argument("--baud", type=int, default=460800)
    flash.add_argument("--before", default="default-reset")
    flash.add_argument("--after", default="hard-reset")
    flash.add_argument("--no-stub", action="store_true")
    flash.set_defaults(func=cmd_flash)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
