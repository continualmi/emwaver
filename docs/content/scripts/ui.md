---
title: Script UI
---

# Script UI

Scripts build UI by constructing a tree of components and passing it to `UI.render(...)`.

```text title="Minimal script"
let count = 0;

function render() {
  UI.render(UI.column({
    padding: 16,
    spacing: 12,
    children: [
      UI.text({ text: "Count: " + count, font: "title2", fontWeight: "semibold" }),
      UI.button({ label: "Increment", onTap: () => { count += 1; render(); } })
    ]
  }));
}

render();
```

Common events:

- `onTap`
- `onChange`
- `onSubmit`

Common components:

- Layout: `UI.column`, `UI.row`, `UI.scroll`, `UI.grid`, `UI.spacer`, `UI.divider`
- Content: `UI.text`, `UI.logViewer`
- Inputs: `UI.button`, `UI.textField`, `UI.textEditor`, `UI.picker`, `UI.slider`, `UI.progress`
