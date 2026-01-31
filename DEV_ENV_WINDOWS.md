# EMWaver Windows Dev Environment

This is the project-local setup checklist for bringing up EMWaver development on a Windows 11 machine.

Scope:
- Windows 11 only
- GUI-first workflow for the Windows app (Visual Studio 2022)
- Command Prompt / PowerShell are used for backend/frontend scripts when convenient

What you can develop from Windows:
- Windows app (WinUI 3 / Windows App SDK)
- Android app (Android Studio / Gradle)
- Website (Next.js / Node / npm)
- Backend (Python)
- STM32 firmware (STM32CubeIDE)
- Shared Rust crates (including Windows FFI DLL)

What you cannot develop from Windows:
- iOS app (requires macOS + Xcode)
- macOS app (requires macOS + Xcode)

## 0) Quick Start (after tools are installed)

### Windows app (WinUI 3)

Primary workflow: open `windows/EMWaver.sln` in Visual Studio 2022 and press Run.

This app loads a native Rust DLL from `windows/EMWaver/Native/`.
Build/copy that DLL with the repo helper script:

```powershell
powershell -ExecutionPolicy Bypass -File windows\build-rust-buffer-core.ps1 -Configuration Debug -Target x86_64-pc-windows-msvc
```

Then run the app from Visual Studio.

### Backend (Flask)

```bat
cd backend
python -m pip install -r requirements.txt
set EMWAVER_AUTH_MODE=disabled
REM only if you call /api/agent/chat
set OPENROUTER_API_KEY=...
python app.py
```

### Website (Next.js)

```bat
cd frontend
npm install
npm run dev
```

## 1) Visual Studio 2022 (Windows app)

Install Visual Studio 2022 with:
- Workload: ".NET desktop development"
- Workload: "Desktop development with C++" (for Windows SDK bits)
- Component: Windows App SDK / WinUI 3 support

Repo entrypoints:
- Solution: `windows/EMWaver.sln`
- Project: `windows/EMWaver/EMWaver.csproj`

Target framework (current): `net8.0-windows10.0.22621.0`.

## 2) .NET SDK

Install .NET SDK 8.x.

Verify:

```bat
dotnet --version
```

## 3) Rust (shared buffer core + Windows FFI DLL)

Install Rust via rustup and ensure you are using the MSVC toolchain.

Verify:

```bat
rustc --version
cargo --version
```

Build/copy the Windows FFI DLL into the WinUI project output:

```powershell
powershell -ExecutionPolicy Bypass -File windows\build-rust-buffer-core.ps1 -Configuration Debug -Target x86_64-pc-windows-msvc
```

Notes:
- The script builds `crates/emwaver-buffer-windows-ffi` and copies `emwaver_buffer_windows.dll` into `windows/EMWaver/Native/`.
- The WinUI project is set to copy `windows/EMWaver/Native/*.dll` to the output directory.

## 4) Node.js + npm (frontend)

Install Node.js (recommend Node 20+).

Verify:

```bat
node --version
npm --version
```

Dev server:

```bat
cd frontend
npm install
npm run dev
```

## 5) Python (backend)

Install Python 3.14.

Verify:

```bat
python --version
python -m pip --version
```

Install backend deps:

```bat
cd backend
python -m pip install -r requirements.txt
```

## 6) Android (optional on Windows)

- Install Android Studio.
- Install an SDK + platform tools from within Android Studio.

Notes:
- Android builds use Gradle via the repo's wrapper: `android/gradlew`.
- Prefer Android Studio for normal iteration.

## 7) STM32 Firmware tooling (optional on Windows)

- Install STM32CubeIDE (needed for the toolchain + project files).

Notes:
- On Windows, the simplest path is to build the firmware from STM32CubeIDE.
- The internal CLI command `emwaver build` currently hardcodes a macOS STM32CubeIDE toolchain path in `cli/src/lib.rs`. If you want `emwaver build` to work on Windows, you'll need to update that logic to find your Windows-installed `arm-none-eabi-gcc`/`arm-none-eabi-objcopy` (or make sure those tools are on PATH and stop overriding PATH).

## 8) Git

Install Git for Windows (or use the Git integration that ships with Visual Studio).

Verify:

```bat
git --version
```

## 8) AI Tooling (optional)

OpenCode is the primary assistant tool in this workflow.

Install (one-time):

- Windows: use the OpenCode Desktop (GUI).
- Authenticate with an OpenAI account (ChatGPT Plus subscription).
- Model: `openai/gpt-5.2` (GPT 5.2).

Install OpenCode Desktop from:
- https://opencode.ai
