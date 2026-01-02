# EMWaver VSCode Extension (WIP)

Initial scaffold for a simple **Build & Flash** sidebar.

## Dev run

1. Open `vsc/` in VSCode.
2. Run `npm i`.
3. Press `F5` to start the *Extension Development Host* (auto-compiles TypeScript via a pre-launch task).
4. In the dev-host window, open a folder/workspace (e.g. the repo root) so the extension has a working directory.

## Install (VSIX / Cursor / VS Code)

1. Build a VSIX:
   - `cd vsc`
   - `npm i`
   - `npm run package`
2. Install the generated `emwaver-*.vsix`:
   - VS Code/Cursor → Extensions → `…` → `Install from VSIX…`

## Troubleshooting

- Check `View → Output → EMWaver` for activation logs.
- Check `View → Output → Log (Extension Host)` for stack traces.

## Commands

- `EMWaver: Build` → runs `emwaver build`
- `EMWaver: Flash` → runs `emwaver flash`

## `.emw` files (Wavelets)

- Syntax highlighting: `.emw` files are treated as JavaScript (`EMWaver Wavelet` language) for highlighting.
- File icon: VS Code only supports custom file icons via an icon theme. This extension ships a minimal theme that only adds an `.emw` icon:
  - `Preferences → File Icon Theme → EMWaver Icons (minimal)`
  - If you already use another icon theme, you’ll need to keep it selected and configure that theme’s own “file association” setting (if it supports it).

## Settings

- `emwaver.cliPath`: path to the `emwaver` CLI (default: `emwaver`)
- `emwaver.workingDirectory`: working dir for commands (default: workspace root)
- `emwaver.buildArgs`: extra args for `emwaver build`
- `emwaver.flashArgs`: extra args for `emwaver flash`
