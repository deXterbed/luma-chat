import { describe, it, expect } from "vitest";
import { groupSessionsByRecency } from "./sessionGroups";

// Wed 21 Oct 2026, 12:00 local. Week start (Monday) = 19 Oct, last week = 12 Oct.
const now = new Date(2026, 9, 21, 12, 0, 0);
const at = (day) => new Date(2026, 9, day, 9, 0, 0).getTime();
const session = (id, day) => ({ id, title: id, updated_at: at(day) });

describe("groupSessionsByRecency", () => {
  it("puts today and yesterday in Recent", () => {
    const groups = groupSessionsByRecency(
      [session("today", 21), session("yesterday", 20)],
      now,
    );

    expect(groups.map((g) => g.key)).toEqual(["recent"]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["today", "yesterday"]);
  });

  it("buckets the rest of the calendar week into This week", () => {
    const groups = groupSessionsByRecency([session("monday", 19)], now);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("thisWeek");
    expect(groups[0].label).toBe("This week");
  });

  it("buckets the previous calendar week into Last week", () => {
    const groups = groupSessionsByRecency(
      [session("lastMon", 12), session("lastSun", 18)],
      now,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("lastWeek");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["lastMon", "lastSun"]);
  });

  it("keeps older groups in order and drops empty ones", () => {
    const groups = groupSessionsByRecency(
      [session("old", 11), session("today", 21), session("thisWeek", 19)],
      now,
    );

    expect(groups.map((g) => g.key)).toEqual(["recent", "thisWeek", "older"]);
  });

  it("treats a missing timestamp as older", () => {
    const groups = groupSessionsByRecency([{ id: "legacy", title: "l" }], now);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("older");
  });

  it("returns nothing for an empty list", () => {
    expect(groupSessionsByRecency([], now)).toEqual([]);
  });
});
