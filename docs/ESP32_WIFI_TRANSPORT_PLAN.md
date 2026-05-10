# ESP32 Wi-Fi Transport Plan

This plan defines the Wi-Fi transport path for ESP32-S3 class EMWaver boards.

The goal is to let an ESP32 board be controlled over a trusted local network, including through a user-owned VPN into that network, while preserving EMWaver's local-first product direction.

Current completion evidence is tracked in `docs/ESP32_WIFI_TRANSPORT_AUDIT.md`.

## Product Goal

Add a first-class ESP32 Wi-Fi transport that can run the same `.emw` hardware-control protocol used by USB and BLE.

Target user flow:

```text
User connects once over USB or BLE
  -> EMWaver sends Wi-Fi SSID and password
  -> ESP32 stores the setup in NVS and joins the same Wi-Fi
  -> ESP32 advertises itself as an EMWaver network device on the LAN
  -> EMWaver desktop/mobile/daemon discovers and connects over Wi-Fi
  -> user runs .emw scripts without USB or BLE range limits
```

Remote power-user flow:

```text
User is away from home
  -> user connects to home VPN
  -> EMWaver reaches the ESP32 LAN IP or hostname
  -> scripts run over the Wi-Fi transport
```

This is not a Continual-hosted remote-control feature. No EMWaver account, cloud relay, cloud activation, device ownership check, or subscription check is required for local hardware access.

## Scope

In scope:

- ESP32 station-mode Wi-Fi transport.
- Wi-Fi provisioning through BLE or USB.
- LAN device discovery.
- Manual connect by IP or hostname.
- Same protocol semantics as USB/BLE.
- VPN-friendly remote access when the VPN exposes the ESP32's LAN subnet.
- App/daemon/gateway UI changes needed to select and connect Wi-Fi devices.

Out of scope for the first version:

- Continual-hosted relay.
- EMWaver cloud device registry.
- Account-backed device ownership.
- Cloud script sync.
- Fleet dashboard behavior.
- Public-internet ESP32 exposure as a supported default.
- Firmware customization by end users.

## Architecture

Wi-Fi should be a transport adapter, not a new device protocol.

```text
.emw runtime
  -> EMWaver command bridge
  -> shared packet codec
  -> Wi-Fi transport adapter
  -> TCP/WebSocket session
  -> ESP32 Wi-Fi server
  -> ESP32 EMWaver protocol layer
  -> ESP32 runtime/peripheral handlers
```

Protocol rule:

- Keep one EMWaver command model across USB, BLE, and Wi-Fi.
- Reuse the existing superframe/SysEx payload contract where practical.
- Put transport-specific framing only at the transport edge.
- Keep OTA/update behavior separate from steady-state runtime control.

## Recommended Network Shape

The first implementation should assume the ESP32 is a Wi-Fi station on the user's LAN.

Default v1 network contract:

- Control port: `3922`.
- Service type: `_emwaver._tcp`.
- WebSocket path: `/v1/ws`.
- Connection URL: `ws://<hostname-or-ip>:3922/v1/ws`.
- Hardware command payloads: binary WebSocket frames carrying the existing EMWaver SysEx/superframe payload.

Preferred connection options:

1. mDNS hostname, for example `emwaver-xxxx.local`.
2. DHCP-reserved LAN IP.
3. Manual IP entry in app/CLI/gateway.

Multiple ESP32 boards should use the same control port. The host distinguishes boards by mDNS service instance, hostname/IP endpoint, local paired-device record, and known local hardware UID when available. A bench with several boards should look like:

```text
emwaver-a1b2.local:3922
emwaver-c3d4.local:3922
192.168.1.41:3922
192.168.1.42:3922
```

The host opens one WebSocket session per selected device. No dynamic port allocation is needed for normal physical ESP32 boards because each board owns its own network address.

VPN behavior:

- If the user connects to a VPN that routes the home LAN subnet, EMWaver can connect to the ESP32 by LAN IP.
- mDNS may not cross VPN boundaries, so direct IP must be supported.
- Tailscale, WireGuard, OpenVPN, router VPN, SSH tunnels, and similar user-owned paths are acceptable.
- EMWaver should document that VPN routing and firewall behavior are user/network responsibilities.

