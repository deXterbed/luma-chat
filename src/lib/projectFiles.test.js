import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "./db";
import {
  loadProjectFiles,
  filterFiles,
  projectFilesKey,
  NO_FILES,
} from "./projectFiles";

// The cache is module-level and keyed by the root set, so each test uses its
// own paths to avoid inheriting another test's walk.
describe("loadProjectFiles", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("walks a root set once and reuses the result", async () => {
    const spy = vi.spyOn(db, "listProjectFiles").mockResolvedValue(["a.ts"]);
    const roots = ["/tmp/luma-mention-one"];
    const [first, second] = await Promise.all([
      loadProjectFiles(roots),
      loadProjectFiles(roots),
    ]);
    expect(first).toEqual(["a.ts"]);
    expect(second).toEqual(["a.ts"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-walks when the root set changes", async () => {
    const spy = vi.spyOn(db, "listProjectFiles").mockResolvedValue(["a.ts"]);
    await loadProjectFiles(["/tmp/luma-mention-two"]);
    await loadProjectFiles(["/tmp/luma-mention-three"]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns the shared empty index for no roots or an empty walk", async () => {
    expect(await loadProjectFiles([])).toBe(NO_FILES);
    expect(await loadProjectFiles(undefined)).toBe(NO_FILES);
    vi.spyOn(db, "listProjectFiles").mockResolvedValue([]);
    expect(await loadProjectFiles(["/tmp/luma-mention-empty"])).toBe(NO_FILES);
  });
});

describe("filterFiles", () => {
  const files = [
    "src/app.ts",
    "src/lib/db.rs",
    "README.md",
    "tauri/src/main.rs",
    "deep/nested/app_helper.ts",
  ];

  it("returns the first N when nothing is typed", () => {
    expect(filterFiles(files, "", 2)).toEqual(["src/app.ts", "src/lib/db.rs"]);
  });

  it("matches case-insensitively anywhere in the path", () => {
    expect(filterFiles(files, "DB.RS")).toEqual(["src/lib/db.rs"]);
  });

  it("ranks a basename prefix above a mid-path match", () => {
    // Both have `app` starting the basename; the shorter path wins the tie.
    expect(filterFiles(files, "app")[0]).toBe("src/app.ts");
  });

  it("falls back to a subsequence match when nothing is contiguous", () => {
    const list = ["src/app.ts", "src/lib/db.rs"];
    // `sapp` is a substring of neither, but a subsequence of src/app.ts.
    expect(filterFiles(list, "sapp")).toEqual(["src/app.ts"]);
  });

  it("ranks a contiguous hit above a scattered one", () => {
    const list = ["b/d_b_r.rs", "a/dbr.rs"];
    expect(filterFiles(list, "dbr")).toEqual(["a/dbr.rs", "b/d_b_r.rs"]);
  });

  it("caps the result and returns nothing for no match", () => {
    expect(filterFiles(files, "s", 3)).toHaveLength(3);
    expect(filterFiles(files, "zzz")).toEqual([]);
  });

  it("tolerates a missing index", () => {
    expect(filterFiles(null, "a")).toEqual([]);
  });
});

describe("projectFilesKey", () => {
  it("is a string, so it can be an effect dependency", () => {
    expect(projectFilesKey(["/a", "/b"])).toBe("/a|/b");
    expect(projectFilesKey([])).toBe("");
  });
});
