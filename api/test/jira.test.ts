import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/shared/errors.ts";
import {
  parseFeedUrl,
  extractStoryDescription,
  mapStories,
  createOAuthState,
  consumeOAuthState,
} from "../src/services/jira.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("Jira - parseFeedUrl", () => {
  it("accepts a saved filter link", () => {
    const query = parseFeedUrl(
      "https://hmcts.atlassian.net/issues/?filter=18527&atlOrigin=eyJpIjoiY2VmMTRlMTUwYzRlNDY4MTliZTVjYTIxYTA4NjE0MjIiLCJwIjoiaGRiLXJvb20tMTA0In0",
    );
    assert.equal(query.site, "https://hmcts.atlassian.net");
    assert.equal(query.filterId, "18527");
    assert.equal(query.jql, undefined);
  });

  it("accepts a jql link and keeps the raw query", () => {
    const query = parseFeedUrl(
      "https://acme.atlassian.net/issues/?jql=project%20%3D%20%22FPB%22%20AND%20status%20!%3D%20Done",
    );
    assert.equal(query.site, "https://acme.atlassian.net");
    assert.match(query.jql ?? "", /project = "FPB"/);
  });

  it("decodes a jqlBase64 link", () => {
    const jql = "project = FPB order by created DESC";
    const encoded = Buffer.from(jql, "utf8").toString("base64");
    const query = parseFeedUrl(`https://acme.atlassian.net/issues/?jqlBase64=${encoded}`);
    assert.equal(query.jql, jql);
  });

  it("requires https and a host", () => {
    for (const bad of [
      "http://acme.atlassian.net/issues/?filter=1",
      "",
      "not a url",
      "https:///issues/?filter=1",
    ]) {
      assert.throws(() => parseFeedUrl(bad), (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "INVALID_FEED";
      });
    }
  });

  it("rejects a link without filter or jql", () => {
    assert.throws(
      () => parseFeedUrl("https://acme.atlassian.net/issues/?atlOrigin=abc"),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "INVALID_FEED";
      },
    );
  });
});

describe("Jira - description extraction", () => {
  it("extracts a plain string description", () => {
    assert.equal(extractStoryDescription("  Plain text.  "), "Plain text.");
  });

  it("walks ADF JSON content", () => {
    const adf = {
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First para" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "text", text: "Point one" }] },
          ],
        },
      ],
    };
    assert.equal(extractStoryDescription(adf), "First para Point one");
  });

  it("returns empty for missing or invalid descriptions", () => {
    assert.equal(extractStoryDescription(undefined), "");
    assert.equal(extractStoryDescription(null), "");
    assert.equal(extractStoryDescription(42), "");
  });
});

describe("Jira - mapStories", () => {
  const issues = [
    { key: "FPB-101", fields: { summary: "  Create a room  ", description: "A." } },
    { key: "FPB-102", fields: { summary: "" } },
    { fields: { summary: "Missing key" } },
  ];

  it("maps issues into {key, title, description, url}", () => {
    const stories = mapStories(issues as never, "https://acme.atlassian.net");
    assert.equal(stories.length, 2);
    assert.equal(stories[0]!.key, "FPB-101");
    assert.equal(stories[0]!.title, "FPB-101 - Create a room");
    assert.equal(stories[0]!.description, "A.");
    assert.equal(stories[0]!.url, "https://acme.atlassian.net/browse/FPB-101");
    assert.equal(stories[1]!.title, "FPB-102 - FPB-102");
  });
});

describe("Jira - oauth state", () => {
  it("consumes a state entry once", () => {
    const state = createOAuthState("ABCDEF", "/room/ABCDEF");
    const entry = consumeOAuthState(state);
    assert.equal(entry?.room, "ABCDEF");
    assert.equal(entry?.returnTo, "/room/ABCDEF");
    assert.equal(consumeOAuthState(state), null);
  });

  it("rejects unknown state", () => {
    assert.equal(consumeOAuthState("nope"), null);
  });
});

describe("RoomService - jira feed url + story link", () => {
  it("stores and reads the last-used feed url for the facilitator", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.setJiraFeedUrl(code, facilitatorId, "https://acme.atlassian.net/issues/?filter=7");
    assert.equal(
      await h.service.getJiraFeedUrl(code, facilitatorId),
      "https://acme.atlassian.net/issues/?filter=7",
    );
    await assert.rejects(
      h.service.getJiraFeedUrl(code, joinerId),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "NOT_FACILITATOR";
      },
    );
  });

  it("keeps the jira key and link on the story", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    const story = await h.service.updateStory(code, facilitatorId, {
      title: "FPB-101 - Create a room",
      description: "A.",
      key: "FPB-101",
      url: "https://acme.atlassian.net/browse/FPB-101",
    });
    assert.equal(story.key, "FPB-101");
    assert.equal(story.url, "https://acme.atlassian.net/browse/FPB-101");
    const room = await h.service.getRoom(code);
    assert.equal(room.story?.key, "FPB-101");
    assert.equal(room.story?.url, "https://acme.atlassian.net/browse/FPB-101");
  });
});