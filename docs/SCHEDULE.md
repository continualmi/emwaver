# SCHEDULE

Short-term execution tracker.

## Current

- [ ] Agent-to-MCP migration — remove in-app Agent/MGPT surfaces, archive old Agent docs, add desktop MCP surfaces, and keep mobile as local script import/run.
- [ ] Documentation cleanup — make Linux-back/Windows-active/no-old-Agent/no-old-browser-daemon wording consistent across active docs and platform READMEs.
- [x] CC1101 validation — `cc1101.js` register read/write confirmed on iOS, Android, macOS, and Windows (2026-05-24).
- [ ] ESP32 Wi-Fi transport — run **013_ESP32_WIFI_LAN_SCRIPT_EXECUTION** on real ESP32-S3 hardware: provision over USB/BLE, verify same-LAN mDNS/direct-IP script execution from native apps, second-client busy handling, Wi-Fi drop recovery, USB/BLE recovery, and representative GPIO/ADC/SPI/PWM/sampler coverage.
- [ ] ESP32 Wi-Fi remote-by-IP — run **014_ESP32_WIFI_REMOTE_BY_IP_EXECUTION** on real ESP32-S3 hardware through a user-owned routed path such as VPN/Tailscale/SSH tunnel.
- [ ] Native Linux app — continue GTK4/libadwaita port and align it with the desktop MCP direction.
