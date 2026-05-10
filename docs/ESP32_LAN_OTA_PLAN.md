# ESP32 LAN OTA Plan

This plan defines the direction for replacing ESP32 SoftAP-first OTA with an authenticated LAN/VPN OTA flow that matches EMWaver's station-mode Wi-Fi transport model.

## Objective

Implement ESP32 firmware update over the same user-owned network posture as ESP32 Wi-Fi runtime control:

```text
EMWaver app/CLI/gateway
  -> same LAN or user-owned routed private network
  -> provisioned ESP32 station-mode Wi-Fi endpoint
  -> authenticated LAN OTA update session
```

LAN OTA should work when the ESP32 is already provisioned onto a local Wi-Fi network and the controller can route to it by mDNS hostname or private IP address. This includes same-LAN use and user-owned private routed paths such as VPN, Tailscale subnet routing, SSH tunneling, or explicit port forwarding around the user's own network.

The firmware update path must remain local-first:

- no EMWaver account,
- no hosted relay,
- no cloud device registry,
- no backend activation,
- no subscription or ownership check for local firmware updates,
- no requirement that end users install ESP-IDF or build firmware manually.

## Product Direction

The current ESP32 Wi-Fi OTA shape is SoftAP-oriented: firmware can suspend station-mode runtime, start an `EMWaver-OTA` access point, and accept an HTTP upload at `192.168.4.1`. That is not the desired product path.

The desired path is station-mode LAN OTA:

1. The ESP32 joins the user's Wi-Fi using the existing provisioning flow over USB or BLE.
2. The app, CLI, daemon, or gateway discovers the ESP32 by `_emwaver._tcp` or connects by private IP.
3. The OTA authorization model must be redesigned for the LAN-trust runtime; do not assume a local Wi-Fi authorization exists.
4. The client requests update-exclusive mode.
5. Firmware stops or rejects script/runtime activity during the update.
6. The client uploads the managed ESP32 app image over LAN.
7. Firmware writes the next OTA partition, verifies the image, sets the boot partition, and reboots.
8. The client waits for the device to return and verifies the updated firmware can run scripts again.

Serial flashing remains the recovery, first-install, and unbrick path. LAN OTA is an update convenience for boards that are already running EMWaver firmware and are reachable on a user-owned network.

## Non-Goals

- Do not make SoftAP OTA the primary user-facing ESP32 update path.
- Do not expose OTA through a Continual MI hosted relay or cloud dashboard.
- Do not add EMWaver accounts, cloud activation, device claiming, device limits, or subscription checks.
- Do not require public internet exposure of the ESP32 update endpoint.
- Do not require users to install ESP-IDF, run `idf.py`, or manually build firmware.
- Do not merge firmware update semantics into normal script execution; OTA remains update-exclusive.

## Firmware Plan

Add a station-mode OTA service that is available only after Wi-Fi provisioning and a future OTA-specific authorization check.

Required firmware behavior:

- Reuse the existing station-mode Wi-Fi configuration, mDNS identity, and board metadata.
- Authenticate OTA clients using a new OTA-specific authorization model.
- Accept OTA only from authorized clients.
- Enter update-exclusive mode before accepting firmware bytes.
- Suspend or close the runtime WebSocket while OTA is active.
- Reject OTA start if sampler, retransmit, or another runtime operation is active, unless the client first stops that work through the normal runtime path.
- Receive the managed ESP32 app image in bounded chunks.
- Verify the uploaded image at minimum with SHA-256 before committing it.
- Prefer signed-image verification before launch-grade release.
- Write to the next OTA partition with ESP-IDF OTA APIs.
- Set the boot partition only after full write and verification succeed.
- Reboot after successful commit.
- Abort cleanly on upload failure, authorization failure, size mismatch, hash mismatch, timeout, or disconnect before commit.
- Preserve serial flashing as recovery when LAN OTA fails.

