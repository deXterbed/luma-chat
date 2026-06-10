# Fixing the `link.exe` Conflict on Windows

This project uses **Tauri** (Rust + a native Windows webview) for the desktop shell. Building Tauri apps on Windows requires the **MSVC C++ toolchain** to produce the final executable.

This page documents a common pitfall: **`link.exe` shadowing by Git for Windows**, and how to fix it.

---

## The Problem

When running `npm run dev` (or `cargo build`) on Windows, you may see an error like:

```
error: linking with `link.exe` failed: exit code: 1
  = note: link: extra operand '...rcgu.o'
          Try 'link --help' for more information.

note: `link.exe` returned an unexpected error

note: in the Visual Studio installer, ensure the "C++ build tools" workload is selected
```

The error message is misleading. It tells you to install C++ build tools (which you may have already done), but the real cause is something else.

## The Root Cause

There are **two different programs named `link.exe`** on a typical Windows machine:

| Program | Source | Purpose |
|---|---|---|
| `link.exe` from **MSVC** | Visual Studio Build Tools | Links object files into a Windows executable |
| `link.exe` from **GNU coreutils** | Git for Windows (or MSYS2/Cygwin) | Creates hard filesystem links (unrelated to compilation) |

The GNU version is installed at something like:

```
C:\Program Files\Git\usr\bin\link.exe
```

When Cargo (via `rustc`) tries to run the linker, Windows searches the `PATH` environment variable and runs the **first** `link.exe` it finds. If Git's `link.exe` comes before Visual Studio's in the `PATH`, the GNU tool runs. It sees Rust's linker arguments (`.o` files, `.rlib` files, `kernel32.lib`, etc.) and has no idea what to do with them, so it prints:

```
link: extra operand '...rcgu.o'
```

This is also why the error persists even after installing the "Desktop development with C++" workload from the Visual Studio installer — the real MSVC `link.exe` is on disk, but it never gets called.

## The Fix

You have three reliable ways to fix this. Pick the one that fits your workflow.

### Option 1: Use the Developer Command Prompt (Quickest)

Microsoft ships a special terminal that pre-configures the `PATH` to put Visual Studio's tools first.

1. Press the **Windows key** and search for **"Developer Command Prompt for VS 2022"** (or "Developer PowerShell").
2. Open it.
3. `cd` to the project and run `npm run dev` as normal.

This terminal is the most reliable way to build Tauri/Rust projects on Windows because it also sets the `LIB` and `INCLUDE` environment variables that the MSVC linker needs to find `kernel32.lib` and other Windows SDK libraries.

### Option 2: Reorder Your System `PATH` (Persistent)

If you want to keep using your normal terminal:

1. Press the **Windows key** and search for **"Edit the system environment variables"**.
2. Click **Environment Variables**.
3. In the **System variables** section, select `Path` and click **Edit**.
4. Find the entry for Git's `usr\bin` (typically `C:\Program Files\Git\usr\bin`).
5. Move it to the **bottom** of the list, below any Microsoft Visual Studio / Windows Kits entries.
6. Click **OK** to save, then **completely restart your terminal/editor**.

### Option 3: Pin the Linker in Cargo (Project-Scoped)

If you don't want to touch your system `PATH` or remember to use the Developer Command Prompt, you can tell Cargo exactly which `link.exe` to use by creating a project-local cargo config.

1. Create `.cargo/config.toml` in the project root:

   ```toml
   [target.x86_64-pc-windows-msvc]
   linker = "C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Tools\\MSVC\\14.51.36231\\bin\\Hostx64\\x64\\link.exe"

   [env]
   LIB = "C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.26100.0\\um\\x64;C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.26100.0\\ucrt\\x64;C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Tools\\MSVC\\14.51.36231\\lib\\x64"
   INCLUDE = "C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.26100.0\\um;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.26100.0\\ucrt;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.26100.0\\shared;C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Tools\\MSVC\\14.51.36231\\include"
   ```

2. Update the paths to match your installed Visual Studio / Windows SDK versions. You can find them by running:

   ```cmd
   where /R "C:\Program Files (x86)\Microsoft Visual Studio" link.exe
   dir /s /b "C:\Program Files (x86)\Windows Kits\10\Lib" | findstr "um\x64"
   ```

3. This config is local to the project, so it doesn't affect anything else on your machine.

## Verifying the Real Linker Is Being Used

After applying any of the fixes, confirm Rust is calling the right one:

```cmd
where link
```

In the Developer Command Prompt, you should see output like:

```
C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.51.36231\bin\Hostx64\x64\link.exe
```

If you see `C:\Program Files\Git\usr\bin\link.exe` instead, the shadowing is still happening and you need to try a different fix.

## Related Prerequisites

Beyond the linker issue, Tauri on Windows also requires:

- **Rust toolchain** — install via [rustup](https://rustup.rs/) and use the `stable-x86_64-pc-windows-msvc` default:
  ```bash
  rustup default stable-x86_64-pc-windows-msvc
  ```
- **MSVC C++ Build Tools** — install via the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). Under "Individual components", you need:
  - MSVC v143 - VS 2022 C++ x64/x86 build tools (Latest)
  - Windows 11 SDK (or Windows 10 SDK)
- **WebView2 Runtime** — usually pre-installed on Windows 10/11. Tauri needs it at runtime to render the UI.

See `CLAUDE.md` at the project root for the full setup checklist.

## Why Does Tauri Need a C++ Compiler?

Tauri uses the operating system's webview (Edge WebView2 on Windows) rather than bundling one like Electron does. This makes the final app ~10x smaller and faster, but it means the Rust code has to **directly link against the Windows API** (to create windows, handle messages, etc.). That linking step requires Microsoft's `link.exe` and the Windows SDK libraries, which is why a C++ toolchain is needed even though no C++ code is written for the project.
