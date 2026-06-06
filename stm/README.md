# STM Firmware Workspace (`/stm`)

This folder contains the STM32 firmware source projects and helper scripts used to build/export firmware artifacts for EMWaver (a **Continual MI** project).

The platform supports multiple MCU board targets. This workspace currently contains the STM32F042 firmware; additional STM targets, if added in the future, should live as separate projects within this workspace.

If you only read one thing first, read:
- `emwaver-firmware/Core/Src/main.c` (runtime behavior + protocol handling)
- `emwaver-firmware/USB_DEVICE/App/usbd_midi_if.c` (USB transport framing)
- `emwaver-firmware/Core/Inc/emw_proto.h` (opcode contract)

---

## 1) Scope and role in the repo

`/stm` is the **firmware-authoring workspace** for EMWaver supported boards. The current active project targets the STM32F042G6Ux (EMWaver board). It is responsible for:

- Device-side command execution (GPIO, ADC, PWM, SPI, UART, I2C).
- USB MIDI SysEx transport (fixed 64-byte USB packets).
- Streaming modes used for high-rate sampling/retransmit behavior.
- Device metadata endpoints (firmware version, device name, signed identity reads).
- Building/exporting `.elf` and `.bin` artifacts for app bundling.

This folder does **not** own host app, desktop MCP, or product runtime logic; it is strictly MCU-side firmware and build helpers.

### Board-specific notes (STM32F042 — EMWaver board)

**MCU note:** the EMWaver board (coming soon) uses **STM32F042G6Ux**. The notes below are specific to this target.
- CubeMX/datasheet show many pins have timer alternate-functions (e.g. PB7 can expose TIM16/TIM17 complementary outputs on some configs), but **current firmware PWM support is limited to TIM2 on PA0–PA3** (see firmware `tim2_channel_from_pin`).
- Expanding PWM to more pins requires firmware work: mapping additional timers/channels + correct AF selection + managing peripheral conflicts.

**CubeMX pin→timer notes (STM32F042G6Ux):**
- A0 → TIM2 CH1
- A1 → TIM2 CH2
- A2 → TIM2 CH3
- A3 → TIM3 CH4
- A4 → TIM14 CH1
- A5 → TIM2 CH1
- A6 → TIM16 CH1, TIM3 CH1
- A7 → TIM14 CH1, TIM17 CH1, TIM1 CH1N, TIM3 CH2
- B6 → TIM16 CH1N
- B7 → TIM17 CH1N
- B8 → TIM16 CH1

**EMWaver board connector notes:**
- CN1 (2×4) exposes VCC/GND + SPI (`NSS`, `SCK`, `MOSI`, `MISO`) + GPIO (`GDO0`, `GDO1`, `GDO2`) and aligns with common CC1101-style 2×4 module headers.
- U4 (1×8) exposes `VCC`, `PB6`, `BOOT0`, `MISO`, `MOSI`, `NSS1`, `SCL`, `PB7` and aligns with common RC522-style 1×8 module headers.

**Important dev workflow:** app updaters flash a **`.bin`**, not firmware `.elf` directly.
After building `stm/emwaver-firmware/Release/emwaver-firmware.elf`, update bundled `emwaver.bin` copies with:
- `stm/update_firmware_bins.sh` (optionally pass an `.elf` path).

---

## 2) Current structure

- `emwaver-firmware/` — active STM32CubeIDE firmware project.
- `build_android_assets.sh` — top-level helper intended to build/copy Android DFU assets (currently references legacy folders; see notes).
- `update_firmware_bins.sh` — converts a built `.elf` into `.bin` and copies to platform bundle locations.
- `.gitignore` — keeps generated build metadata while preserving canonical build dirs and `.elf` artifact in-repo.

Inside `emwaver-firmware/`:

- `Core/`
  - `Src/main.c` — primary firmware logic and opcode dispatcher.
  - `Src/stm32f0xx_it.c` — IRQ handlers (TIM3 + USB are critical).
  - `Src/stm32f0xx_hal_msp.c` — peripheral pin/clock MSP init.
  - `Inc/main.h` — pin defines and shared declarations.
  - `Inc/emw_proto.h` — binary command protocol constants.
  - `Inc/emwaver_usb_io.h` — transport alias layer.
