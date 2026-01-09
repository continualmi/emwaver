# Script Asset Scripts (Canonical)

This folder is the single source of truth for EMWaver’s built-in Script assets (`.js`).

- Desktop (Tauri) loads these directly at runtime from `/default-scripts/*`.
- Android and iOS sync/copy these files into their app bundles during build so all platforms ship the same default scripts.
