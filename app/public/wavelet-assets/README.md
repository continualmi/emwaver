# Wavelet Asset Scripts (Canonical)

This folder is the single source of truth for EMWaver’s built-in Wavelet JavaScript assets.

- Desktop (Tauri) loads these directly at runtime from `/wavelet-assets/*`.
- Android and iOS sync/copy these files into their app bundles during build so all platforms ship the same default scripts.

