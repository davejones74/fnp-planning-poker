import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SessionStory } from "../../shared/types.ts";
import {
  formatCompletedTime,
  sessionProgress,
  statusLabel,
} from "../src/util/session.ts";

function story(key: string, status: SessionStory["status"]): SessionStory {
  return { key, title: key, description: "", status };
}

describe("sessionProgress", () => {
  it("counts estimated stories against the total", () => {
    const stories = [
      story("FPB-1", "estimated"),
      story("FPB-2", "estimating"),
      story("FPB-3", "ready"),
      story("FPB-4", "estimated"),
    ];
    assert.deepEqual(sessionProgress(stories), { estimated: 2, total: 4 });
  });

  it("returns zeroes for an empty backlog", () => {
    assert.deepEqual(sessionProgress([]), { estimated: 0, total: 0 });
  });
});

describe("statusLabel", () => {
  it("maps each story status to a readable label", () => {
    assert.equal(statusLabel("ready"), "Ready");
    assert.equal(statusLabel("estimating"), "Estimating");
    assert.equal(statusLabel("estimated"), "Estimated");
  });
});

describe("formatCompletedTime", () => {
  it("formats a valid ISO timestamp", () => {
    const formatted = formatCompletedTime("2026-01-01T12:00:00.000Z");
    assert.equal(typeof formatted, "string");
    assert.ok(formatted.length > 0);
  });

  it("returns the input untouched when it is not a valid date", () => {
    assert.equal(formatCompletedTime("not-a-date"), "not-a-date");
  });
});