## Security Model

LAN/VPN reachability is the control boundary for the current Wi-Fi transport. If a client can reach the ESP32 WebSocket on the local network, it can control the board.

Current implementation note:
- Firmware accepts the same raw 48-byte EMWaver SysEx frames used by USB/BLE immediately after WebSocket open and still rejects concurrent clients as busy.

TLS or stronger local authorization can be revisited later, but the current runtime model is trusted private network access: do not expose the control socket to the public internet.

## Same-Wi-Fi Setup Flow

The preferred first-run user experience is "connect once, then it appears automatically" when the host and ESP32 are on the same Wi-Fi.

Setup flow:

1. User connects the ESP32 to EMWaver over USB or BLE.
2. App asks for local Wi-Fi SSID/password.
3. App sends SSID and password only.
4. Firmware generates and owns the stable default hostname.
5. ESP32 stores the setup in NVS flash.
6. ESP32 joins the Wi-Fi as a station.
7. ESP32 starts the WebSocket server on port `3922`.
8. ESP32 advertises `_emwaver._tcp` with mDNS.
9. App discovers the device and connects to `ws://<device>.local:3922/v1/ws`.

Required mDNS advertisement:

- Service type: `_emwaver._tcp`.
- Port: `3922`.
- Instance name: user-visible EMWaver device name, for example `EMWaver ESP32-S3 A1B2`.
- Current firmware uses target-aware instance names from the ESP-IDF target, for example `EMWaver ESP32-S3 A1B2` or `EMWaver ESP32-S2 A1B2`.
- TXT records should include protocol version, board type, firmware version, transport capabilities, and a non-authoritative local identifier suffix for display/deduplication.

Manual IP/hostname entry remains required as a fallback for networks where mDNS is blocked or does not cross routed VPN/subnet boundaries. Manual entry should not be the default same-Wi-Fi path.

## Firmware Work

### Phase 1: Foundation

- Add compile-time Wi-Fi transport feature gate. Current firmware progress: `main/Kconfig.projbuild` defines `CONFIG_EMWAVER_ENABLE_WIFI_TRANSPORT`, which maps to `EMWAVER_ENABLE_WIFI_TRANSPORT` in the Wi-Fi transport source and defaults on for ESP targets; isolated ESP32-S2 `libmain.a` validation passes with the shared Wi-Fi transport source.
- Add NVS storage for:
  - Wi-Fi SSID and credential metadata,
  - firmware-generated device hostname.
- Add station-mode connection manager.
- Add reconnect/backoff behavior. Current firmware progress: reconnect scheduling now falls back to an immediate reconnect attempt if the reconnect task cannot be created, so the status flag does not remain stuck in a pending state.
- Add visible connection status over USB/BLE diagnostics. Current firmware progress: binary Wi-Fi status and text `wifi status` both expose provisioned/socket/station state, reconnecting state, runtime-active state, the last ESP-IDF station disconnect reason, and the current station IPv4 address when online; text `wifi status` also includes the advertised hostname for local setup debugging.

### Phase 2: Provisioning

- Add BLE provisioning flow for Wi-Fi credentials.
- Keep USB provisioning available for desktop recovery and development.
- Store provisioned Wi-Fi credentials in ESP32 NVS flash.
- Generate a stable local hostname used for mDNS advertisement.
- After successful provisioning, attempt station-mode Wi-Fi connection and report status over the provisioning transport.
- Support clearing Wi-Fi credentials from a local command.
- Pairing reset has been removed; clearing Wi-Fi setup erases SSID/password and requires provisioning again.

### Phase 3: Runtime Transport

