# CLI Release Guide

This guide explains how to build and release the EMWaver CLI.

## Automated Release (Recommended)

### Creating a Release via GitHub Actions

1. **Update version in `Cargo.toml`**:
   ```toml
   [package]
   version = "0.1.0"  # Update this
   ```

2. **Commit and push the changes**:
   ```bash
   git add cli/Cargo.toml
   git commit -m "cli: bump version to 0.1.0"
   git push
   ```

3. **Create and push a tag**:
   ```bash
   git tag cli-v0.1.0
   git push origin cli-v0.1.0
   ```

   The GitHub Actions workflow will automatically:
   - Build binaries for all platforms (Linux x86_64/aarch64, macOS Intel/Apple Silicon, Windows)
   - Create a GitHub release with all artifacts
   - Generate checksums for verification

### Manual Release via GitHub Actions UI

1. Go to Actions → Release CLI → Run workflow
2. Enter the version (e.g., `v0.1.0`)
3. Click "Run workflow"

## Manual Release

### Building Locally

```bash
cd cli

# Linux x86_64
cargo build --release --target x86_64-unknown-linux-gnu
strip target/x86_64-unknown-linux-gnu/release/emwaver
mv target/x86_64-unknown-linux-gnu/release/emwaver emwaver-cli-linux-x86_64

# Linux aarch64
cargo build --release --target aarch64-unknown-linux-gnu
aarch64-linux-gnu-strip target/aarch64-unknown-linux-gnu/release/emwaver
mv target/aarch64-unknown-linux-gnu/release/emwaver emwaver-cli-linux-aarch64

# macOS Intel (requires macOS or cross-compilation)
cargo build --release --target x86_64-apple-darwin
strip target/x86_64-apple-darwin/release/emwaver
mv target/x86_64-apple-darwin/release/emwaver emwaver-cli-macos-x86_64

# macOS Apple Silicon (requires macOS or cross-compilation)
cargo build --release --target aarch64-apple-darwin
strip target/aarch64-apple-darwin/release/emwaver
mv target/aarch64-apple-darwin/release/emwaver emwaver-cli-macos-aarch64

# Windows (requires Windows or cross-compilation)
cargo build --release --target x86_64-pc-windows-msvc
mv target/x86_64-pc-windows-msvc/release/emwaver.exe emwaver-cli-windows-x86_64.exe
```

### Creating Checksums

```bash
# Linux/macOS
sha256sum emwaver-cli-* > checksums.txt

# Windows (PowerShell)
Get-ChildItem emwaver-cli-* | ForEach-Object { certutil -hashfile $_.Name SHA256 } > checksums.txt
```

### Creating GitHub Release

1. Go to https://github.com/luispl77/emwaver/releases/new
2. Tag: `cli-v0.1.0` (must start with `cli-`)
3. Title: `EMWaver CLI 0.1.0`
4. Description: See template below
5. Upload all binaries and checksums
6. Publish release

## Release Notes Template

```markdown
## EMWaver CLI 0.1.0

### Installation

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

**Windows:**
Download `emwaver-cli-windows-x86_64.exe` and add it to your PATH.

### Checksums
See the `.sha256` files for verification.

### Changes
- Initial release
- USB device discovery and connection (daemon-backed)
- Interactive shell for device control
```

## Installation URLs

After release, users can install with:

```bash
# Latest version
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh

# Specific version
EMWAVER_CLI_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```
