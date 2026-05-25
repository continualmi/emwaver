# ESP32 Wi-Fi Remote Access

This note describes the supported remote access posture for ESP32 Wi-Fi transport.

Wi-Fi-capable ESP32 boards can be controlled when the native EMWaver app can route to the board's LAN address. This supports same-LAN use and user-owned routed paths such as VPN, Tailscale, SSH tunnels, or explicit port forwarding.

## Supported Shape

```text
native EMWaver app
  -> local or VPN-routed network
  -> ws://<esp32-host-or-ip>:3922/v1/ws
  -> ESP32 Wi-Fi transport
```

Supported paths include:

- same-LAN Wi-Fi by mDNS hostname, such as `emwaver-a1b2.local`;
- same-LAN Wi-Fi by DHCP-reserved IP address;
- VPN/Tailscale by direct LAN IP when the private route reaches the ESP32 subnet;
- SSH tunnel or explicit port forwarding configured by the user.

mDNS often does not cross VPN boundaries. For routed remote use, prefer a DHCP reservation or another stable LAN IP and connect manually by IP.

## Trust Boundary

Wi-Fi control uses private-network reachability as the trust boundary. Use it on trusted LANs or user-owned routed paths. Do not expose the ESP32 control port directly to the public internet as the default path.

Wi-Fi setup sends SSID/password over an existing local setup transport such as USB or BLE. The ESP32 firmware advertises `_emwaver._tcp` through mDNS while online. Clearing Wi-Fi setup removes the stored SSID/password and stops Wi-Fi service until provisioning runs again.

## Native App Flow

1. Provision the ESP32 board's Wi-Fi credentials locally.
2. Let the app discover the board by mDNS, or enter host/IP and port manually.
3. Connect over Wi-Fi.
4. Run normal JavaScript scripts against the active Wi-Fi device.
5. If the board becomes unreachable, reconnect by mDNS/manual IP or recover through USB/BLE.

## Troubleshooting

- `device not reachable`: check LAN/VPN route, board power, subnet access, and firewall rules.
- `connection refused`: confirm the ESP32 is provisioned, online, and listening on port `3922`.
- `mDNS unavailable`: use direct IP; many VPNs do not route mDNS.
- `device is busy`: close the other EMWaver app session connected to that ESP32.
