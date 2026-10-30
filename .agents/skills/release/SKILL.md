---
name: release
description: Cut a Luma release. Use when bumping the version, updating the changelog, tagging, or debugging a release or CI gate failure.
disable-model-invocation: true
---

Versions, lockfiles, CI gates and changelog.

- **Version lives in three files, bumped together**: `package.json`, `tauri/tauri.conf.json`, `tauri/Cargo.toml`. `tauri/Cargo.lock`'s `luma` entry gets rewritten by any `cargo` invocation that touches the workspace — verify with `git diff tauri/Cargo.lock` rather than assuming it's stale.
- **After bumping `package.json`, run `npm install` (not a hand-edit)** so `package-lock.json`'s two `version` fields update too.
- **This machine's `~/.npmrc` sets `legacy-peer-deps=true` globally**, which hides lockfile issues that CI's strict `npm ci` will fail on (`EUSAGE`/"Missing: X from lock file"). Reproduce CI before tagging with `rm -rf node_modules && npm ci --no-legacy-peer-deps`; regenerate the lockfile with `npm install --no-legacy-peer-deps` if it fails.
- **Releases are CI-driven**: `.github/workflows/release.yml` builds and publishes a draft release on any `v*` tag push. A `check-main` job gates `release` on the tagged commit being reachable from `origin/main` (`git merge-base --is-ancestor`), so cut tags from `main` (merge `develop` in first).
- **`.github/workflows/ci.yml` is the PR/push gate** (PRs, and pushes to `main`/`develop`): `npm run check`, then `cargo test` minus the three environment-dependent tests, which it skips by name. It needs the Linux webkit stack installed even for `cargo check`, since tauri's build scripts probe for it.
- `CHANGELOG.md` is hand-maintained — update it in the same commit as the version bump, sourced from `git log <prev-tag>..HEAD --oneline`.
