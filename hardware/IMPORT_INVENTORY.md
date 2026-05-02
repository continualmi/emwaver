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
| `emwaver-air` | `/Users/luisml/Documents/emwaver/emwaver-air` | `git@github.com:continualmi/emwaver-air.git` | board | `hardware/boards/emwaver-air/` | pending |
| `emwaver-carrier` | `/Users/luisml/Documents/emwaver/emwaver-carrier` | `git@github.com:continualmi/emwaver-carrier.git` | board | `hardware/boards/emwaver-carrier/` | pending |
| `emwaver-core` | `/Users/luisml/Documents/emwaver/emwaver-core` | `git@github.com:continualmi/emwaver-core.git` | board | `hardware/boards/emwaver-core/` | pending |
| `emwaver-link` | `/Users/luisml/Documents/emwaver/emwaver-link` | `git@github.com:continualmi/emwaver-link.git` | board | `hardware/boards/emwaver-link/` | pending |
| `emwaver-shield` | `/Users/luisml/Documents/emwaver/emwaver-shield` | `git@github.com:continualmi/emwaver-shield.git` | board | `hardware/boards/emwaver-shield/` | pending |
| `gpio-waver` | `/Users/luisml/Documents/emwaver/gpio-waver` | `git@github.com:continualmi/gpio-waver.git` | module | `hardware/modules/gpio-waver/` | pending |
| `infrared-waver` | `/Users/luisml/Documents/emwaver/infrared-waver` | `git@github.com:continualmi/infrared-waver.git` | module | `hardware/modules/infrared-waver/` | pending |
| `ism-waver` | `/Users/luisml/Documents/emwaver/ism-waver` | `git@github.com:continualmi/ism-waver.git` | module | `hardware/modules/ism-waver/` | pending |
| `rfid-waver` | `/Users/luisml/Documents/emwaver/rfid-waver` | `git@github.com:continualmi/rfid-waver.git` | module | `hardware/modules/rfid-waver/` | pending |

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

## Trial Import Recommendation

Start with one small module repository before importing all hardware repos.

Recommended trial:

```text
gpio-waver -> hardware/modules/gpio-waver/
```

Reasons:

- it is a module, not a top-level board,
- it should reveal import mechanics without blocking board-level work,
- it is referenced by the current catalog,
- it should be easy to inspect after import.

Potential command shape:

```bash
git subtree add --prefix=hardware/modules/gpio-waver /Users/luisml/Documents/emwaver/gpio-waver main
```

If subtree import from a local path is not sufficient for the desired history shape, use a temporary clone plus `git filter-repo` to rewrite the imported repository under the target prefix before merging.

The repeatable scripted version lives at:

```bash
./hardware/import-subtrees.sh gpio-waver
./hardware/import-subtrees.sh all
```
