import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/shared/errors.ts";
import { MAX_SESSION_STORIES } from "../../shared/validation.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("RoomService - story import", () => {
  it("imports new stories into the backlog", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);

    const summary = await h.service.importStories(code, facilitatorId, {
      stories: [
        { key: "fpb-42", title: "Search payments", description: "Find a payment" },
        { key: "MAN-1", title: "Manual story", description: "" },
      ],
    });

    assert.equal(summary.imported, 2);
    assert.equal(summary.duplicatesSkipped, 0);
    assert.equal(summary.invalidSkipped, 0);
    assert.deepEqual(
      summary.stories.map((s) => s.key),
      ["FPB-42", "MAN-1"],
      "keys are normalised to upper case",
    );
    assert.equal(summary.stories[0]?.status, "ready");

    const room = await h.service.getRoom(code);
    assert.equal(room.stories.length, 2);
  });

  it("upserts by key and preserves status and agreed estimate", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.importStories(code, facilitatorId, {
      stories: [{ key: "FPB-42", title: "Original title", description: "A" }],
    });
    await h.service.startStoryEstimation(code, facilitatorId, "FPB-42");
    await h.service.selectCard(code, facilitatorId, "5");
    await h.service.selectCard(code, joinerId, "5");
    await h.service.revealCards(code, facilitatorId);
    await h.service.recordAgreedEstimate(code, facilitatorId, "FPB-42", "5");

    const summary = await h.service.importStories(code, facilitatorId, {
      stories: [{ key: "fpb-42", title: "Updated title", description: "B", url: "https://jira/pay/FPB-42" }],
    });

    assert.equal(summary.imported, 0);
    assert.equal(summary.duplicatesSkipped, 1);
    const story = summary.stories.find((s) => s.key === "FPB-42");
    assert.equal(story?.title, "Updated title");
    assert.equal(story?.description, "B");
    assert.equal(story?.status, "estimated");
    assert.equal(story?.agreedEstimate, "5");
  });

  it("skips invalid rows and counts them", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    const summary = await h.service.importStories(code, facilitatorId, {
      stories: [
        { key: "FPB-1", title: "Good", description: "" },
        { key: "", title: "Missing key", description: "" },
        { key: "FPB-2", title: "", description: "Missing title" },
        { title: "No key at all", description: "" },
        "not an object",
        { key: `X${"A".repeat(30)}`, title: "Key too long", description: "" },
      ],
    });

    assert.equal(summary.imported, 1);
    assert.equal(summary.invalidSkipped, 4);
    assert.equal(summary.limitSkipped, 0);
  });

  it("stops adding stories at the backlog limit", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);

    const batch = Array.from({ length: MAX_SESSION_STORIES }, (_, i) => ({
      key: `FPB-${i + 1}`,
      title: `Story ${i + 1}`,
      description: "",
    }));
    const first = await h.service.importStories(code, facilitatorId, { stories: batch });
    assert.equal(first.imported, MAX_SESSION_STORIES);

    const over = await h.service.importStories(code, facilitatorId, {
      stories: [
        { key: "FPB-OVER", title: "Too many", description: "" },
        { key: "FPB-OVER-2", title: "Also too many", description: "" },
        { key: "FPB-1", title: "Updated existing", description: "" },
      ],
    });
    assert.equal(over.imported, 0);
    assert.equal(over.limitSkipped, 2);
    assert.equal(over.duplicatesSkipped, 1);
    const room = await h.service.getRoom(code);
    assert.equal(room.stories.length, MAX_SESSION_STORIES);
  });

  it("rejects an import from a non-facilitator", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(
      h.service.importStories(code, joinerId, { stories: [{ key: "FPB-1", title: "Hi", description: "" }] }),
      (err: unknown) => err instanceof ApiError && err.code === "NOT_FACILITATOR",
    );
  });
});

