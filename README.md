<div align="center">
  <img src="frontend/public/banner.jpeg" alt="EMWaver Banner" width="100%">
</div>

<div align="center">
  <p>
    <a href="https://luispl77.github.io/emwaver/"><strong>Website</strong></a> ·
    <a href="https://www.youtube.com/@EMWavers"><strong>YouTube</strong></a> ·
    <a href="https://github.com/luispl77/emwaver/releases"><strong>Releases</strong></a>
  </p>
</div>

EMWaver is a hardware hacking platform that treats your phone and PC as part of the “device”.

**Current direction:** EMWaver is now centered around a single current-gen **STM32** device using **USB** as the one transport across iOS/Android/Desktop. The product is intentionally **Script-first**: scripts + UI evolve without reflashing.

> Distribution is **binary-first** (apps + firmware shipped as binaries). End users should not need to build or flash from source to use EMWaver.

## Get Started

<div align="center">
  <a href="https://play.google.com/store/apps/details?id=com.emwaver.app">
    <img src="frontend/public/badges/google-play.png" alt="Get it on Google Play" height="52">
  </a>
  <a href="https://github.com/luispl77/emwaver/releases/latest/download/EMWaver-Android.apk">
    <img src="frontend/public/badges/android-apk.png" alt="Download APK" height="52">
  </a>
  <a href="https://apps.apple.com/app/emwaver">
    <img src="frontend/public/badges/app-store.png" alt="Download on the App Store" height="52">
  </a>
</div>

## Apps & Tools

- Android app: `android/`
- iOS app: `ios/`
- macOS app: `macos/`
- Shared Apple code (iOS + macOS): `apple/`
- Shared Rust crates: `crates/`
- Internal tooling (not shipped): `cli/`

## Firmware

- STM32 firmware (single firmware): `stm/emwaver-firmware/`

## Website

- Next.js site: `frontend/` (run `cd frontend && npm run dev`)

## License

See `LICENSE` and `NOTICE`.
