# ESP32 Wi-Fi Remote Access

This note describes the supported remote access posture for ESP32 Wi-Fi transport.

EMWaver does not provide a hosted relay, cloud device registry, account gate, device ownership check, or subscription check for ESP32 Wi-Fi control. Remote access is a user-owned network path into the same LAN that the ESP32 already joined.

## Supported Shape

Use the ESP32 Wi-Fi transport when the host running EMWaver can route to the board's LAN address:

```text
EMWaver app/CLI/gateway
  -> local or VPN-routed network
  -> ws://<esp32-host-or-ip>:3922/v1/ws
  -> ESP32 authenticated Wi-Fi transport
```

Supported user-owned paths include:

- same-LAN Wi-Fi by mDNS hostname, such as `emwaver-a1b2.local`;
- same-LAN Wi-Fi by DHCP-reserved IP address;
- VPN by direct LAN IP when the VPN routes the ESP32 subnet;
- SSH tunnel or explicit port forwarding configured by the user.

mDNS often does not cross VPN boundaries. For VPN use, prefer a DHCP reservation or another stable LAN IP and connect manually by IP.

## Pairing

Wi-Fi control still requires the local pairing secret that was provisioned over USB or BLE. The pairing secret is not an EMWaver account credential and is not checked by a Continual MI backend.

If the pairing secret is lost or should be rotated:

1. Connect the ESP32 locally over USB or BLE.
2. Open the Wi-Fi setup surface in the native app.
3. Use `Reset Pairing` with a new local pairing secret.
4. Reconnect over Wi-Fi with the new secret.

Resetting pairing keeps the ESP32's existing SSID, password, and hostname. Clearing Wi-Fi setup removes the stored Wi-Fi setup and requires provisioning again.

## CLI Examples

Direct runtime over a same-LAN or VPN-routed IP:

```bash
emwaver run scripts/blink.emw --direct --wifi 192.168.1.44 --wifi-secret <local-secret>
```

Start the local daemon with a Wi-Fi ESP32 transport:

```bash
emwaver daemon start --wifi 192.168.1.44 --wifi-secret <local-secret>
```

Start the localhost gateway and let it launch the daemon fallback over Wi-Fi:

```bash
emwaver gateway --daemon-fallback --wifi 192.168.1.44 --wifi-secret <local-secret>
```

Diagnose a Wi-Fi endpoint:

```bash
emwaver doctor --wifi 192.168.1.44 --wifi-secret <local-secret>
```

## Troubleshooting

- `device not reachable`: check VPN route, LAN subnet access, board power, and firewall rules.
- `connection refused`: confirm the ESP32 is provisioned, online, and listening on port `3922`.
- `mDNS unavailable`: use direct IP; many VPNs do not route mDNS.
- `pairing secret rejected`: reset pairing locally over USB or BLE, then retry with the new secret.
- `device is busy`: close the other EMWaver app/daemon session connected to that ESP32.

Do not expose the ESP32 control port directly to the public internet as the default path. Use a private LAN, user-owned VPN, or SSH tunnel.
