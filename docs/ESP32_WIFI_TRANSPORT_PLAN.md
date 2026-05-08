# ESP32 Wi-Fi Transport Plan

This plan defines the Wi-Fi transport path for ESP32-S3 class EMWaver boards.

The goal is to let an ESP32 board be controlled over a trusted local network, including through a user-owned VPN into that network, while preserving EMWaver's local-first product direction.

## Product Goal

Add a first-class ESP32 Wi-Fi transport that can run the same `.emw` hardware-control protocol used by USB and BLE.

Target user flow:

```text
User connects once over USB or BLE
  -> EMWaver sends Wi-Fi credentials and a local pairing secret
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
- Local pairing/authentication for the Wi-Fi control port.
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

Being on the LAN or VPN is useful but should not be the only control boundary.

Minimum Wi-Fi transport security:

- Require local pairing before accepting hardware-control commands.
- Store a per-device control secret in ESP32 NVS.
- Use session tokens or challenge-response to avoid accepting raw unauthenticated commands.
- Allow users to rotate/reset pairing from a physical/local recovery path.
- Bind privileged operations, such as credential reset or update mode, to a stronger local confirmation path where practical.

Preferred first security slice:

1. BLE or USB provisioning establishes a random device secret.
2. App/daemon stores the paired device record locally.
3. Wi-Fi session starts with a nonce challenge.
4. Client proves knowledge of the paired secret.
5. Firmware accepts command frames only after authentication.

Current implementation note:
- The first firmware/macOS slice uses a firmware-issued challenge plus HMAC-SHA256 over the local pairing secret. The raw pairing secret is not sent on the WebSocket, and firmware accepts command frames only after an `auth ok` state. Firmware closes pending unauthenticated sockets on auth-timeout task creation failure, failed challenge send, auth timeout, or auth failure so rejected clients cannot hold the active session slot.

TLS is desirable later, but authenticated sessions are the first hard requirement. Do not ship an unauthenticated Wi-Fi command socket.

## Same-Wi-Fi Setup Flow

The preferred first-run user experience is "connect once, then it appears automatically" when the host and ESP32 are on the same Wi-Fi.

Setup flow:

1. User connects the ESP32 to EMWaver over USB or BLE.
2. App asks for local Wi-Fi SSID/password.
3. App generates or confirms a per-device pairing secret.
4. App sends Wi-Fi credentials, device hostname, and pairing setup to firmware over USB/BLE.
5. ESP32 stores the setup in NVS flash.
6. ESP32 joins the Wi-Fi as a station.
7. ESP32 starts the authenticated WebSocket server on port `3922`.
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
  - device hostname,
  - pairing secret,
  - pairing/reset state.
- Add station-mode connection manager.
- Add reconnect/backoff behavior. Current firmware progress: reconnect scheduling now falls back to an immediate reconnect attempt if the reconnect task cannot be created, so the status flag does not remain stuck in a pending state.
- Add visible connection status over USB/BLE diagnostics. Current firmware progress: binary Wi-Fi status and text `wifi status` both expose provisioned/authenticated/station state, reconnecting state, runtime-active state, the last ESP-IDF station disconnect reason, and the current station IPv4 address when online; text `wifi status` also includes the advertised hostname for local setup debugging.

### Phase 2: Provisioning

- Add BLE provisioning flow for Wi-Fi credentials.
- Keep USB provisioning available for desktop recovery and development.
- Store provisioned Wi-Fi credentials and pairing state in ESP32 NVS flash.
- Generate or accept a stable local hostname used for mDNS advertisement.
- After successful provisioning, attempt station-mode Wi-Fi connection and report status over the provisioning transport.
- Support clearing Wi-Fi credentials from a local command.
- Support pairing reset through a local-only path. Current firmware/macOS progress: the binary Wi-Fi config lane has a pairing-reset opcode that rotates only the stored pairing secret and closes any active Wi-Fi session; staged binary Wi-Fi config operations require `BEGIN` and clear staged credentials after successful apply/reset or clear so stale local secrets are not reused. The macOS USB/BLE setup surface exposes pairing reset as `Reset Pairing`; macOS can update the matching local pairing record from either the provisioned hostname or the manual host/IP field.

### Phase 3: Runtime Transport

- Add WebSocket server on the ESP32 at `/v1/ws` on fixed port `3922`.
- Define a small transport envelope:
  - protocol version,
  - frame length,
  - frame kind,
  - sequence id,
  - payload bytes.
- Current firmware/macOS v1 shape: binary frames start with `EMW`, envelope version `1`, frame kind, little-endian sequence id, one reserved byte, little-endian payload length, then payload bytes. Frame kind `1` carries the existing 48-byte EMWaver SysEx packet. Enveloped command responses echo the request sequence id, and the macOS Wi-Fi command path waits for the matching response sequence before completing a synchronous command.
- Raw 48-byte SysEx WebSocket command frames remain a compatibility path only for clients that do not opt into envelope version `1` during authentication; once a session opts into the envelope, firmware requires enveloped command frames.
- Carry the existing EMWaver command payload inside the envelope.
- Add request/response correlation and timeout handling. The first macOS slice correlates synchronous command responses by echoed envelope sequence id and reports a Wi-Fi command timeout if no matching response arrives before the caller deadline.
- Add streaming support for sampler/retransmit status without blocking command responses. ESP32 firmware can now route sampler stream lanes over the Wi-Fi WebSocket for sessions that start sampling over Wi-Fi, ingest Wi-Fi retransmit stream lanes into the shared circular RX buffer, and send Wi-Fi `BS` buffer-status frames using sequence `0`; macOS and daemon command sequences start at `1`, skip reserved sequence `0` after wraparound, macOS and daemon stream-only retransmit frames use sequence `0`, ESP32 accepts incoming sequence-`0` envelopes only for stream-only frames, ESP32 rejects envelope command frames with reserved sequence `0`, Wi-Fi retransmit uses `BS` frames for host-side pacing, and the daemon ignores those sequence-`0` `BS` frames instead of appending them to captured script data.

### Phase 4: Discovery

- Advertise via mDNS when connected:
  - service type `_emwaver._tcp`,
  - fixed port `3922`,
  - board type,
  - firmware version,
  - transport capabilities,
  - user-visible device name.
- Keep manual IP connection as the fallback.
- Current firmware progress: mDNS is published only after the WebSocket server and `/v1/ws` handler are ready. If mDNS initialization, hostname setup, or service publication fails, firmware leaves the authenticated WebSocket online for manual IP/hostname connections and logs the discovery failure; incomplete TXT metadata is also logged.
- Current OTA coexistence progress: starting OTA SoftAP suspends the station-mode runtime WebSocket, mDNS advertisement, active Wi-Fi session state, and reconnect state before switching the radio into AP mode. If OTA SoftAP is stopped or fails to finish starting before the firmware reboots into an update, a provisioned board resumes station-mode Wi-Fi automatically.

### Phase 5: Validation

- Validate LAN control with blink, GPIO, ADC, SPI, PWM, and sampler flows.
- Validate disconnect/reconnect during idle and active sessions.
- Validate VPN access by direct LAN IP.
- Validate that unauthenticated clients cannot run commands.
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
emwaver run script.emw --direct --wifi 192.168.1.44 --wifi-secret <local-secret>
```

