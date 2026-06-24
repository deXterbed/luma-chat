import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock @tauri-apps/api/core for tests
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock @tauri-apps/plugin-shell
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

// Mock uuid
vi.mock("uuid", () => ({
  v4: () => "test-uuid-" + Math.random().toString(36).substr(2, 9),
}));

// Global test utilities
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Enable Tauri internals mock so db.js doesn't bail out early
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {},
  writable: true,
  configurable: true,
});
