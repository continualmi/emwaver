#!/usr/bin/env python3
from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent
    source = root / "emwaver_esp_helper.py"
    dist_dir = root / "dist"
    build_dir = root / "build"
    spec_dir = build_dir / "spec"
    name = "emwaver-esp-helper"

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        name,
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(build_dir),
        "--specpath",
        str(spec_dir),
        "--hidden-import",
        "serial.tools.list_ports",
        "--collect-all",
        "esptool",
        str(source),
    ]

    print(f"[emwaver-esp-helper] platform={platform.system().lower()}")
    print(f"[emwaver-esp-helper] source={source}")
    print(f"[emwaver-esp-helper] dist={dist_dir}")
    subprocess.run(cmd, check=True)
    suffix = ".exe" if sys.platform.startswith("win") else ""
    out = dist_dir / f"{name}{suffix}"
    print(f"[emwaver-esp-helper] output={out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
