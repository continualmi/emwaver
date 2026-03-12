import os
from pathlib import Path

from emw_backend.app import create_app


def _load_env_files_from_repo_root() -> None:
    resolved: dict[str, str] = {}

    def expand(raw: str) -> str:
        out = raw
        for _ in range(6):
            next_out = out
            for key, value in resolved.items():
                next_out = next_out.replace(f"${{{key}}}", value)
            for key, value in os.environ.items():
                next_out = next_out.replace(f"${{{key}}}", value)
            if next_out == out:
                break
            out = next_out
        return out

    def load_env_file(path: Path) -> None:
        if not path.exists() or not path.is_file():
            return
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception:
            return

        for line in raw.splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith("export "):
                s = s[len("export ") :].strip()
            if "=" not in s:
                continue
            k, v = s.split("=", 1)
            key = k.strip()
            if not key:
                continue

            val = v.strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            val = expand(val)

            os.environ.setdefault(key, val)
            resolved.setdefault(key, os.environ.get(key, val))

    repo_root = Path(__file__).resolve().parent.parent
    env_name = (os.environ.get("EMWAVER_ENV") or os.environ.get("NODE_ENV") or "").strip().lower()
    files = [".env.prod"] if env_name in {"prod", "production"} else [".env"]
    for rel in files:
        load_env_file(repo_root / rel)


_load_env_files_from_repo_root()

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3201"))
    app.run(host="0.0.0.0", port=port, debug=True)