- `USB_DEVICE/`
  - `App/usbd_midi.c` — USB MIDI class implementation/descriptors.
  - `App/usbd_midi_if.c` — EMWaver frame decode/encode and RX/TX queues.
  - `App/usb_device.c` — USB stack bootstrap.
  - `Target/usbd_conf.c` — low-level PCD/HAL glue and IRQ priority setup.
- `Drivers/` + `Middlewares/` — vendored HAL/CMSIS/USB device sources.
- `Release/` — committed generated make build tree and resulting `emwaver-firmware.elf`.
- `STM32F042G6UX_FLASH.ld` — linker script.
- `emwaver-firmware.ioc` — STM32CubeMX project definition.

---

## 3) Firmware architecture (runtime)

### 3.1 Boot and init path

`main()` performs:
1. optional dev-only forced DFU (`EMW_FORCE_DFU_ON_BOOT`, default off),
2. HAL reset/init,
3. system clock setup (HSI48),
4. peripheral init (`GPIO`, `TIM2`, `TIM1`, USB, `TIM3`, `SPI1`),
5. infinite loop:
   - drains sampler ring if sampling mode is active,
   - processes one 18-byte command lane when available,
   - emits command responses as 36-byte superframes (command lane + stream lane).

### 3.2 Core execution model

The firmware processes **18-byte command lanes** received over USB MIDI.

- Request lane: `[opcode, args...]`.
- Response lane: `[status, payload...]`.
- Status values are in `emw_proto.h`:
  - `0x80` OK
  - `0x81` ERR

For streaming modes, command responses can be **piggybacked** onto outgoing stream frames via `pending_cmd_lane`.

### 3.3 Two-lane frame model

Decoded frame size: **36 bytes** (`EMW_SUPERFRAME_SIZE`).

- Lane 0 (bytes 0..17): command lane.
- Lane 1 (bytes 18..35): stream lane.

Transport layer maps this to a fixed USB transaction (details in section 4).

---

## 4) USB transport contract (device-side)

Implemented mainly in `USB_DEVICE/App/usbd_midi_if.c`.

### 4.1 Fixed USB packet rule

One firmware frame is transported in exactly one USB OUT transfer of 64 bytes.

- 16 USB-MIDI event packets × 4 bytes each = 64 bytes.
- MIDI payload reconstructed to 48 bytes SysEx.

Expected fixed SysEx bytes:

`F0 7D 'E' 'M' 'W' <42 encoded bytes> F7`

Validation failure causes packet drop.

### 4.2 7-bit packing

42 encoded bytes decode to 36 raw bytes via prefix/MSB grouping.

- each prefix byte stores MSBs for up to 7 following bytes,
- decoded output split into cmd lane + stream lane.

### 4.3 Buffer modes (`EMW_Buffer_Type`)

Defined in `usbd_midi_if.h`:

- `EMW_BUFFER_PACKET` — default command packet mode.
- `EMW_BUFFER_CIRCULAR` — retransmit streaming mode; stream lane appended to circular RX buffer.
- `EMW_BUFFER_DOUBLE` — sampling mode using ISR ring lanes.

### 4.4 TX behavior

- `MIDI_SendResponsePkt_FS` — blocking send with timeout.
- `MIDI_TrySendResponsePkt_FS` — non-blocking try-send.
- `MIDI_PollTx_FS` + `MIDI_QueueStatusPacket_FS` — delayed “BS” status packet emission.
- USB debug counters tracked: ok/busy/timeout/fail/rx.

---

## 5) Interrupt and timing model

### 5.1 TIM3 as hot-path tick source

`TIM3_IRQHandler` bypasses generic HAL IRQ dispatch for performance and calls `EMW_TIM3_Tick_ISR()` directly.

Rationale in code:
- 5µs tick target on 48MHz core,
- keep ISR minimal.

`EMW_TIM3_Tick_ISR()` dispatches to:
- `ISR_Sampler_raw()` in sampling mode,
- `ISR_Sampler_writing()` in retransmit mode.

### 5.2 USB IRQ priority

In `usbd_conf.c`:
- TIM3 kept at higher preemption priority,
- USB set lower so high-rate timing path remains deterministic.

---

## 6) Command protocol (implemented opcodes)

Opcode constants are in `Core/Inc/emw_proto.h`; handling is in `Core/Src/main.c`.

## 6.1 System

- `EMW_OP_VERSION (0x01)` → returns `[major, minor, patch]` from firmware constants.
- `EMW_OP_RESET (0x02)` → ACK then system reset.
- `EMW_OP_HELP (0x03)` → ACK only (docs are host-side).
- `EMW_OP_ENTER_DFU (0x06)` → destructive ROM DFU path (erase first flash pages + reset).

