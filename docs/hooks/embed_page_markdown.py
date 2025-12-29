from __future__ import annotations

import html
from typing import Any


def _render_copy_button(markdown_source: str) -> str:
    escaped = html.escape(markdown_source, quote=False)
    return (
        '<div class="emwaver-copy-page">\n'
        '  <button\n'
        '    type="button"\n'
        '    class="emwaver-copy-page__button md-icon"\n'
        '    data-emwaver-copy-page-markdown\n'
        '    aria-label="Copy"\n'
        "  >\n"
        '    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">\n'
        '      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z"/>\n'
        "    </svg>\n"
        "  </button>\n"
        "</div>\n"
        f'<textarea id="emwaver-page-markdown-source" style="display:none">{escaped}</textarea>\n'
    )


def on_page_markdown(markdown: str, page: Any, config: Any, files: Any) -> str:
    src_path = getattr(getattr(page, "file", None), "src_path", "") or ""
    if src_path != "documentation/buffer.md":
        return markdown

    return _render_copy_button(markdown) + "\n" + markdown