- Add gateway daemon fallback support, for example:

```bash
emwaver gateway --daemon-fallback --wifi 192.168.1.44 --wifi-secret <local-secret>
```

- Add doctor checks for:
  - missing route to device,
  - connection refused,
  - authentication failure,
  - mDNS unavailable,
  - paired secret mismatch.
- Current daemon progress: `emwaver devices` now performs best-effort `_emwaver._tcp` mDNS discovery and prints discovered ESP32 Wi-Fi endpoints with TXT board/firmware metadata; `emwaver devices --json` exposes the same inventory to the gateway. `emwaver devices --wifi <host-or-ip> --wifi-secret <local-secret>` can still manually probe a paired endpoint. Manual daemon Wi-Fi host input accepts bare IPv6 literals for routed LAN/VPN paths and brackets them only when constructing the WebSocket URL. The daemon Wi-Fi adapter filters sequence-`0` `BS` buffer-status frames out of the local capture buffer while keeping ordinary sequence-`0` stream lanes available to scripts.
- Current daemon progress: `emwaver doctor --wifi <host-or-ip> --wifi-secret <local-secret>` performs an authenticated Wi-Fi probe and classifies common route, connection-refused, mDNS/DNS, authentication, paired-secret, and device-busy failures.

### Gateway

- Display Wi-Fi devices in the local device list.
- Allow manual IP entry for VPN users.
- Show transport as `Wi-Fi` with LAN/VPN-neutral language.
- Keep gateway bound to localhost by default.
- Do not turn the gateway into a hosted relay.
- Current gateway progress: the browser runtime panel can start the local daemon with a manual ESP32 Wi-Fi host/IP, port, and pairing secret through `POST /v1/daemon/start`; the server validates the request and forwards `--wifi`, `--wifi-port`, and `--wifi-secret` to the CLI daemon start path. `GET /v1/devices` runs `emwaver devices --json`, and the panel can use a discovered Wi-Fi endpoint to fill the manual host/port fields before the user supplies the local pairing secret. When a daemon is connected, the panel displays the daemon's selected transport and best-effort `_emwaver._tcp` Wi-Fi discoveries from daemon `device.status`.

