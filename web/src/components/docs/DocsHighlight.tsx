"use client";

import { useEffect } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import "highlight.js/styles/tokyo-night-dark.min.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);

export function DocsHighlight() {
  useEffect(() => {
    hljs.highlightAll();
  });

  return null;
}
