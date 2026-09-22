import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TitleBar from "./TitleBar";
import styles from "./TitleBar.module.css";

// macOS gets its window controls from the OS: `tauri.macos.conf.json` switches
// the window to `decorations: true` with an overlay title bar, so the native
// traffic lights sit over the left of this bar and the app must not draw a
// second set of controls. Everywhere else the window stays frameless and these
// buttons are the only way to minimize, maximize or close.
describe("TitleBar window controls", () => {
  const setUserAgent = (ua) =>
    Object.defineProperty(window.navigator, "userAgent", {
      value: ua,
      configurable: true,
    });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setUserAgent("Mozilla/5.0 (jsdom)");
  });

  it("draws the app's own controls when the platform has none", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const { container } = render(<TitleBar />);

    expect(screen.getByTitle("Minimize")).toBeInTheDocument();
    expect(screen.getByTitle("Maximize")).toBeInTheDocument();
    expect(screen.getByTitle("Close")).toBeInTheDocument();
    expect(container.firstChild.className).not.toContain(styles.titlebarMac);
  });

  it("leaves them to the OS on macOS, and clears room for them", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const { container } = render(<TitleBar />);

    expect(screen.queryByTitle("Minimize")).toBeNull();
    expect(screen.queryByTitle("Maximize")).toBeNull();
    expect(screen.queryByTitle("Close")).toBeNull();
    // Still the app's own icons, and still draggable.
    expect(screen.getByTitle("Settings")).toBeInTheDocument();
    expect(container.firstChild.className).toContain(styles.titlebarMac);
  });
});
