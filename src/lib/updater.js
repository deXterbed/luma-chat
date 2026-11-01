// Renderer-side updater client — wraps the Tauri updater plugin.
// Inert outside production builds: in `tauri dev` the local version is a
// work-in-progress that never matches the published manifest, so a check would
// only ever produce noise.

const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__;
const enabled = import.meta.env.PROD && Boolean(isTauri);

export const updatesEnabled = enabled;

// Resolves to the pending update, or null when this build is current.
export async function checkForUpdate() {
  if (!enabled) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

// Downloads and installs the update, then restarts into it. `onProgress`
// receives { phase, percent }, where percent is null when the server sends no
// content length to divide by.
export async function installUpdate(update, onProgress) {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data?.contentLength ?? 0;
      onProgress?.({ phase: "downloading", percent: total ? 0 : null });
    } else if (event.event === "Progress") {
      received += event.data?.chunkLength ?? 0;
      onProgress?.({
        phase: "downloading",
        percent: total ? Math.round((received / total) * 100) : null,
      });
    } else if (event.event === "Finished") {
      onProgress?.({ phase: "installing", percent: 100 });
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
