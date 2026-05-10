# ESP32 Wi-Fi Remote Access

This note describes the supported remote access posture for ESP32 Wi-Fi transport.

EMWaver does not provide a hosted relay, cloud device registry, account gate, device ownership check, or subscription check for ESP32 Wi-Fi control. Remote access is a user-owned network path into the same LAN that the ESP32 already joined.

## Supported Shape

Use the ESP32 Wi-Fi transport when the host running EMWaver can route to the board's LAN address:

```text
EMWaver app/CLI/gateway
  -> local or VPN-routed network
  -> ws://<esp32-host-or-ip>:3922/v1/ws
  -> ESP32 Wi-Fi transport
```

Supported user-owned paths include:

- same-LAN Wi-Fi by mDNS hostname, such as `emwaver-a1b2.local`;
- same-LAN Wi-Fi by DHCP-reserved IP address;
- VPN by direct LAN IP when the VPN routes the ESP32 subnet;
- SSH tunnel or explicit port forwarding configured by the user.

mDNS often does not cross VPN boundaries. For VPN use, prefer a DHCP reservation or another stable LAN IP and connect manually by IP.

## Trust Boundary

Wi-Fi control uses LAN/VPN reachability as the trust boundary. If a client can reach the ESP32 WebSocket on the local network, it can control the board. Use this only on trusted private LANs, user-owned VPNs, or SSH-tunneled paths.

Wi-Fi setup sends only SSID and password over the current USB or BLE connection. The ESP32 firmware generates its own stable default hostname, such as `emwaver-a1b2`, and advertises `_emwaver._tcp` through mDNS while online. Clearing Wi-Fi setup removes the stored SSID/password and stops Wi-Fi service until provisioning runs again.

## CLI Examples

Direct runtime over a same-LAN or VPN-routed IP:

```bash
emwaver run assets/default-scripts/blink.emw --direct --wifi 192.168.1.44
```

Start the local daemon with a Wi-Fi ESP32 transport:

```bash
emwaver daemon start --wifi 192.168.1.44
```

Start the localhost gateway and let it launch the daemon fallback over Wi-Fi:

```bash
emwaver gateway --daemon-fallback --wifi 192.168.1.44
```

Diagnose a Wi-Fi endpoint:

```bash
emwaver doctor --wifi 192.168.1.44
```

## Troubleshooting

- `device not reachable`: check VPN route, LAN subnet access, board power, and firewall rules.
- `connection refused`: confirm the ESP32 is provisioned, online, and listening on port `3922`.
- `mDNS unavailable`: use direct IP; many VPNs do not route mDNS.
- `device is busy`: close the other EMWaver app/daemon session connected to that ESP32.

Do not expose the ESP32 control port directly to the public internet as the default path. Use a private LAN, user-owned VPN, or SSH tunnel.