The current SoftAP OTA implementation may remain temporarily as legacy/developer code, but it should not be presented as the product update path. Once LAN OTA is implemented and validated, SoftAP OTA should either be removed or hidden behind an explicit developer-only build flag.

## Client Plan

Implement client support in this order:

1. macOS native app.
2. CLI/daemon.
3. Gateway UI through daemon/native app control.
4. Windows parity.
5. Mobile parity where platform transport constraints allow it.

macOS behavior:

- Show LAN OTA only for ESP32 devices connected over Wi-Fi.
- Use mDNS-discovered endpoint metadata or a manually entered private IP endpoint.
- Do not rely on a removed Keychain Wi-Fi secret.
- Keep ESP serial flashing visible as the fallback/recovery path.
- During LAN OTA, show update-exclusive status, progress, verification, reboot, reconnect, and final firmware/runtime verification.
- If LAN OTA fails before commit, keep the user on the same screen with serial flashing guidance available.

CLI/daemon behavior:

- Add a direct LAN OTA command that accepts host/IP, port if needed, host/IP, port if needed, and firmware image path.
- Support mDNS-discovered endpoints and manual private IP endpoints.
- Reject attempts that do not satisfy the future OTA authorization model.
- Print clear progress and final reconnect/verification status.
- Keep the command local-only and account-free.

Gateway behavior:

- Use the daemon or native app as the update executor.
- Do not upload firmware through a hosted service.
- Do not require browser cloud identity for local LAN OTA.

## Security And Trust Model

LAN OTA uses local device trust, not backend ownership.

Required rules:

- The OTA authorization design is unresolved after removing the Wi-Fi pairing flow.
- Unauthorized OTA attempts must be rejected before upload.
- OTA should not be advertised as safe for direct public internet exposure.
- The preferred remote posture is same LAN, VPN, Tailscale/private routing, SSH tunnel, or user-owned port forwarding.
- Future signed firmware verification should be planned before treating OTA as hardened for broad release.

## Validation Plan

Add a manual hardware test later as `010_ESP32_LAN_OTA_UPDATE`.

Required scenarios:

- Same-LAN mDNS OTA update succeeds.
- Same-LAN manual private IP OTA update succeeds.
- VPN/private-routed IP OTA update succeeds.
- Unauthorized OTA attempts are rejected before upload.
- OTA is rejected while a script/runtime operation is active, or the client stops the runtime before entering update mode.
- Interrupted upload does not switch boot partition.
- Hash mismatch does not switch boot partition.
- Successful OTA reboots into the new image.
- After reboot, the board returns to station-mode Wi-Fi and can run `blink.emw` over Wi-Fi.
- Serial flashing can recover a board after a failed or interrupted LAN OTA attempt.

Evidence to record:

- ESP32 board model and target (`esp32s2` or `esp32s3`).
- Firmware commit or bundle version before update.
- Firmware commit or bundle version after update.
- Provisioning transport used.
- Network shape: same LAN, manual private IP, or VPN/private route.
- mDNS hostname and/or private IP.
- Exact app/CLI command or UI flow used.
- Authorization rejection results for unauthorized attempts.
- Failure-mode result for interrupted upload or hash mismatch.
- Post-update script execution result.
- Serial recovery result if tested.
- Date and tester.

## Documentation Follow-Up

When implementation begins, update these docs in the same PR as the relevant code changes:

- `docs/ESP32_WIFI_TRANSPORT_PLAN.md`: replace SoftAP coexistence language with LAN OTA direction.
- `docs/ESP32_WIFI_TRANSPORT_AUDIT.md`: remove SoftAP OTA as a completion item and add LAN OTA audit evidence.
- `docs/ESP32_WIFI_REMOTE_ACCESS.md`: mention LAN OTA follows the same user-owned LAN/VPN posture.
- `docs/TESTS.md`: add `010_ESP32_LAN_OTA_UPDATE`.
- `esp/README.md`: describe station-mode LAN OTA as the target update path and SoftAP OTA as legacy/developer-only if it remains.
- `macos/README.md`: document LAN OTA once macOS implements it.