describe("RoomService - start story estimation", () => {
  it("marks the story estimating and starts a round carrying it", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await h.service.importStories(code, facilitatorId, {
      stories: [{ key: "FPB-42", title: "Search", description: "Find" }],
    });

    const { round, story } = await h.service.startStoryEstimation(code, facilitatorId, "fpb-42");

    assert.equal(story.status, "estimating");
    assert.equal(round.story?.key, "FPB-42");
    assert.equal(round.status, "voting");

    const room = await h.service.getRoom(code);
    assert.equal(room.roundStatus, "voting");
    assert.equal(room.story?.key, "FPB-42");
    assert.equal(room.stories.find((s) => s.key === "FPB-42")?.status, "estimating");

    const started = h.pubsub.forRoom(code).find((e) => e.event.type === "round.started");
    assert.ok(started, "round.started event expects a story");
    assert.equal((started?.event as { story?: { key: string } }).story?.key, "FPB-42");
    const updated = h.pubsub.forRoom(code).find((e) => e.event.type === "stories.updated");
    assert.ok(updated, "stories.updated event expected");
  });

  it("rejects a start from a non-facilitator", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.importStories(code, facilitatorId, {
      stories: [{ key: "FPB-42", title: "Search", description: "" }],
    });
    await assert.rejects(
      h.service.startStoryEstimation(code, joinerId, "FPB-42"),
      (err: unknown) => err instanceof ApiError && err.code === "NOT_FACILITATOR",
    );
  });

  it("rejects starting a story that is not in the backlog", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await assert.rejects(
      h.service.startStoryEstimation(code, facilitatorId, "GHOST-1"),
      (err: unknown) => err instanceof ApiError && err.code === "STORY_NOT_FOUND",
    );
  });

  it("rejects starting an already-estimated story", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.importStories(code, facilitatorId, {
      stories: [{ key: "FPB-42", title: "Search", description: "" }],
    });
    await h.service.startStoryEstimation(code, facilitatorId, "FPB-42");
    await h.service.selectCard(code, facilitatorId, "5");
    await h.service.selectCard(code, joinerId, "5");
    await h.service.revealCards(code, facilitatorId);
    await h.service.recordAgreedEstimate(code, facilitatorId, "FPB-42", "5");

    await assert.rejects(
      h.service.startStoryEstimation(code, facilitatorId, "FPB-42"),
      (err: unknown) => err instanceof ApiError && err.code === "STORY_ALREADY_ESTIMATED",
    );
  });
});

describe("RoomService - record agreed estimate", () => {
  async function shell() {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.importStories(code, facilitatorId, {
      stories: [{ key: "FPB-42", title: "Search", description: "" }],
    });
    await h.service.startStoryEstimation(code, facilitatorId, "FPB-42");
    return { h, code, facilitatorId, joinerId };
  }

  it("records the estimate and prepares a story-free round", async () => {
    const { h, code, facilitatorId, joinerId } = await shell();
    await h.service.selectCard(code, facilitatorId, "5");
    await h.service.selectCard(code, joinerId, "8");
    await h.service.revealCards(code, facilitatorId);

    const { story } = await h.service.recordAgreedEstimate(code, facilitatorId, "fpb-42", "8");

    assert.equal(story.status, "estimated");
    assert.equal(story.agreedEstimate, "8");
    assert.ok(story.estimatedAt, "estimatedAt timestamp expected");

    const room = await h.service.getRoom(code);
    assert.equal(room.roundStatus, "voting");
    assert.equal(room.story, undefined, "next round is story-free");
    assert.equal(room.stories.find((s) => s.key === "FPB-42")?.agreedEstimate, "8");

    const startedEvents = h.pubsub
      .forRoom(code)
      .filter((e) => e.event.type === "round.started");
    assert.equal(startedEvents.length, 2, "one round for start, one for the next round");
    const latest = startedEvents[startedEvents.length - 1];
    assert.ok(latest, "latest round.started event expected");
    assert.equal((latest.event as { story?: unknown }).story, undefined);
    const updated = h.pubsub.forRoom(code).find((e) => e.event.type === "stories.updated");
    assert.ok(updated, "stories.updated event expected after recording");
  });

  it("requires a revealed round", async () => {
    const { h, code, facilitatorId } = await shell();
    await assert.rejects(
      h.service.recordAgreedEstimate(code, facilitatorId, "FPB-42", "5"),
      (err: unknown) => err instanceof ApiError && err.code === "VOTING_CLOSED",
    );
  });

  it("requires the story to be the current estimation story", async () => {
    const { h, code, facilitatorId, joinerId } = await shell();
    await h.service.selectCard(code, facilitatorId, "5");
    await h.service.selectCard(code, joinerId, "5");
    await h.service.revealCards(code, facilitatorId);
    await assert.rejects(
      h.service.recordAgreedEstimate(code, facilitatorId, "OTHER-1", "5"),
      (err: unknown) => err instanceof ApiError && err.code === "STORY_NOT_FOUND",
    );
  });

  it("requires a valid deck value", async () => {
    const { h, code, facilitatorId, joinerId } = await shell();
    await h.service.selectCard(code, facilitatorId, "5");
    await h.service.selectCard(code, joinerId, "5");
    await h.service.revealCards(code, facilitatorId);
    await assert.rejects(
      h.service.recordAgreedEstimate(code, facilitatorId, "FPB-42", "999"),
      (err: unknown) => err instanceof ApiError && err.code === "INVALID_CARD",
    );
  });

  it("only the facilitator may record the estimate", async () => {
    const { h, code, facilitatorId, joinerId } = await shell();
    await h.service.selectCard(code, facilitatorId, "5");
    await h.service.selectCard(code, joinerId, "5");
    await h.service.revealCards(code, facilitatorId);
    await assert.rejects(
      h.service.recordAgreedEstimate(code, joinerId, "FPB-42", "5"),
      (err: unknown) => err instanceof ApiError && err.code === "NOT_FACILITATOR",
    );
  });
});