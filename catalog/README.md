# Catalog Mirror

This folder mirrors the current `EMWAVER_SHIELD` hardware-catalog package from the main EMWaver repository.

Contents:

- `device.json` - catalog metadata used by the EMWaver web/app surfaces.
- `images/` - the current photo and render set referenced by that metadata.

This mirror is useful for keeping the hardware repo self-contained even before full board-source and fabrication assets are committed locally.

The `images/` folder is also intended to act as the canonical repo-backed image source for EMWaver catalog surfaces as the web catalog migrates away from duplicated copies under `web/public/`.
