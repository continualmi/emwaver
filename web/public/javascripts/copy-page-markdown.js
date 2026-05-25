(() => {
  function copyText(text) {
    if (navigator?.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok ? Promise.resolve() : Promise.reject(new Error("Copy failed"));
  }

  function setup() {
    const button = document.querySelector("[data-emwaver-copy-page-markdown]");
    if (!button) return;

    const source = document.getElementById("emwaver-page-markdown-source");
    if (!source) return;

    button.addEventListener("click", async () => {
      const markdown = source.value ?? source.textContent ?? "";
      if (!markdown.trim()) return;

      const originalAriaLabel = button.getAttribute("aria-label") || "Copy";
      button.disabled = true;
      try {
        await copyText(markdown);
        button.setAttribute("aria-label", "Copied");
        button.dataset.emwaverCopyState = "copied";
        setTimeout(() => {
          button.setAttribute("aria-label", originalAriaLabel);
          delete button.dataset.emwaverCopyState;
          button.disabled = false;
        }, 900);
      } catch {
        button.setAttribute("aria-label", "Copy failed");
        setTimeout(() => {
          button.setAttribute("aria-label", originalAriaLabel);
          button.disabled = false;
        }, 1200);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
