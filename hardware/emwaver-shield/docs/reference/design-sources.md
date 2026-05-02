# Design Sources

The current local starting point for EMWaver Shield is a mirrored catalog entry plus the remaining external design reference.

## External design references

- EasyEDA: [project `a9ecc255b85443dd9903fbab629f9e0b`](https://easyeda.com/editor#project_id=a9ecc255b85443dd9903fbab629f9e0b)

## Local mirrored catalog files

- [../../catalog/device.json](../../catalog/device.json)
- [../../catalog/images/IMG_0063.jpg](../../catalog/images/IMG_0063.jpg)
- [../../catalog/images/IMG_0064.jpg](../../catalog/images/IMG_0064.jpg)
- [../../catalog/images/IMG_0065.jpg](../../catalog/images/IMG_0065.jpg)
- [../../catalog/images/IMG_0066.jpg](../../catalog/images/IMG_0066.jpg)
- [../../catalog/images/IMG_0067.jpg](../../catalog/images/IMG_0067.jpg)
- [../../catalog/images/IMG_0096.jpg](../../catalog/images/IMG_0096.jpg)
- [../../catalog/images/IMG_0097.jpg](../../catalog/images/IMG_0097.jpg)
- [../../catalog/images/EMWAVER_SHIELD.png](../../catalog/images/EMWAVER_SHIELD.png)

## Recommended local structure

As the repo becomes self-contained, place files under:

- `hardware/revisions/v1/source/` - editable EDA/project files
- `hardware/revisions/v1/fabrication/` - Gerbers, BOM, pick-and-place, drill files
- `hardware/revisions/v1/docs/` - revision-specific notes, pinouts, and assembly callouts

## Current gap

The repo does not yet contain committed local EDA or fabrication exports for the shield. Right now EasyEDA is the remaining working design-source reference.
