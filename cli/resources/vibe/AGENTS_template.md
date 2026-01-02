# AGENTS.md

This file is for coding agents working in the EMWaver repo. It provides the minimum operational context for doing real work (hardware bring-up, protocol probing, and Wavelet authoring) without needing to consult other repo files.

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

### Hardware notes (flagship board defaults)

EMWaver “flagship” (ESP32-S3) boards include a **CC1101** radio on-board.
- The on-board CC1101 commonly uses `CS=10` (chip select GPIO 10).
- The rest of the SPI wiring (MISO/MOSI/SCK) is board-specific; don’t assume numbers unless you’re looking at that board’s pin map/schematic.

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

Examples:

```bash
emwaver cmd version
emwaver cmd "gpio read --pin=4"
emwaver cmd --packets 0 "gpio write --pin=4 --level=1"
```

### SPI bring-up (core commands)

- `spi open --name=<id> --miso=<pin> --mosi=<pin> --sck=<pin> --cs=<pin>`
- `spi xfer --name=<id> --tx=<hexbytes> --rx=<n>`
- `spi close --name=<id>`

Tip: most SPI “reads” require a **dummy byte** to clock data out.

**CC1101 example: read `VERSION` (expects `0x14`)**
- `VERSION` register: `0x31`
- Status-read command byte: `0x31 | 0xC0 = 0xF1`

```bash
emwaver cmd "spi open --name=cc --miso=<PIN> --mosi=<PIN> --sck=<PIN> --cs=10"
emwaver cmd --verbose "spi xfer --name=cc --tx=0xF1,0x00 --rx=2"
emwaver cmd "spi close --name=cc"
```

Replace `<PIN>` with your actual SPI pin mapping.

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

Concrete examples:
- Built-in asset wavelets live under `app/public/wavelet-assets/` (start with `app/public/wavelet-assets/cc1101.emw`).

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
