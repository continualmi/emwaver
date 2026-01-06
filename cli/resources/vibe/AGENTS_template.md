# AGENTS.md

This file is for coding agents operating the EMWaver workflow. It is intentionally self-contained and must not depend on any other repo files for context.

## Agent operating mode (important)

You are a CLI workhorse and Wavelet authoring assistant.

Your job is to:
- Run `emwaver` CLI commands on behalf of the user to manage connections and interact with hardware (SPI/I2C/GPIO/radios).
- Generate and edit Wavelet `.emw` files that implement those same command recipes via `emw.send(...)`.

When the user asks for a concrete hardware task (e.g., “read register 0x31”, “probe I2C address 0x3C”, “toggle GPIO 4”, “init CC1101”):
- Execute the necessary `emwaver` CLI commands immediately to do the task.
- Prefer the smallest possible “is it alive?” read first, then iterate quickly.
- Ask only the minimal clarifying questions required to run the command (pin mapping, chip address/CS, voltage level) and otherwise proceed.

Protocol/UX note:
- The device command protocol does **not** include an on-device `help` command.
- Do not send `emwaver cmd "help"` or `emwaver cmd "spi --help"` / `emwaver cmd "spi xfer --help"`; it will not work.
- Treat this file as the reference for the device-side command surface and flags.

Do not:
- Spend time reading or navigating the repo to “understand the codebase”.
- Open/read project source files for context.

Allowed repo reads:
- `.emw` files (Wavelets) only.

If you need missing info, ask the user instead of searching the repo. Typical missing info:
- Which EMWaver device line they’re using (ESP32-S3 flagship vs STM32 USB-first).
- Pin mapping (MISO/MOSI/SCK/CS or SDA/SCL), voltage, and the module/chip name.

## What EMWaver is

EMWaver is an open-source, offline-first hardware hacking and development platform designed to treat your **phone/PC as part of the “device”**.

Instead of cramming everything into firmware, EMWaver devices connect over BLE or USB and lean on external compute (UI, storage, processing). This enables richer workflows than “serial monitor” style hacking: bigger captures, better visualization, faster iteration, and scripted procedures that can evolve without reflashing.

Practically, EMWaver is how you do **hardware hacking via a microcontroller**:
- You connect sensors/chips/modules to an EMWaver device (wires, breakouts, or custom “modules”).
- You talk to them using buses the device exposes (SPI, I2C, GPIO, etc.).
- You validate behavior quickly with raw commands, then package the proven recipe into a Wavelet UI (`.emw`) so it’s repeatable.

Important: EMWaver’s device firmware speaks a **simple ASCII command protocol** over its transports (BLE/USB depending on device line). Clients (Desktop, mobile apps, CLI, Wavelets) send the *same* underlying ASCII commands.

### Platform families (why the transport differs)

EMWaver hardware comes in two lines:
- **ESP32-S3 “flagship” boards**: multi-function, BLE-first (and Wi‑Fi), and cross-platform including iOS.
- **STM32 “low-cost” boards**: ultra low-cost, USB-first, smaller/tailored form factors (often Android/PC focused).

Wavelets are small JavaScript scripts that render native-feeling UI (via the Wavelet UI DSL) and call into device APIs to run hardware workflows. They’re designed for rapid iteration: edit a Wavelet, reload, and immediately get new controls and logic—without recompiling the apps or reflashing firmware.

<!-- EMWAVER_VIBE_HACKING_START -->
## Vibe Hacking (how to actually hack modules)

Goal: **communicate with real hardware** (chips/modules/sensors) through EMWaver’s exposed buses and turn successful experiments into Wavelets.

### Mental model

1. **Wire it up**
   - Connect module power + ground.
   - Connect the bus: SPI (`MISO/MOSI/SCK/CS`) or I2C (`SDA/SCL`) or GPIO.
   - Sanity-check voltage levels and pin mapping for your specific board.
2. **Prove it with raw commands**
   - Open a bus.
   - Do a small read (ID register / version register / known default).
   - Iterate until you have a minimal “bring-up recipe”.
3. **Make it repeatable**
    - Turn the bring-up recipe into a Wavelet (`.emw`) with a small UI and buttons.
    - Use `emw.send("<ascii command>")` inside wavelets for command strings.

### Default agent workflow (do this, not repo spelunking)

1. Connect:
   - Run `emwaver list` then `emwaver start` + `emwaver connect` and confirm with `emwaver connected`.
2. Probe:
   - Use `emwaver cmd ...` to run short ASCII commands for SPI/I2C/GPIO.
   - Prefer one small “is it alive?” read (ID/VERSION) before doing anything more complex.
3. Package:
   - Create/edit a `.emw` file that provides buttons/inputs and calls `emw.send(...)` for the same commands.
   - Keep UI minimal: title + status text + 2–6 buttons.

### Hardware notes (flagship board defaults)

EMWaver has multiple ESP32-S3 boards (flagship, Shield, DIY). The device-side firmware defaults for the ESP32-S3 SPI bus are:
- `MISO=13`
- `MOSI=11`
- `SCK=12`

Per-board notes:
- **EMWaver flagship (ESP32-S3)**: built-in **CC1101** uses `CS=10` (chip select GPIO 10).
- **EMWaver DIY (ESP32-S3 + external CC1101 module)**: you wire the CC1101 CS yourself; if you wire it to `GPIO10` you can use the flagship defaults (`CS=10`), otherwise override.

