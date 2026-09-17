import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firstName } from "../src/util/display.ts";

describe("firstName", () => {
  it("returns the first whitespace-delimited word", () => {
    assert.equal(firstName("Dave Smith"), "Dave");
    assert.equal(firstName("  Dave   Smith  "), "Dave");
    assert.equal(firstName("Dave"), "Dave");
  });

  it("handles a single name and blanks", () => {
    assert.equal(firstName("Dave"), "Dave");
    assert.equal(firstName("   "), "");
    assert.equal(firstName(""), "");
  });
});