- Add WebSocket server on the ESP32 at `/v1/ws` on fixed port `3922`.
- Use binary WebSocket frames that carry the existing 48-byte EMWaver SysEx packet directly.
- Keep the same command/response and stream-lane semantics used by USB MIDI and BLE; Wi-Fi only changes the transport pipe.
- Add command timeout handling in the app/daemon. Command responses are ordinary EMWaver command-lane responses, not Wi-Fi-specific frame types.
- Add streaming support for sampler/retransmit status. ESP32 firmware can route sampler stream lanes over the Wi-Fi WebSocket for sessions that start sampling over Wi-Fi, ingest Wi-Fi retransmit stream lanes into the shared circular RX buffer, and send Wi-Fi `BS` buffer-status frames for host-side pacing.

### Phase 4: Discovery

- Advertise via mDNS when connected:
  - service type `_emwaver._tcp`,
  - fixed port `3922`,
  - board type,
  - firmware version,
  - transport capabilities,
  - user-visible device name.
- Keep manual IP connection as the fallback.
- Current firmware progress: mDNS is published only after the WebSocket server and `/v1/ws` handler are ready. If mDNS initialization, hostname setup, or service publication fails, firmware leaves the WebSocket online for manual IP/hostname connections and logs the discovery failure; incomplete TXT metadata is also logged.
- Current OTA coexistence progress: starting OTA SoftAP suspends the station-mode runtime WebSocket, mDNS advertisement, active Wi-Fi session state, and reconnect state before switching the radio into AP mode. If OTA SoftAP is stopped or fails to finish starting before the firmware reboots into an update, a provisioned board resumes station-mode Wi-Fi automatically.

### Phase 5: Validation

- Validate LAN control with blink, GPIO, ADC, SPI, PWM, and sampler flows.
- Validate disconnect/reconnect during idle and active sessions.
- Validate VPN access by direct LAN IP.
- Validate that a reachable trusted-LAN client can run commands without a Wi-Fi auth step.
- Validate recovery when Wi-Fi credentials are wrong.
- Current compile validation: ESP32-S3 `idf.py -B build-esp32s3-check esp-idf/main/libmain.a` and isolated ESP32-S2 `idf.py -B /tmp/emwaver-s2-wifi-check -DSDKCONFIG=/tmp/emwaver-s2-wifi-sdkconfig set-target esp32s2 esp-idf/main/libmain.a` both pass for the shared Wi-Fi transport source. Remaining gaps require real hardware LAN/VPN script execution.

## Host/App Work

### Shared Device Layer

- Add `wifi` as a transport kind beside USB MIDI/SysEx and BLE.
- Add network device records:
  - stable id,
  - hostname,
  - IP address,
  - fixed control port,
  - board type,
  - firmware version,
  - paired/unpaired state,
  - last seen time.
- Add manual connect by IP/port.
- Add paired-device storage in local app/daemon state.
- Support multiple Wi-Fi devices by keeping one network session per selected endpoint/device record.

### CLI/Daemon

- Add Wi-Fi discovery command output to `emwaver devices`.
- Add direct run support, for example:

```bash
emwaver run script.emw --direct --wifi 192.168.1.44
```

- Add gateway daemon fallback support, for example:

```bash
emwaver gateway --daemon-fallback --wifi 192.168.1.44
```

- Add doctor checks for:
  - missing route to device,
  - connection refused,
  - mDNS unavailable,
  - reachable/busy/connection failed.
- Current daemon progress: `emwaver devices` performs best-effort `_emwaver._tcp` mDNS discovery and prints discovered ESP32 Wi-Fi endpoints with TXT board/firmware metadata; `emwaver devices --json` exposes the same inventory to the gateway. The daemon Wi-Fi runtime adapter still needs the same raw-SysEx simplification now applied to macOS and firmware.
- Current daemon progress: `emwaver doctor --wifi <host-or-ip>` probes Wi-Fi reachability and classifies common route, connection-refused, mDNS/DNS, and device-busy failures.

### Gateway

