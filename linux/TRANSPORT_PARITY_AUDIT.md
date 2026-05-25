# Linux Transport Parity Audit

Last updated: 2026-05-24

Reference order for this audit:
1. macOS native app (`macos/EMWaver/EMWaver/MacUSBManager.swift` + shared Apple transport/runtime code)
2. Android native app (`android/app/src/main/java/com/emwaver/emwaverandroidapp/*`)
3. Windows native app (`windows/EMWaver/*`)
4. Linux GTK app (`linux/crates/*`)

This document tracks Linux transport/runtime differences that can affect local hardware scripts. Simulator behavior is excluded from user-facing parity; it remains internal test infrastructure only.

## BLE packet framing

### Reference behavior
- macOS encodes every 36-byte superframe as one EMWaver SysEx frame before BLE write.
- Android encodes every 36-byte superframe as one EMWaver SysEx frame before BLE write.
- Windows explicitly documents the firmware contract: ESP32 firmware expects one complete 48-byte SysEx superframe per GATT write.
- macOS/Android notification handlers accumulate `F0 ... F7` bytes before decoding a SysEx frame.

### Linux status
- Fixed: Linux BLE TX now encodes 36-byte superframes into 48-byte EMWaver SysEx frames.
- Fixed: Linux BLE RX now accumulates chunked notifications before decoding.
- Fixed: Linux BLE command writes now use write-with-response semantics, matching Android/Windows and avoiding partial command writes.

## BLE notification decode errors

### Reference behavior
- macOS ignores incomplete/non-EMWaver SysEx candidates and only stores lanes after a valid decoded superframe.
- Android `DeviceBufferSession.feedSysexBytes` accumulates bytes until `0xF7`; invalid decoded frames are ignored rather than returned as command failures.

### Linux status
- Fixed: Linux no longer returns `BLE SysEx decode failed: SysEx frame must be exactly 48 bytes` as the command result for partial notification chunks.
- Linux still needs real-device logging if BlueZ delivers unexpected notification payloads after this pass.

## Transport session commands

### Reference behavior
- macOS calls transport session CONNECT before script/device primitive use on BLE/Wi-Fi, then sends DISCONNECT at the end.
- macOS starts a heartbeat every 2 seconds while the transport session is claimed.
- Android does the same with opcode `0x0B`:
  - CONNECT: `[0x0B, 0x01, source]`
  - DISCONNECT: `[0x0B, 0x02, source]`
  - HEARTBEAT: `[0x0B, 0x03, source]`
  - source BLE: `0x02`
  - source Wi-Fi: `0x03`
- Windows also has transport session lifecycle support.

### Linux status
- Fixed in this pass: Linux script packet sessions now send transport session CONNECT before the first BLE/Wi-Fi script packet.
- Fixed in this pass: Linux sends DISCONNECT when the script packet bridge is dropped.
- Fixed in this pass: Linux sends a heartbeat before script packet commands when the last heartbeat is older than 2 seconds.
- Difference remaining: macOS/Android run a true background heartbeat timer; Linux currently heartbeats opportunistically before packet commands. If a script holds a BLE/Wi-Fi session idle for longer than the firmware timeout, Linux may still need a real background heartbeat worker.

## Command lane / response lane behavior

### Reference behavior
- All native platforms send commands in the first 18-byte lane of a 36-byte superframe.
- Responses are read from the first 18-byte lane.
- Empty stream lanes are ignored unless sampler streaming is active.

### Linux status
- Linux command send path pads command data into the first 18-byte lane and returns the first 18-byte response lane.
- Linux packet logging now shows TX/RX opcode and bytes in Run Log.

## BLE GATT discovery/subscription order

### Reference behavior
- macOS connects, discovers service/characteristics, enables notifications, then writes commands.
- Android requests MTU 64, discovers services, enables notifications, then considers the connection active.
- Windows discovers service/characteristics uncached, enables notifications, then writes commands.

### Linux status
- Linux connects, discovers services, obtains notification stream, subscribes, then writes commands.
- Difference remaining: btleplug/BlueZ does not expose the same Android-style explicit MTU request path here. If Linux still receives fragmented notifications, the accumulator handles them.

## BLE write type

### Reference behavior
- Android uses `WRITE_TYPE_DEFAULT` (write-with-response).
- Windows uses `GattWriteOption.WriteWithResponse`.
- macOS selects `.withoutResponse` only if the characteristic advertises it, otherwise `.withResponse`.

### Linux status
- Fixed in this pass: Linux uses `WriteType::WithResponse` for BLE command writes. This matches Android/Windows, the known-working BLE paths, and the Windows firmware contract comment.

## Wi-Fi transport

### Reference behavior
- macOS sends/receives EMWaver SysEx frames over WebSocket.
- Android sends/receives EMWaver SysEx frames over WebSocket.

### Linux status
- Linux sends/receives EMWaver SysEx frames over WebSocket.
- Linux now applies transport session CONNECT/DISCONNECT/heartbeat to Wi-Fi script packet sessions too.

## USB MIDI transport

### Reference behavior
- macOS, Android, and Windows use the same SysEx/superframe command lane model.
- ESP32-class USB transports may require transport session ownership; STM32 USB does not.

### Linux status
- Linux USB MIDI uses the same fixed SysEx/superframe envelope.
- Difference remaining: Linux `DeviceRecord` currently does not carry board type, so script packet bridge only starts transport sessions for BLE/Wi-Fi. If ESP32 USB scripts require session ownership on Linux, device records need board-type propagation and USB session connect support.

## Device identity/board metadata

### Reference behavior
- macOS tracks board type by device ID and can infer BLE as `esp32s3`.
- Android tracks connected board type and active transport.
- Windows discovered BLE board type is `esp32s3`.

### Linux status
- Difference remaining: `DeviceRecord` has no board type field. This makes Linux less able to mirror macOS decisions like "ESP32 USB requires transport session".

## Run Log parity

### Reference behavior
- macOS/Windows expose transport packet activity in logs useful for debugging TX/RX/timeouts.

### Linux status
- Linux logs CONNECT/CONNECTED, transport session CONNECT, TX/RX, ERR, TIMEOUT, and disconnect lifecycle indirectly through session teardown.
- Difference remaining: Linux should add optional raw BLE notification length/hex debug logging behind a developer/debug flag if real hardware still fails after parity fixes.

## Current highest-risk Linux-only differences

1. No true background heartbeat worker yet; Linux heartbeat is command-driven.
2. No board-type metadata in `DeviceRecord`; ESP32 USB session requirements cannot be mirrored exactly.
3. No explicit BlueZ MTU negotiation API in the current btleplug path.
4. Need real BLE retest after transport session CONNECT + write-with-response + accumulator fixes.
