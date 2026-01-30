#!/bin/sh
set -euo pipefail

# EMWaver CLI Installer
# Detects platform and installs the appropriate binary

VERSION="${EMWAVER_CLI_VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
    BASE_URL="${EMWAVER_CLI_BASE_URL:-https://github.com/luispl77/emwaver/releases/latest/download}"
else
    # Handle version tags like "v0.1.0" or "cli-v0.1.0"
    if [ "${VERSION#cli-}" != "$VERSION" ]; then
        VERSION_TAG="$VERSION"
    elif [ "${VERSION#v}" != "$VERSION" ]; then
        VERSION_TAG="cli-$VERSION"
    else
        VERSION_TAG="cli-v$VERSION"
    fi
    BASE_URL="${EMWAVER_CLI_BASE_URL:-https://github.com/luispl77/emwaver/releases/download/$VERSION_TAG}"
fi
INSTALL_ROOT="${EMWAVER_CLI_PREFIX:-$HOME/.local/bin}"

detect_platform() {
    os=$(uname -s)
    arch=$(uname -m)
    
    case "$os" in
        Darwin)
            case "$arch" in
                arm64) echo "macos-aarch64" ;;
                x86_64) echo "macos-x86_64" ;;
                *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
            esac
            ;;
        Linux)
            case "$arch" in
                aarch64|arm64) 
                    echo "ARM64 Linux builds are not yet available. Please build from source or use x86_64." >&2
                    exit 1
                    ;;
                x86_64|amd64) echo "linux-x86_64" ;;
                *) echo "Unsupported Linux architecture: $arch" >&2; exit 1 ;;
            esac
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "windows-x86_64"
            ;;
        *)
            echo "Unsupported operating system: $os" >&2
            exit 1
            ;;
    esac
}

ensure_install_dir() {
    mkdir -p "$INSTALL_ROOT"
}

download_binary() {
    platform=$(detect_platform)
    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT
    
    if [ "$platform" = "windows-x86_64" ]; then
        artifact="emwaver-cli-${platform}.exe"
        target="$tmp_dir/emwaver.exe"
    else
        artifact="emwaver-cli-${platform}"
        target="$tmp_dir/emwaver"
    fi
    
    url="$BASE_URL/$artifact"
    echo "Downloading $url"
    
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$target"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$url" -O "$target"
    else
        echo "Error: curl or wget is required" >&2
        exit 1
    fi
    
    chmod +x "$target"
    
    if [ "$platform" = "windows-x86_64" ]; then
        mv "$target" "$INSTALL_ROOT/emwaver.exe"
        echo "Installed to $INSTALL_ROOT/emwaver.exe"
    else
        mv "$target" "$INSTALL_ROOT/emwaver"
        echo "Installed to $INSTALL_ROOT/emwaver"
    fi
}

ensure_path() {
    case "$SHELL" in
        */zsh) profile="$HOME/.zshrc" ;;
        */bash) profile="$HOME/.bashrc" ;;
        *) profile="$HOME/.profile" ;;
    esac

    if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_ROOT"; then
        echo "" >> "$profile"
        echo "# EMWaver CLI" >> "$profile"
        echo "export PATH=\"$INSTALL_ROOT:\$PATH\"" >> "$profile"
        echo "Added $INSTALL_ROOT to PATH via $profile"
        echo "Restart your shell or run: source $profile"
    fi
}

main() {
    ensure_install_dir
    download_binary
    ensure_path
    echo "Done! Run 'emwaver --help' to get started."
}

main