## 6.2 Device identity and naming

- `EMW_OP_IDENTITY_GET (0x07)`
  - reads signed identity blob from flash page at `0x08007800`.
  - supports:
    - `which=0` device id (16 bytes)
    - `which=1` proof chunk (16 bytes per chunk, 4 chunks total)
  - validates magic/version/length fields before returning data.
- `EMW_OP_HARDWARE_UID_GET (0x08)`
  - returns the STM32 factory-programmed 96-bit unique device identifier (12 bytes).
  - current implementation reads `HAL_GetUIDw0/1/2()` and returns the three 32-bit words in little-endian byte order.
  - intended use: local diagnostics and board/runtime metadata where needed. It must not be used as an activation, ownership, or device-limit gate for local hardware control.
- `EMW_OP_BOARD_GET (0x09)`
  - returns the short board slug `stm32f042`.
  - intended use: script/UI code can differentiate supported MCU targets without overloading the signed identity flow.
- `EMW_OP_NAME_GET (0x04)`
  - reads user device name from `0x08007C00` (up to 32 bytes).
- `EMW_OP_NAME_SET (0x05)`
  - erases name page and writes halfword chunks from command lane payload.

## 6.3 GPIO (`EMW_OP_GPIO`, `0x10`)

Subcommands:
- `IN`, `OUT`, `PULL`, `READ`, `HIGH`, `LOW`, `INFO`.

Pin encoding used by protocol:
- `0..15` => `PA0..PA15`
- `16..31` => `PB0..PB15`

Important behavior:
- Firmware disables TIM2 output on relevant PA pins before changing regular GPIO modes where needed.
- `INFO` returns packed register-state snapshot (`mode`, `otype`, `pupd`, `af`, `idr`, `odr`).

## 6.4 ADC (`EMW_OP_ADC_READ`, `0x20`)

Supports source selector:
- external pin (`PA0..PA7`, `PB0..PB1`),
- internal temp sensor,
- VREFINT,
- VBAT.

Behavior:
- one-shot conversion with optional averaging (`samples` clamped 1..64),
- returns 12-bit averaged result as little-endian 2 bytes.

## 6.5 UART (`EMW_OP_UART`, `0x30`)

Subcommands:
- `OPEN`, `CLOSE`, `WRITE`, `READ`.

Implementation notes:
- Uses USART1 on PB6/PB7.
- Simple polling TX/RX loops with timeout.
- Bus ownership arbitration with I2C (shared pins/peripheral exclusivity).

## 6.6 I2C (`EMW_OP_I2C`, `0x40`)

Subcommands:
- `OPEN`, `CLOSE`, `WRITE`, `READ`, `XFER`.

Implementation notes:
- Uses I2C1 on PB6/PB7 (AF1 open-drain, pull-up).
- Includes repeated-start write+read sequence (`XFER`).
- Uses direct register-level flow with timeout and basic error checks.

## 6.7 SPI (`EMW_OP_SPI_XFER`, `0x50`)

- Uses SPI1 master on PA5/PA6/PA7.
- Chip select pin is protocol-encoded and toggled in firmware around transfer.
- Full-duplex transmit/receive (`HAL_SPI_TransmitReceive`) with returned RX bytes.

## 6.8 Sampling (`EMW_OP_SAMPLE`, `0x60`)

Subcommands:
- `START`, `STOP`.

`START` behavior:
- configures selected pin as input,
- optional `tick_us` (minimum enforced 5µs),
- switches USB buffer mode to `DOUBLE`,
- starts TIM3 update IRQ,
- ISR packs sampled bits into 18-byte stream lanes,
- lanes are queued in bounded ring (`SAMPLER_RING_LANES=16`).

Overflow behavior:
- uses overflow lane + dropped-lane counter to avoid overwriting unsent data.

## 6.9 PWM (`EMW_OP_PWM`, `0x70`)

Subcommands:
- `FREQ`, `WRITE`, `STOP`.

`WRITE` accepts 12-bit value (`0..4095`) plus optional Hz.

Pin routing is dynamic and includes timers beyond TIM2:
- TIM2: PA0/PA1/PA2/PA5,
- TIM14: PA4,
- TIM16: PA6/PB8 (+ PB6 complement),
- TIM17: PA7 (+ PB7 complement).

