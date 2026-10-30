# Window controls

The app is not single-shape: macOS uses native traffic lights and a titled window. The platform config replacement semantics matter.

`src/components/TitleBar.jsx` uses `@tauri-apps/api/window` → `getCurrentWindow()` for minimize/maximize/close, but draws those buttons **only on non-macOS** (`/Mac/.test(navigator.userAgent)`, computed in the component so the platform branch is unit-testable): macOS uses the native traffic lights. This is the one place the app is not single-shape, and the difference is config, not CSS:

| | `tauri.conf.json` | `tauri.macos.conf.json` |
|---|---|---|
| window | `decorations: false` — frameless, the app draws its own bar and controls | `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle: true` |

Only macOS rounds the window, and it does it natively: macOS gives the rounded frame and its shadow to *titled* windows, and a borderless one is a flat rectangle. CSS `border-radius` cannot substitute — the corner pixels are still painted, by `html`/`body` and by the window's own `backgroundColor`, so they read as square whatever the radius is. That is also why the transparency route was not taken: `transparent: true` would let CSS round the corners, but on macOS it needs `macOSPrivateApi` (and the `macos-private-api` Cargo feature, without which macOS compiles `transparent` out entirely) and it blocks Mac App Store submission. `Overlay` sets `titlebarAppearsTransparent` + `fullsizeContentView`, so the app's 38px bar sits *under* the lights — hence `.titlebarMac`'s left padding — and `hiddenTitle` keeps AppKit from drawing the window title over that bar. `trafficLightPosition` is the knob if the lights ever sit off-centre (it requires `Overlay` + `decorations: true`).

**`tauri.macos.conf.json` restates the whole window object, and has to.** Platform configs merge with RFC 7396 JSON Merge Patch, and `json_patch::merge` replaces arrays wholesale — `windows` is an array, so that file is a replacement rather than a patch, and a window key added to `tauri.conf.json` later must be added here too or macOS silently falls back to that key's default. `tauri-build` reads both files (unknown keys fail the build, and this one is listed in `rerun-if-changed`), so `npm run check` covers it.
