"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import "highlight.js/styles/tokyo-night-dark.min.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);

export function DocsHighlight() {
  // This component lives in the docs layout, which persists across client-side
  // navigation between docs pages. Keying the effect on the pathname re-runs it
  // on every navigation so freshly mounted code blocks get highlighted without
  // a full page refresh.
  const pathname = usePathname();

  useEffect(() => {
    document
      .querySelectorAll<HTMLElement>(".docs-article pre code")
      .forEach((block) => {
        // Clear hljs's "already highlighted" marker so re-renders re-tokenize
        // instead of being skipped.
        delete block.dataset.highlighted;
        hljs.highlightElement(block);
      });
  }, [pathname]);

  return null;
}