Important conflict policy:
- TIM3 PWM routes intentionally excluded from mapping to avoid collisions with sampler/retransmit tick ISR.

Edge behavior:
- `value==0` => force pin low as GPIO,
- `value>=4095` => force pin high as GPIO,
- otherwise configure AF and start PWM route.

## 6.10 Retransmit (`EMW_OP_TRANSMIT`, `0x80`)

Subcommands:
- `START`, `STOP`.

`START`:
- selects TIM2 channel from pin index 0..3 (PA0..PA3),
- optional duty %, optional PWM Hz, optional tick_us,
- switches RX to circular mode and consumes incoming stream bits,
- TIM3 ISR toggles timer channel output enable according to incoming bits.

When done:
- stops TIM3,
- restores packet mode,
- stops selected PWM channel,
- flushes/frees RX buffer.

---

## 7) Pin/peripheral map in current firmware

### 7.1 Base peripheral setup

- USB FS: USB peripheral with remap support (PA11/PA12 remap enabled in MSP).
- SPI1: PA5 SCK, PA6 MISO, PA7 MOSI.
- TIM2 PWM channels configured for PA0..PA3 usage.
- TIM3: base timer for 5µs-class ISR tick.
- IR RX pin define: `PA1` (`IR_RX_Pin`) in `main.h`.
- RFID NSS define: `PA4` (`NSS_RFID_Pin`) in `main.h`.
- PB0 configured as `VCTL` output and driven low early in GPIO init.

### 7.2 Dynamic multiplexing caveat

PB6/PB7 are shared and switched at runtime between:
- UART1 (AF0),
- I2C1 (AF1 OD).

Firmware enforces single bus owner (`BUS_OWNER_*`).

---

## 8) Flash layout used by firmware

- `0x08000000` start of application flash.
- `0x08007C00` user device name page.

DFU entry routine intentionally erases early flash pages (starting at app base) so ROM empty-check falls into system DFU bootloader.

---

## 9) Build and artifact flow

## 9.1 Canonical project

Use STM32CubeIDE project:
- `emwaver-firmware/emwaver-firmware.ioc`
- generated make tree at `emwaver-firmware/Release/`

## 9.2 Local build helper

`emwaver-firmware/build_android_asset.sh`:
- validates ARM toolchain,
- builds Release (unless `EMWAVER_SKIP_BUILD=1`),
- `objcopy` ELF -> BIN,
- copies BIN to Android DFU asset path (`android/app/src/main/assets/dfu/ir.dfu`).

## 9.3 Cross-platform bundle copier

`update_firmware_bins.sh`:
- input: built ELF (defaulting to current Release ELF),
- emits BIN and copies to:
  - `firmware/emwaver.bin` (canonical source for all platforms)
  - `windows/EMWaver/Assets/Firmware/emwaver.bin`
  - `apple/EMWaverAppleCore/Resources/Firmware/emwaver.bin`

---

## 10) Important implementation constraints

1. **Transport contract is strict**: fixed 64-byte USB transaction and fixed-size SysEx payload.
2. **Command lane size is fixed**: 18 bytes, so payload-heavy commands are constrained.
3. **Sampling/retransmit are ISR-sensitive**: avoid adding heavy logic in TIM3 path.
4. **TIM3 reserved for high-rate tick**: avoid repurposing TIM3 PWM routes in current architecture.
5. **PB6/PB7 are contested resources**: UART and I2C must be treated as mutually exclusive sessions.
6. **DFU entry is destructive**: `EMW_OP_ENTER_DFU` intentionally wipes app start pages.

---

## 11) Known drift / maintenance notes

- `stm/build_android_assets.sh` currently references legacy firmware subfolders (`emwaver-ism-firmware`, `emwaver-gpio-firmware`, etc.) that are not present in current tree.
  - Current active project is `stm/emwaver-firmware`.
  - Keep this script under review to prevent onboarding confusion.
- `emwaver-firmware/Release/makefile` contains a Windows linker script path artifact from IDE generation; treat generated files as build metadata, not hand-maintained source of truth.

---

## 12) Suggested documentation maintenance rule for this folder

When firmware behavior changes (new opcode, pin map change, timing/ISR behavior change, transport framing change), update in same PR:

1. `Core/Inc/emw_proto.h` (protocol constants),
2. `Core/Src/main.c` (implementation),
3. this `stm/README.md` sections 6/7/10.

That keeps host and firmware teams aligned on the real contract.
