# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Releases (Desktop Binaries)

GitHub Actions builds the desktop app for macOS/Windows/Linux when you push a tag matching `app-v*`.

1) Bump versions:
- `app/package.json` (`version`)
- `app/src-tauri/tauri.conf.json` (`version`)
- `app/src-tauri/Cargo.toml` (`package.version`)

2) Tag + push:
```bash
git tag app-v0.1.0
git push origin app-v0.1.0
```

3) Download artifacts from the GitHub Release created by `.github/workflows/release-desktop.yml`.

## Linux Notes

- The Linux AppImage is built on Ubuntu 22.04 to avoid requiring a very new `glibc`.
- Tauri v2 depends on WebKitGTK 4.1. On Ubuntu 22.04, you may need the upstream WebKit PPA:
```bash
sudo apt-get update
sudo apt-get install -y software-properties-common
sudo add-apt-repository -y ppa:webkit-team/ppa
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```
