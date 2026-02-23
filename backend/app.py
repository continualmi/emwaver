import os
from pathlib import Path

from emw_backend.app import create_app


def _load_env_files_from_repo_root() -> None:
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

            os.environ.setdefault(key, val)

    repo_root = Path(__file__).resolve().parent.parent
    files = [
        "secrets/shared/core.env",
        "secrets/shared/firebase.env",
        "secrets/shared/oauth.env",
        "secrets/server/backend.env",
        "secrets/server/ai.env",
        "secrets/server/billing.env",
        "secrets/server/storage.env",
        "secrets/server/provisioning.env",
    ]
    for rel in files:
        load_env_file(repo_root / rel)


_load_env_files_from_repo_root()

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    app.run(host="0.0.0.0", port=port, debug=True)
