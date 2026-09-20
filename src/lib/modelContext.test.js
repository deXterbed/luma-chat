import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  CODEBASE_MAX_CTX,
  cachedModelWindow,
  isCloudModel,
  isModelUnavailable,
  loadModelWindow,
  resolveNumCtx,
} from "./modelContext";

describe("isCloudModel", () => {
  it("detects the cloud tag suffix in both shapes Ollama uses", () => {
    expect(isCloudModel("gemma4:31b-cloud")).toBe(true);
    expect(isCloudModel("minimax-m3:cloud")).toBe(true);
    expect(isCloudModel("deepseek-v4-flash:0731-cloud")).toBe(true);
  });

  it("is false for local tags and empties", () => {
    expect(isCloudModel("llama3.1:8b")).toBe(false);
    expect(isCloudModel("cloudy:latest")).toBe(false);
    expect(isCloudModel("")).toBe(false);
    expect(isCloudModel(undefined)).toBe(false);
  });
});

describe("resolveNumCtx", () => {
  const WINDOW = 262144; // gemma4:31b-cloud, read from a live /api/show

  it("uses the setting untouched in chat mode", () => {
    expect(
      resolveNumCtx({ codebase: false, model: "gemma4:31b-cloud", setting: 8192, modelWindow: WINDOW }),
    ).toBe(8192);
  });

  it("raises a small setting for a cloud model in codebase mode", () => {
    expect(
      resolveNumCtx({ codebase: true, model: "gemma4:31b-cloud", setting: 8192, modelWindow: WINDOW }),
    ).toBe(CODEBASE_MAX_CTX);
  });

  it("caps at the model's own window when that is smaller than the ceiling", () => {
    expect(
      resolveNumCtx({ codebase: true, model: "gemma4:31b-cloud", setting: 8192, modelWindow: 32768 }),
    ).toBe(32768);
  });

  it("never lowers a setting that is already bigger", () => {
    expect(
      resolveNumCtx({ codebase: true, model: "gemma4:31b-cloud", setting: 131072, modelWindow: WINDOW }),
    ).toBe(131072);
    // Even a window smaller than the setting is the user's explicit choice.
    expect(
      resolveNumCtx({ codebase: true, model: "gemma4:31b-cloud", setting: 32768, modelWindow: 8192 }),
    ).toBe(32768);
  });

  it("does not raise for a local model — that memory is the user's", () => {
    expect(
      resolveNumCtx({ codebase: true, model: "llama3.1:8b", setting: 8192, modelWindow: WINDOW }),
    ).toBe(8192);
  });

  it("does not raise when the window is unknown", () => {
    // Exceeding the trained length degrades quality silently, so an unread
    // window must mean "leave it alone" rather than "guess".
    for (const modelWindow of [null, undefined, 0, NaN]) {
      expect(
        resolveNumCtx({ codebase: true, model: "gemma4:31b-cloud", setting: 8192, modelWindow }),
      ).toBe(8192);
    }
  });
});

describe("loadModelWindow", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("reads the window once and serves later calls from cache", async () => {
    invoke.mockResolvedValue(262144);

    expect(await loadModelWindow("cached-model:cloud")).toBe(262144);
    expect(await loadModelWindow("cached-model:cloud")).toBe(262144);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "ollama_model_context",
      expect.objectContaining({ model: "cached-model:cloud" }),
    );
    // And synchronously readable afterwards, so a send never awaits it.
    expect(cachedModelWindow("cached-model:cloud")).toBe(262144);
  });

  it("shares one request between concurrent callers", async () => {
    invoke.mockResolvedValue(131072);
    const [a, b] = await Promise.all([
      loadModelWindow("concurrent:cloud"),
      loadModelWindow("concurrent:cloud"),
    ]);
    expect([a, b]).toEqual([131072, 131072]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so a retry can succeed", async () => {
    invoke.mockRejectedValueOnce(new Error("ollama down"));
    expect(await loadModelWindow("flaky:cloud")).toBeNull();
    // Nothing cached, so the next warm-up asks again instead of remembering
    // "no window" for the session.
    expect(cachedModelWindow("flaky:cloud")).toBeUndefined();

    invoke.mockResolvedValue(32768);
    expect(await loadModelWindow("flaky:cloud")).toBe(32768);
  });

  it("treats a nonsense response as no window rather than caching it", async () => {
    invoke.mockResolvedValue(0);
    expect(await loadModelWindow("zeroed:cloud")).toBeNull();
    expect(cachedModelWindow("zeroed:cloud")).toBeUndefined();
  });

  it("never calls the backend for an empty model", async () => {
    expect(await loadModelWindow("")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("isModelUnavailable", () => {
  const base = {
    model: "gemma4:31b-cloud",
    available: ["llama3.1:8b", "qwen3:14b"],
    custom: [],
    connected: true,
  };

  it("flags a model the server no longer lists", () => {
    expect(isModelUnavailable(base)).toBe(true);
  });

  it("stays quiet for a model that is listed or user-added", () => {
    expect(isModelUnavailable({ ...base, available: ["gemma4:31b-cloud"] })).toBe(false);
    // `custom_models` deliberately holds tags absent from /api/tags (cloud
    // tags live there), so absence alone must not be treated as removal.
    expect(isModelUnavailable({ ...base, custom: ["gemma4:31b-cloud"] })).toBe(false);
  });

  it("stays quiet before it can know — offline, empty list, or no model yet", () => {
    expect(isModelUnavailable({ ...base, connected: false })).toBe(false);
    expect(isModelUnavailable({ ...base, available: [] })).toBe(false);
    expect(isModelUnavailable({ ...base, available: undefined })).toBe(false);
    expect(isModelUnavailable({ ...base, model: "" })).toBe(false);
  });
});
