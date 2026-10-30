---
paths: ["package.json", "tauri/Cargo.toml", "tauri/tauri.conf.json", "tauri/Cargo.lock", ".github/workflows/**", "CHANGELOG.md"]
---

# Release and CI rules

Procedure: the `release` skill. Detail: `.github/workflows/*.yml`, `RELEASE_CHECKLIST.md`.

- **Version lives in three files and moves together**: `package.json`, `tauri/tauri.conf.json`, `tauri/Cargo.toml`. `tauri/Cargo.lock`'s `luma` entry is rewritten by any `cargo` invocation — check `git diff tauri/Cargo.lock` rather than assuming it is stale.
- **After bumping `package.json`, run `npm install`**, not a hand-edit, so `package-lock.json`'s two `version` fields update.
- **This machine's `~/.npmrc` sets `legacy-peer-deps=true` globally**, which hides what CI's strict `npm ci` will fail on. Reproduce CI with `rm -rf node_modules && npm ci --no-legacy-peer-deps` before tagging.
- **Tags are cut from `main`.** `release.yml` gates on the tagged commit being reachable from `origin/main` — merge `develop` first.
- **`CHANGELOG.md` is hand-maintained** and belongs in the same commit as the version bump.
