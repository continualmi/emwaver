# SCHEDULE

## Week of 2026-05-04 -> 2026-05-10

- [ ] ESP32 Wi-Fi transport — run **008_ESP32_WIFI_LAN_SCRIPT_EXECUTION** on real ESP32-S3 hardware: provision over USB/BLE, verify same-LAN mDNS and direct-IP script execution, wrong/no-secret rejection, Wi-Fi drop recovery, USB/BLE recovery, and GPIO/ADC/SPI/PWM/sampler/retransmit coverage.
- [ ] ESP32 Wi-Fi transport — run **009_ESP32_WIFI_VPN_BY_IP_EXECUTION** on real ESP32-S3 hardware: verify user-owned VPN/private-IP script execution, manual IP fallback when mDNS is unavailable, wrong/no-secret rejection, reconnect behavior, and no hosted relay/account path.
- [ ] ESP32 Wi-Fi transport — record pass/fail evidence in `docs/TESTS.md` and update `docs/ESP32_WIFI_TRANSPORT_AUDIT.md` before marking the transport plan complete.

## Week of 2026-02-23 → 2026-03-01

- [ ] `pwm.emw` — pass local test **#004** (UI slider drives full 0→180° servo movement reliably).
- [ ] `rfid.emw` — pass local test **#005** (block read/write + UID magic card clone end-to-end).
