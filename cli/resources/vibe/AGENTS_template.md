# AGENTS.md

This repository may be operated by humans and coding agents. Use this file to document how to work in the repo, run device commands, and avoid common foot-guns.

General rules:
- Do not commit secrets (tokens, credentials, pairing keys).
- Prefer small, reversible changes; avoid unrelated refactors.
- Keep on-wire/device command semantics compatible unless explicitly requested.

<!-- EMWAVER_VIBE_HACKING_START -->
## Vibe Hacking

Vibe hacking means: quickly probing and controlling connected modules (SPI/I2C/GPIO/radios) using the EMWaver ASCII command protocol, then turning successful probes into repeatable recipes and Wavelet UIs.

This section is meant to be copy/paste friendly.

### Device discovery + connection management

Scan for nearby devices (BLE):

```bash
emwaver list
```

Start a persistent daemon connection (recommended when iterating):

```bash
emwaver start
emwaver status
emwaver connect
emwaver connected
```

Disconnect/stop:

```bash
emwaver disconnect
emwaver stop
```

### Sending raw commands

**Golden rules**
- Commands are ASCII and must fit in the device’s 64-byte packet; prefer `--key=value` to keep commands short.
- `emwaver cmd ...` sends an ASCII command to the connected device (daemon-backed).

Examples:

```bash
emwaver cmd version
emwaver cmd "gpio read --pin=4"
emwaver cmd --packets 0 "gpio write --pin=4 --level=1"
emwaver cmd --verbose "spi xfer --name=c --tx=0xF1,0x00 --rx=2"
```

### SPI vibe hacking (quickstart)

Core commands:
- `spi open --name=<id> --miso=<pin> --mosi=<pin> --sck=<pin> --cs=<pin>`
- `spi xfer --name=<id> --tx=<hexbytes> --rx=<n>`
- `spi close --name=<id>`

**CC1101 example: read `VERSION` (expects `0x14`)**
- `VERSION` register: `0x31`
- Status-read command byte: `0x31 | 0xC0 = 0xF1`

```bash
emwaver cmd "spi open --name=c --miso=13 --mosi=11 --sck=12 --cs=10"
emwaver cmd --verbose "spi xfer --name=c --tx=0xF1,0x00 --rx=2"
emwaver cmd "spi close --name=c"
```

### Wavelets (turn commands into a UI)

Wavelet `.emw` files are JavaScript plus a small UI DSL (see `app/public/wavelet-assets/cc1101.emw` for a concrete example).

**Key API**
- `emw.send("<ascii command>")` sends a command string (same semantics as the CLI `cmd` command).
- `emw.sendPacket([0x01, 0x02, ...])` sends raw bytes as a packet command (rare; use only when you need byte-level control).

**Minimal wavelet template**

```js
let status = "Ready";

async function ping() {
  status = "Pinging...";
  render();
  const res = await emw.send("version");
  status = `Got: ${res}`;
  render();
}

function render() {
  UI.render(UI.column({
    padding: 16,
    spacing: 12,
    children: [
      UI.text({ text: "My Wavelet", font: "title2" }),
      UI.button({ label: "Ping", onTap: ping }),
      UI.text({ text: status })
    ]
  }));
}

render();
```

**Previewing**
- Desktop app: open the Wavelets workspace, open a `.emw` file, and use the `Preview` action.
- Keep wavelets transport-agnostic: emit the same ASCII commands you validated via `emwaver cmd ...`.
<!-- EMWAVER_VIBE_HACKING_END -->
