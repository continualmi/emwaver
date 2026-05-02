# Hardware Asset Dedup Inventory

This inventory supports `REBIRTH-036A`.

Goal: keep board/module media canonical under `hardware/<repo-name>/` and stop carrying the same image multiple times in `web/public`, docs, and imported hardware folders.

## Current Finding

Hash scan command:

```bash
find web/public hardware -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.svg' \) -print0 \
  | xargs -0 shasum -a 256
```

Result from the initial scan:

- duplicate hash groups: `93`
- files in duplicate groups: `201`

The biggest duplication source is the old public hardware catalog under:

```text
web/public/hardware-catalog/hardware/
```

Those files duplicate assets now imported into:

```text
hardware/<repo-name>/catalog/images/
```

## Canonical Asset Roots

Use these as the canonical source for board/module media:

| Hardware | Canonical root | Legacy/public duplicate root |
| --- | --- | --- |
| EMWaver Air / older `emwaver-v2` assets | `hardware/emwaver-air/catalog/images/` | `web/public/hardware-catalog/hardware/emwaver-v2/` |
| EMWaver Carrier / DIY assets | `hardware/emwaver-carrier/catalog/images/` | `web/public/hardware-catalog/hardware/EMWAVER_DIY/` |
| EMWaver Core assets | `hardware/emwaver-core/catalog/images/` | `web/public/EMWAVER.png`, parts of `web/public/hardware-catalog/hardware/EMWAVER_DIY/` |
| EMWaver Link photos/renders | `hardware/emwaver-link/catalog/images/` | `web/public/hardware-catalog/hardware/emwaver*/`, `web/public/hardware-catalog/hardware/emwaver_photoshoot*/`, `web/public/hardware-catalog/downloads/emwaver.png` |
| EMWaver Shield assets | `hardware/emwaver-shield/catalog/images/` | `web/public/hardware-catalog/hardware/EMWAVER_SHIELD/` |
| GPIO Waver assets | `hardware/gpio-waver/catalog/images/` | `web/public/hardware-catalog/hardware/GPIO_WAVER/` |
| Infrared Waver assets | `hardware/infrared-waver/catalog/images/` | `web/public/hardware-catalog/hardware/INFRARED_WAVER/` |
| ISM Waver assets | `hardware/ism-waver/catalog/images/` | `web/public/hardware-catalog/hardware/ISM_WAVER/` |
| RFID Waver assets | `hardware/rfid-waver/catalog/images/` | `web/public/hardware-catalog/hardware/RFID_WAVER/` |

## Exact Duplicate Examples

Representative exact duplicates found by SHA-256:

| Canonical file | Duplicate public file |
| --- | --- |
| `hardware/emwaver-air/catalog/images/EMWAVER_CASING.png` | `web/public/hardware-catalog/hardware/emwaver-v2/EMWAVER_CASING.png` |
| `hardware/emwaver-air/catalog/images/IMG_0068.jpg` | `web/public/hardware-catalog/hardware/emwaver-v2/IMG_0068.jpg`, `web/public/EMWAVER-old.jpg` |
| `hardware/emwaver-carrier/catalog/images/EMWAVER_DIY.png` | `web/public/hardware-catalog/hardware/EMWAVER_DIY/EMWAVER_DIY.png` |
| `hardware/emwaver-core/catalog/images/EMWAVER.png` | `web/public/EMWAVER.png`, `web/public/hardware-catalog/hardware/EMWAVER_DIY/EMWAVER.png` |
| `hardware/emwaver-link/catalog/images/emwaver-link.png` | `web/public/hardware-catalog/hardware/emwaver/emwaver.png`, `web/public/hardware-catalog/downloads/emwaver.png` |
| `hardware/emwaver-shield/catalog/images/EMWAVER_SHIELD.png` | `web/public/hardware-catalog/hardware/EMWAVER_SHIELD/EMWAVER_SHIELD.png` |
| `hardware/gpio-waver/catalog/images/GPIO_WAVER.png` | `web/public/hardware-catalog/hardware/GPIO_WAVER/GPIO_WAVER.png` |
| `hardware/infrared-waver/catalog/images/INFRARED_WAVER.png` | `web/public/hardware-catalog/hardware/INFRARED_WAVER/INFRARED_WAVER.png` |
| `hardware/ism-waver/catalog/images/ISM_WAVER_DUAL.png` | `web/public/hardware-catalog/hardware/ISM_WAVER/ISM_WAVER_DUAL.png` |
| `hardware/rfid-waver/catalog/images/RFID_WAVER.png` | `web/public/hardware-catalog/hardware/RFID_WAVER/RFID_WAVER.png` |

## Cleanup Rules

1. Do not delete route-stable public files until all route/catalog references are updated.
2. Prefer static export copying from `hardware/<repo-name>/catalog/images/` into public output over committing duplicate source images under `web/public`.
3. If a public filename must remain stable, document it as an exported/generated copy and name its canonical source.
4. Keep hardware source images beside their hardware project, not inside public website implementation folders.
5. Treat older generated variant folders such as `web/public/hardware-catalog/hardware/emwaver_aligned/` as cleanup candidates after catalog references are audited.

## Next Steps

1. Audit `web/src/lib/catalog.ts`, `web/src/lib/hardwareCatalog.ts`, and `web/public/hardware-catalog/hardware/devices.json` for public image references.
2. Add a static asset export/copy step that can publish selected hardware images from `hardware/<repo-name>/catalog/images/` into static output.
3. Update board catalog manifests to reference canonical hardware asset paths where the runtime supports it.
4. Remove exact duplicate public source images once route references no longer require committed copies.