### Native Apps

- Add Wi-Fi device discovery and manual connection surfaces.
- Current macOS Wi-Fi device records normalize ESP32-S2, ESP32-S3, and generic ESP32 board metadata instead of assuming every Wi-Fi endpoint is ESP32-S3. Manual macOS host/IP entry accepts bare IPv6 literals for routed LAN/VPN paths and brackets them only when constructing the WebSocket URL, and local pairing persistence rejects malformed host strings before saving fallback records. macOS rejects discovered Wi-Fi records that do not advertise protocol `1` or a Wi-Fi capability, with capability matching kept tolerant of TXT-record case/whitespace differences. macOS update UI now also keeps ESP32/ESP32-S2/ESP32-S3 board metadata on the ESP serial-flashing path instead of falling through to STM32 DFU prompts.
- Current macOS validation: `xcodebuild build-for-testing -project macos/EMWaver/EMWaver.xcodeproj -scheme EMWaver -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO` compiles the Wi-Fi metadata, envelope, and host-validation tests. A targeted `xcodebuild test -only-testing` run for the new metadata tests was interrupted after hanging in the test runner, so it is not counted as a passing test result.
- Current macOS auto-connect progress: paired Wi-Fi endpoints are attempted automatically when no wired runtime is active, so a provisioned same-LAN board can reconnect without re-entering the pairing secret. macOS now always sends an effective local hostname during Wi-Fi setup, generating an `emwaver-...` fallback if needed, so same-LAN provisioning creates a matching local pairing record instead of relying on an unknown firmware-default hostname. The macOS setup status query displays the firmware-reported station IP when available for manual LAN/VPN fallback. The macOS device list also distinguishes paired Wi-Fi fallback records that are no longer advertising as `disconnected` instead of presenting them as fresh discoveries.
- Current Android/default-script progress: Android USB metadata inference distinguishes ESP32-S2, ESP32-S3, and generic ESP32 product/manufacturer strings, Android update UI keeps ESP boards out of the STM32 DFU flow without S3-only assumptions, and the bundled GPIO/ADC/PWM/blink/sampler/CC1101/I2C/UART examples treat ESP32-S2 as an ESP runtime target instead of falling back to STM32 pin defaults.
- Reuse existing script/device runtime paths.
- Add Wi-Fi provisioning from BLE/USB where platform APIs allow it.
- Show clear connection state:
  - not provisioned,
  - connecting,
  - online,
  - authenticated,
  - running,
  - disconnected.

