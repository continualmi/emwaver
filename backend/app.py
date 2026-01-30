import os
from pathlib import Path

from emw_backend.app import create_app


def _load_dotenv_from_repo_root() -> None:
    # backend/app.py lives at: <repo_root>/backend/app.py
    # Prefer loading the repo root .env for local dev.
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

            # Do not override existing environment variables.
            os.environ.setdefault(key, val)

    repo_root = Path(__file__).resolve().parent.parent
    load_env_file(repo_root / ".env")
    # Optional backend-local .env (e.g. for Azure or local overrides).
    load_env_file(Path(__file__).resolve().parent / ".env")


_load_dotenv_from_repo_root()


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    app.run(host="127.0.0.1", port=port, debug=True)
