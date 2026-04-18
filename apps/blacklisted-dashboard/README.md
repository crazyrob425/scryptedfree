# Blacklisted Binary Labs Console (Phase 1)

Native dashboard shell built with **Tauri 2 + TypeScript** for Windows x64 packaging.

## Scripts

- `npm run dev` - run frontend in development mode
- `npm run build` - build frontend assets
- `npm run tauri:dev` - run desktop app in development mode
- `npm run tauri:build` - build native bundles for host platform
- `npm run tauri:build:windows` - build Windows x64 bundles (MSI + NSIS) using `cargo-xwin`

## Windows x64 Bundle Output

The Tauri config is pre-set to generate:

- `msi` installer package
- `nsis` installer package

## Notes for Linux CI/Dev Hosts

Local Linux desktop prerequisites (`webkit2gtk`, `glib`, `rsvg2`) are required for native Linux checks.
Windows cross-builds should use the `tauri:build:windows` script and proper Rust target/tooling.