## Protocol Decision

Use WebSocket for the first version.

Reasons:

- easy integration with gateway and browser-adjacent tooling,
- full-duplex command/status stream,
- debuggable with standard tools,
- friendly to future local dashboard surfaces.

Keep the payload binary-safe. Hardware command packets should use binary WebSocket frames rather than JSON command payloads. JSON can remain useful for hello/capability/auth messages, but hardware command frames should not be text-reencoded unless there is a clear reason.

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
  - paired secret rejected,
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
| Wrong pairing secret | Commands are rejected |
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
- Use local USB/BLE provisioning to store SSID/password/hostname plus a per-device pairing secret in ESP32 NVS and local app/daemon state; use firmware-issued challenge plus HMAC-SHA256 proof on the WebSocket, never the raw pairing secret.
- Use authenticated binary envelope version `1` for new clients while keeping raw 48-byte SysEx binary frames as a compatibility path during the transition; echo request sequence ids on command responses and match them in the macOS command path.
- Use USB and BLE provisioning where platform APIs allow it.
- Support multiple ESP32 boards on the same LAN by opening one WebSocket per selected endpoint; no per-device port allocation.
- Represent active ownership per ESP32 endpoint as one active authenticated WebSocket session. A second client receives a busy response instead of silently taking over the board.

## Implementation Order

1. Document protocol envelope and security handshake.
2. Add ESP32 station-mode connection manager behind a feature gate.
3. Add local Wi-Fi credential provisioning over BLE or USB.
4. Add authenticated Wi-Fi server carrying EMWaver frames.
5. Add Rust daemon Wi-Fi transport adapter. Current daemon progress: `emwaver-device` now has a reusable authenticated ESP32 Wi-Fi WebSocket transport adapter with HMAC auth, envelope version `1`, sequence-correlated command responses, local receive buffering, and filtering for sequence-`0` `BS` pacing frames so they do not pollute script capture data. CLI direct run, daemon serve/start, daemon fallback, and Linux service flag wiring now accept `--wifi <host-or-ip> --wifi-secret <local-secret>`.
6. Add `emwaver devices` and `emwaver run --direct --wifi`. Current daemon progress: direct Wi-Fi run is wired, `emwaver devices` performs best-effort `_emwaver._tcp` mDNS discovery, and `emwaver devices --wifi <host-or-ip> --wifi-secret <local-secret>` can manually probe a paired endpoint.
7. Add gateway device selection/manual IP path. Current gateway progress: manual Wi-Fi daemon start is wired from the browser runtime panel, gateway-side `emwaver devices --json` discovery can fill host/port from discovered endpoints, daemon-reported Wi-Fi discoveries appear in the runtime device list, and bare IPv6 literals are accepted by the daemon adapter; pairing still requires the user-owned local secret.
8. Add native app discovery/manual connect surfaces. Current macOS progress: manual connect, mDNS discovery, USB/BLE provisioning, status/clear recovery, and paired Wi-Fi auto-connect are wired.
9. Validate LAN script execution on real ESP32-S3 hardware. Tracked as `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` in `docs/TESTS.md`.
10. Validate VPN-by-IP execution. Tracked as `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` in `docs/TESTS.md`.
11. Add docs for user-owned VPN remote access. Current docs progress: `docs/ESP32_WIFI_REMOTE_ACCESS.md` covers same-LAN, VPN-by-IP, SSH/port-forwarding, pairing-secret rotation, CLI examples, and troubleshooting without introducing an EMWaver-hosted relay.

## Non-Negotiables

- No account gate for Wi-Fi hardware control.
- No cloud relay in the core path.
- No unauthenticated Wi-Fi command socket.
- No second ESP32-specific app protocol.
- No required user firmware build/flash loop.
- Keep USB/BLE recovery paths.
- Keep local scripts local by default.