- Display Wi-Fi devices in the local device list.
- Allow manual IP entry for VPN users.
- Show transport as `Wi-Fi` with LAN/VPN-neutral language.
- Keep gateway bound to localhost by default.
- Do not turn the gateway into a hosted relay.
- Current gateway progress: the browser runtime panel can start the local daemon with a manual ESP32 Wi-Fi host/IP and port through `POST /v1/daemon/start`; the server validates the request and forwards `--wifi`, `--wifi-port`, to the CLI daemon start path. `GET /v1/devices` runs `emwaver devices --json`, and the panel can use a discovered Wi-Fi endpoint to fill the manual host/port fields. When a daemon is connected, the panel displays the daemon's selected transport and best-effort `_emwaver._tcp` Wi-Fi discoveries from daemon `device.status`.

### Native Apps

- Add Wi-Fi device discovery and manual connection surfaces.
- Current macOS Wi-Fi device records normalize ESP32-S2, ESP32-S3, and generic ESP32 board metadata instead of assuming every Wi-Fi endpoint is ESP32-S3. Manual macOS host/IP entry accepts bare IPv6 literals for routed LAN/VPN paths and brackets them only when constructing the WebSocket URL, and local pairing persistence rejects malformed host strings before saving fallback records. macOS rejects discovered Wi-Fi records that do not advertise protocol `1` or a Wi-Fi capability, with capability matching kept tolerant of TXT-record case/whitespace differences. macOS update UI now also keeps ESP32/ESP32-S2/ESP32-S3 board metadata on the ESP serial-flashing path instead of falling through to STM32 DFU prompts.
- Current macOS validation: `xcodebuild build-for-testing -project macos/EMWaver/EMWaver.xcodeproj -scheme EMWaver -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO` compiles the Wi-Fi metadata, SysEx, and host-validation tests. A targeted `xcodebuild test -only-testing` run for the new metadata tests was interrupted after hanging in the test runner, so it is not counted as a passing test result.
- Current macOS auto-connect progress: advertised Wi-Fi endpoints are attempted automatically when no wired runtime is active, so a provisioned same-LAN board can reconnect. macOS sends only SSID/password during Wi-Fi setup. The ESP32 owns its default hostname and advertises it through mDNS; macOS displays firmware-reported station IP when available for manual LAN/VPN fallback.
- Current Android/default-script progress: Android USB metadata inference distinguishes ESP32-S2, ESP32-S3, and generic ESP32 product/manufacturer strings, Android update UI keeps ESP boards out of the STM32 DFU flow without S3-only assumptions, and the bundled GPIO/ADC/PWM/blink/sampler/CC1101/I2C/UART examples treat ESP32-S2 as an ESP runtime target instead of falling back to STM32 pin defaults.
- Reuse existing script/device runtime paths.
- Add Wi-Fi provisioning from BLE/USB where platform APIs allow it.
- Show clear connection state:
  - not provisioned,
  - connecting,
  - online,
  - running,
  - disconnected.

## Protocol Decision

Use WebSocket for the first version.

Reasons:

- easy integration with gateway and browser-adjacent tooling,
- full-duplex command/status stream,
- debuggable with standard tools,
- friendly to future local dashboard surfaces.

Keep the payload binary-safe. Hardware command packets use binary WebSocket frames carrying the same SysEx bytes as USB/BLE rather than JSON command payloads.

## UX Requirements

- User never needs to build or flash firmware manually.
- Local USB/BLE setup and recovery remain available.
- Wi-Fi setup should feel like "put this board on my network", not "configure a server".
- Same-Wi-Fi devices should appear automatically after one successful USB/BLE provisioning.
- Users should not need to understand or choose ports for normal multi-device use.
- Direct IP entry must exist because VPN mDNS is unreliable.
- Error messages should distinguish:
  - device not reachable,
  - device reachable but not paired,
  - device busy,
  - firmware does not support Wi-Fi transport,
  - device is busy with another session.

## Testing Matrix

Minimum validation:

