# Hardware Import Inventory

This inventory supports `REBIRTH-032` and `REBIRTH-033`.

The current hardware repositories were found locally under:

```text
/Users/luisml/Documents/emwaver/
```

All listed local repositories are git repositories on branch `main` with `origin` remotes in the `continualmi` GitHub organization.

## Target Prefix Map

| Repository | Local source | Remote | Category | Target prefix | Import status |
| --- | --- | --- | --- | --- | --- |
| `emwaver-air` | `/Users/luisml/Documents/emwaver/emwaver-air` | `git@github.com:continualmi/emwaver-air.git` | board | `hardware/emwaver-air/` | imported in `8654b660` |
| `emwaver-carrier` | `/Users/luisml/Documents/emwaver/emwaver-carrier` | `git@github.com:continualmi/emwaver-carrier.git` | board | `hardware/emwaver-carrier/` | imported in `c566fec8` |
| `emwaver-core` | `/Users/luisml/Documents/emwaver/emwaver-core` | `git@github.com:continualmi/emwaver-core.git` | board | `hardware/emwaver-core/` | imported in `c5ac33cc` |
| `emwaver-link` | `/Users/luisml/Documents/emwaver/emwaver-link` | `git@github.com:continualmi/emwaver-link.git` | board | `hardware/emwaver-link/` | imported in `a1825d3f` |
| `emwaver-shield` | `/Users/luisml/Documents/emwaver/emwaver-shield` | `git@github.com:continualmi/emwaver-shield.git` | board | `hardware/emwaver-shield/` | imported in `20d5acc1` |
| `gpio-waver` | `/Users/luisml/Documents/emwaver/gpio-waver` | `git@github.com:continualmi/gpio-waver.git` | module | `hardware/gpio-waver/` | imported in `4f45903a`, flattened after import |
| `infrared-waver` | `/Users/luisml/Documents/emwaver/infrared-waver` | `git@github.com:continualmi/infrared-waver.git` | module | `hardware/infrared-waver/` | imported in `4a8b05c1` |
| `ism-waver` | `/Users/luisml/Documents/emwaver/ism-waver` | `git@github.com:continualmi/ism-waver.git` | module | `hardware/ism-waver/` | imported in `3927b9be` |
| `rfid-waver` | `/Users/luisml/Documents/emwaver/rfid-waver` | `git@github.com:continualmi/rfid-waver.git` | module | `hardware/rfid-waver/` | imported in `eacf3b81` |

## Catalog References Found In This Repo

The current web hardware catalog references these GitHub URLs:

- `https://github.com/continualmi/emwaver-air`
- `https://github.com/continualmi/emwaver-carrier`
- `https://github.com/continualmi/emwaver-core`
- `https://github.com/continualmi/emwaver-link`
- `https://github.com/continualmi/emwaver-shield`
- `https://github.com/continualmi/gpio-waver`
- `https://github.com/continualmi/infrared-waver`
- `https://github.com/continualmi/ism-waver`
- `https://github.com/continualmi/rfid-waver`

Additional catalog entries exist for older, generated, or currently repo-less hardware IDs:

- `BLE_WAVER_DONGLE`
- `DUPLEX_WAVER_MODULE`
- `EMW1`
- `GPIO_WAVER_MODULE`
- `GPIO_WAVER_V0`
- `GPIO_WAVER_V1`
- `INFRARED_WAVER_V0`
- `INFRARED_WAVER_V1`
- `ISM_WAVER_V0`
- `ISM_WAVER_V1`
- `ISM_WAVER_V2`
- `USB_WAVER`
- `WIFI_WAVER`
- `emwaver-plus`

These should be reviewed after the primary repository imports. They may be historical catalog entries, generated web catalog records, or designs folded into one of the primary hardware repos.

## Trial Import Result

The trial import has been completed:

```bash
./hardware/import-subtrees.sh gpio-waver
```

Result:

```text
hardware/gpio-waver/
```

The import produced commit `4f45903a` with message `Import gpio-waver hardware history`.

The remaining imports were completed with:

```bash
./hardware/import-subtrees.sh all
```

That command skipped the existing `hardware/gpio-waver/` prefix and imported the other eight repositories as separate subtree commits.
