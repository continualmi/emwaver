from __future__ import annotations

from pathlib import Path
from typing import Optional


def load_repo_agent_system_prompt() -> Optional[str]:
    """Load the repo-wide agent system prompt.

    We keep the prompt at the repo root as AGENT_SYSTEM_PROMPT.md.
    In deployed containers this file may not exist; callers should handle None.
    """

    here = Path(__file__).resolve()
    # backend/emw_backend/agent_prompt.py -> repo root
    root = here.parents[2]
    path = root / "AGENT_SYSTEM_PROMPT.md"
    try:
        txt = path.read_text(encoding="utf-8")
        txt = txt.strip()
        return txt if txt else None
    except Exception:
        return None
