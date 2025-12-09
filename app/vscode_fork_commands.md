# EMWaver IDE (VS Code Fork) Setup Log

Recorded steps for cloning and building the VS Code fork before we pivoted away from this approach.

## Repository Preparation

- `git clone --depth 1 https://github.com/microsoft/vscode.git EMWaver`
- `rm -rf EMWaver/.git`

## Tooling Installation & Environment

- `brew install yarn`
- `brew install node@18`
- Added `export PATH="/usr/local/opt/node@18/bin:$PATH"` to `~/.zshrc` (later replaced by Node 22 path).
- Attempted `yarn install --frozen-lockfile` (blocked by Node version guard).
- Installed Node 22 and updated PATH per README requirements: `brew install node@22`, `echo 'export PATH="/usr/local/opt/node@22/bin:$PATH"' >> ~/.zshrc`, `source ~/.zshrc`.
- Switched to npm per repo instructions (`npm` only; yarn no longer supported).

## Dependency Installation & Build Attempts

- Initial `yarn gulp compile` failed because `node_modules` was absent.
- `npm install` (prompted by preinstall script to use Node 22).
- `npm run compile` (first attempt hit JS heap OOM).
- Re-ran with increased heap: `NODE_OPTIONS=--max-old-space-size=8192 npm run compile` (completed after long extension build).
- If compile logging stalls after `Finished compile-extensions`, `Ctrl+C` safely exits once tasks complete.

## Launching the Dev Host

- `./scripts/code.sh` downloads Electron and built-in extensions, then launches the Code - OSS window (requires successful compile to have `out/main.js`).
- On failure, clean state via:
  - `rm -rf node_modules out`
  - `find extensions -type d -name dist -prune -exec rm -rf {} +`
  - Re-run `npm ci` and `NODE_OPTIONS=--max-old-space-size=8192 npm run compile`.

## Final Notes

- README and `build/npm/preinstall.js` enforce Node.js ≥ 22.15.1 and forbid yarn installs.
- Keep this log for future reference if we resume a VS Code fork-based IDE.