| Case | Expected result |
| --- | --- |
| USB provisioning | ESP32 stores Wi-Fi credentials in NVS and reconnects after reboot |
| BLE provisioning | ESP32 stores Wi-Fi credentials in NVS and reconnects after reboot |
| Same LAN by IP | CLI/app can run blink script |
| Same LAN by mDNS | CLI/app can discover and run script |
| Multiple same-LAN boards | CLI/app can discover multiple ESP32 boards using port `3922` and connect independently |
| VPN by IP | CLI/app can run blink script through routed home subnet |
| VPN without mDNS | Manual IP still works |
| Second simultaneous client | Receives `busy` |
| No pairing | Commands are rejected |
| Wi-Fi drop during script | Runtime reports disconnect and recovers cleanly |
| USB recovery after bad Wi-Fi config | User can clear/reprovision Wi-Fi |
| BLE remains available | Nearby direct workflows still work |
| OTA remains separate | Runtime command port does not become update control by accident; current firmware suspends the station-mode WebSocket/mDNS runtime before starting OTA SoftAP |

Hardware validation should include:

- GPIO blink.
- ADC read.
- SPI module readback.
- PWM/servo output.
- Sampler start/stop.
- Retransmit flow-control status.

## Open Decisions

- Whether device-to-host outbound mode is useful later for stricter firewall environments. Deferred for v1 because the local-first LAN/VPN/SSH model already gives users a controllable remote path without introducing a hosted relay.

Resolved v1 decisions:

- Use fixed control port `3922`.
- Advertise service type `_emwaver._tcp`.
- Use WebSocket at `/v1/ws`.
- Use local USB/BLE provisioning to store SSID/password in ESP32 NVS; firmware owns the hostname and Wi-Fi command control trusts LAN/VPN reachability.
- Use raw 48-byte EMWaver SysEx binary WebSocket frames. Wi-Fi does not define a separate envelope or sequence layer.
- Use USB and BLE provisioning where platform APIs allow it.
- Support multiple ESP32 boards on the same LAN by opening one WebSocket per selected endpoint; no per-device port allocation.
- Represent active ownership per ESP32 endpoint as one active WebSocket session. A second client receives a busy response instead of silently taking over the board.

## Implementation Order

1. Document the LAN-trust transport binding.
2. Add ESP32 station-mode connection manager behind a feature gate.
3. Add local Wi-Fi credential provisioning over BLE or USB.
4. Add LAN-trust Wi-Fi server carrying EMWaver frames.
5. Add Rust daemon Wi-Fi transport adapter. Current daemon progress: CLI direct run, daemon serve/start, daemon fallback, and Linux service flag wiring accept `--wifi <host-or-ip>`, but the daemon adapter still needs to be updated to the raw-SysEx WebSocket transport shape.
6. Add `emwaver devices` and `emwaver run --direct --wifi`. Current daemon progress: direct Wi-Fi run is wired, `emwaver devices` performs best-effort `_emwaver._tcp` mDNS discovery, and `emwaver devices --wifi <host-or-ip>` can manually probe a paired endpoint.
7. Add gateway device selection/manual IP path. Current gateway progress: manual Wi-Fi daemon start is wired from the browser runtime panel, gateway-side `emwaver devices --json` discovery can fill host/port from discovered endpoints, daemon-reported Wi-Fi discoveries appear in the runtime device list, and bare IPv6 literals are accepted by the daemon adapter; Wi-Fi control uses LAN/VPN reachability as the trust boundary.
8. Add native app discovery/manual connect surfaces. Current macOS progress: manual connect, mDNS discovery, USB/BLE provisioning, status/clear recovery, and paired Wi-Fi auto-connect are wired.
9. Validate LAN script execution on real ESP32-S3 hardware. Tracked as `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` in `docs/TESTS.md`.
10. Validate VPN-by-IP execution. Tracked as `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` in `docs/TESTS.md`.
11. Add docs for user-owned VPN remote access. Current docs progress: `docs/ESP32_WIFI_REMOTE_ACCESS.md` covers same-LAN, VPN-by-IP, SSH/port-forwarding, CLI examples, and troubleshooting without introducing an EMWaver-hosted relay.

## Non-Negotiables

- No account gate for Wi-Fi hardware control.
- No cloud relay in the core path.
- Do not expose the LAN-trust Wi-Fi command socket to the public internet.
- No second ESP32-specific app protocol.
- No required user firmware build/flash loop.
- Keep USB/BLE recovery paths.
- Keep local scripts local by default.
