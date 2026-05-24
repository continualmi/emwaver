# SCHEDULE

Short-term execution tracker.

## Current

- [ ] Documentation cleanup — finish clearing stale Gateway/CLI, separate `.jsx`, UI snapshot, and outdated platform-status wording from active docs and website pages.
- [ ] CC1101 validation — add concise evidence for `cc1101.js` register read/write pass on iOS, Android, macOS, and Windows to `docs/TESTS.md`.
- [ ] ESP32 Wi-Fi transport — run **013_ESP32_WIFI_LAN_SCRIPT_EXECUTION** on real ESP32-S3 hardware: provision over USB/BLE, verify same-LAN mDNS/direct-IP script execution from native apps, second-client busy handling, Wi-Fi drop recovery, USB/BLE recovery, and representative GPIO/ADC/SPI/PWM/sampler coverage.
- [ ] ESP32 Wi-Fi remote-by-IP — run **014_ESP32_WIFI_REMOTE_BY_IP_EXECUTION** on real ESP32-S3 hardware through a user-owned routed path such as VPN/Tailscale/SSH tunnel.
- [ ] Native Linux app — continue GTK4/libadwaita port without reintroducing Gateway/browser/CLI control paths.