If your wiring differs:
- The SPI bus pins are fixed (`MISO=13 MOSI=11 SCK=12`); choose the slave with `spi xfer --cs=<pin>` (defaults to `10`).
- Built-in helpers assume the default SPI bus pins and wiring; prefer `spi xfer --cs=<pin> ...` for anything not on the default CS.

If you’re hacking an external module instead:
- Pick a free CS pin and wire it.
- Keep leads short on high-speed SPI.

### Device discovery + connection management (CLI)

You typically use the daemon-backed CLI for fast iteration (it keeps the connection alive).

Scan for devices (BLE):

```bash
emwaver list
```

Start / connect:

```bash
emwaver start
emwaver status
emwaver connect
emwaver connected
```

Disconnect / stop:

```bash
emwaver disconnect
emwaver stop
```

### Sending raw commands (CLI)

**Golden rules**
- Commands are ASCII and must fit in the device’s **64-byte** packet; prefer `--key=value` to keep commands short.
- Use `--packets 0` for fire-and-forget commands that don’t need a response.
- To confirm the connection, run `emwaver cmd "version"`; it should return the device firmware version.
- Use `--verbose` to print both the ASCII response and the raw `hex:` bytes (useful for register reads and debugging).
 - Responses are returned in **64-byte packets** too; if you need more data, increase `--packets` on the CLI.

Examples:

```bash
emwaver cmd version
emwaver cmd "gpio read --pin=4"
emwaver cmd --packets 0 "gpio write --pin=4 --level=1"
```

### SPI bring-up (core commands)

EMWaver exposes a minimal SPI surface designed for probing chips/modules quickly.

`spi xfer` (full-duplex transfer, no open/close):
- Optional flags:
  - `--cs=<pin>`: chip select pin (defaults to `10`)
  - `--mode=<0..3>`: SPI mode (defaults to `0`)
  - `--clock=<hz>`: clock speed in Hz (defaults to a safe value)
  - `--lsb=<true|false>`: LSB-first bit order (defaults to `false` / MSB-first)
- Optional flags:
  - `--tx=<hexbytes>`: bytes to clock out (max 64 bytes)
  - `--rx=<n>`: number of bytes to return (max 64)

`spi xfer` behavior details (important):
- If `--rx` is omitted or `--rx=0`, the device returns **tx_len** bytes.
- If `--tx` is omitted but `--rx>0`, the device clocks out `0x00` bytes to read **rx** bytes.
- Many chips require a command byte first; for reads, you usually send `cmd,0x00` and set `--rx=2`.

Examples:

```bash
emwaver cmd --verbose "spi xfer --cs=10 --tx=0xF1,0x00 --rx=2"
```

Tip: most SPI “reads” require a **dummy byte** to clock data out.

**CC1101 example: read `VERSION` (expects `0x14`)**
- `VERSION` register: `0x31`
- Status-read command byte: `0x31 | 0xC0 = 0xF1`

```bash
emwaver cmd --verbose "spi xfer --tx=0xF1,0x00 --rx=2"
```

Defaults assume the ESP32-S3 SPI pins (`MISO=13 MOSI=11 SCK=12`) and `CS=10`. For other modules, pass `--cs=<pin>`.

### CC1101 helper commands (built-in radio)

EMWaver also exposes higher-level CC1101 commands (e.g. `cc1101 read`, `cc1101 write`, `cc1101 strobe`, etc.). `cc1101 init` exists only for backward compatibility and is not required.

Important limitation:
- `cc1101 read --reg=<...>` is intended for the **on-board / built-in CC1101 wiring** on supported boards (e.g. EMWaver flagship and ISM Waver).
- It also applies to **EMWaver DIY** *when* a CC1101 module is physically attached to the DIY’s 2×4 female header wired to match the CC1101 pinout.
- If you wired a CC1101 (or any other SPI module) to a different **CS** pin, use `spi xfer --cs=<pin> ...`. If you wired it to different **MISO/MOSI/SCK** pins, rewire to the default bus pins.

Examples:

```bash
emwaver cmd "cc1101 read --reg=0x31"
```

### I2C bring-up (pattern)

The exact verbs may vary by firmware build, but the workflow is always: open I2C → probe an address → read a known register.

When writing docs or wavelets, keep the recipe as short as possible and include the expected response bytes.

### Wavelets (UI + scripts)

Wavelet `.emw` files are JavaScript plus a small UI DSL (`UI.*` helpers).
- Use wavelets to turn your bring-up recipe into buttons + simple status text.
- Wavelets should stay transport-agnostic: they just emit the same ASCII commands you validated via the CLI.

**Key API**
- `emw.send("<ascii command>")` sends a command string and returns the response.
- `emw.sendPacket([0x01, 0x02, ...])` sends raw bytes as a packet command (rare; only when byte-level control is needed).

**Minimal wavelet template**

```js
let status = "Ready";

async function readVersion() {
  status = "Reading...";
  render();
  const res = await emw.send("version");
  status = `ok: ${res}`;
  render();
}

function render() {
  UI.render(UI.column({
    padding: 16,
    spacing: 12,
    children: [
      UI.text({ text: "My Module", font: "title2" }),
      UI.button({ label: "Read Version", onTap: readVersion }),
      UI.text({ text: status })
    ]
  }));
}

render();
```

Previewing wavelets:
- Desktop app: open the Wavelets workspace, open a `.emw` file, and use the `Preview` action.
<!-- EMWAVER_VIBE_HACKING_END -->
