# Hardware

This folder holds the revision-specific hardware package for EMWaver Shield.

Current direction:

- keep mirrored catalog material in `../catalog/`,
- keep builder-facing documentation in `../docs/`,
- keep actual board-source and fabrication assets here under `revisions/`.

Recommended revision layout:

- `revisions/<revision>/source/` - editable EDA source files
- `revisions/<revision>/fabrication/` - Gerbers, drill files, BOMs, pick-and-place outputs
- `revisions/<revision>/docs/` - pinouts, assembly notes, and manufacturing caveats

Keep revision history inside this repo rather than creating a new repo for every hardware tweak.
