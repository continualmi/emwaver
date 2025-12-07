#!/bin/sh
set -euo pipefail

VERSION="${EMWAVER_CLI_VERSION:-latest}"
BASE_URL="${EMWAVER_CLI_BASE_URL:-https://placeholder.blob.core.windows.net/emwaver-cli}"
INSTALL_ROOT="${EMWAVER_CLI_PREFIX:-$HOME/.local/bin}"

detect_arch() {
    arch=$(uname -m)
    case "$arch" in
        arm64) echo "aarch64" ;;
        x86_64) echo "x86_64" ;;
        *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
    esac
}

ensure_install_dir() {
    mkdir -p "$INSTALL_ROOT"
}

download_binary() {
    arch=$(detect_arch)
    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT
    artifact="emwaver-cli-macos-${arch}"
    if [ "$VERSION" != "latest" ]; then
        artifact="$artifact-$VERSION"
    fi
    url="$BASE_URL/$artifact"
    target="$tmp_dir/emwaver-cli"
    echo "Downloading $url"
    curl -fsSL "$url" -o "$target"
    chmod +x "$target"
    mv "$target" "$INSTALL_ROOT/emwaver"
    echo "Installed to $INSTALL_ROOT/emwaver"
}

ensure_path() {
    case "$SHELL" in
        */zsh) profile="$HOME/.zshrc" ;;
        */bash) profile="$HOME/.bashrc" ;;
        *) profile="$HOME/.profile" ;;
    esac

    if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_ROOT"; then
        echo "export PATH=\"$INSTALL_ROOT:\$PATH\"" >> "$profile"
        echo "Added $INSTALL_ROOT to PATH via $profile"
    fi
}

ensure_install_dir
download_binary
ensure_path
echo "Done. Restart your shell or source your profile to use 'emwaver'."
