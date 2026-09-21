import { app } from "@azure/functions";
import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { wrap, type HttpHandler } from "./shared/http.ts";

import { createRoom } from "./functions/createRoom.ts";
import { getRoom } from "./functions/getRoom.ts";
import { getParticipants } from "./functions/getParticipants.ts";
import { joinRoom } from "./functions/joinRoom.ts";
import { vote } from "./functions/vote.ts";
import { reveal } from "./functions/reveal.ts";
import { newRound } from "./functions/newRound.ts";
import { updateStory } from "./functions/updateStory.ts";
import { importStories } from "./functions/importStories.ts";
import { startStoryEstimation } from "./functions/startStoryEstimation.ts";
import { recordAgreedEstimate } from "./functions/recordAgreedEstimate.ts";
import { removeParticipant } from "./functions/removeParticipant.ts";
import { leaveRoom } from "./functions/leaveRoom.ts";
import { presence } from "./functions/presence.ts";
import { negotiate } from "./functions/negotiate.ts";
import { pubsubEvents } from "./functions/pubsubEvents.ts";
import { me } from "./functions/me.ts";
import { health } from "./functions/health.ts";
import { jiraAuthorize } from "./functions/jiraAuthorize.ts";
import { jiraCallback } from "./functions/jiraCallback.ts";
import { jiraStatus } from "./functions/jiraStatus.ts";
import { jiraFeed } from "./functions/jiraFeed.ts";
import { clientConfig } from "./functions/config.ts";

/**
 * Azure Functions v4 (Node) entry point, used by Static Web Apps' managed
 * Functions backend. The existing handlers live in api/src/functions as plain
 * `(request: Request) => Promise<Response>` web-style functions; this module
 * bridges them onto the Azure HTTP trigger surface:
 *
 *   - `azureRequest.ToFetchRequest` rebuilds a standard `Request` so every
 *     handler, and `wrap`'s ApiError handling, works unchanged;
 *   - the `Response` returned by a handler is then converted back to the
 *     `HttpResponseInit` shape the Functions runtime expects.
 *
 * Routes match the local server's table (api/src/server.ts) exactly:
 * everything under `/api`, plus the Web PubSub upstream handler at
 * `/api/pubsub/events`.
 */
function toAzure(handler: HttpHandler) {
  return async (request: HttpRequest): Promise<HttpResponseInit> =>
    runHandler(handler, request);
}

async function runHandler(
  handler: HttpHandler,
  azureRequest: HttpRequest,
): Promise<HttpResponseInit> {
  const request = await toFetchRequest(azureRequest);
  const response = await handler(request);
  return toHttpResponseInit(response);
}

async function toFetchRequest(azureRequest: HttpRequest): Promise<Request> {
  const headers = new Headers(azureRequest.headers);
  // Delegate framing/masking to the Fetch implementation we rebuild the
  // Request with; the proxy-set host header would otherwise be duplicated.
  headers.delete("host");
  headers.delete("content-length");

  const method = azureRequest.method;
  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const text = await azureRequest.text();
    if (text.length > 0) body = text;
  }

  return new Request(azureRequest.url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

async function toHttpResponseInit(response: Response): Promise<HttpResponseInit> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return {
    status: response.status,
    headers,
    body: await response.arrayBuffer(),
  };
}

app.http("createRoom", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms",
  handler: toAzure(wrap(createRoom)),
});

app.http("getRoom", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "rooms/{code}",
  handler: toAzure(wrap(getRoom)),
});

app.http("getParticipants", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "rooms/{code}/participants",
  handler: toAzure(wrap(getParticipants)),
});

app.http("joinRoom", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/join",
  handler: toAzure(wrap(joinRoom)),
});

app.http("vote", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/vote",
  handler: toAzure(wrap(vote)),
});

app.http("reveal", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/reveal",
  handler: toAzure(wrap(reveal)),
});

app.http("newRound", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/round",
  handler: toAzure(wrap(newRound)),
});

app.http("updateStory", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "rooms/{code}/story",
  handler: toAzure(wrap(updateStory)),
});

app.http("importStories", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/stories/import",
  handler: toAzure(wrap(importStories)),
});

app.http("startStoryEstimation", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/stories/{key}/start",
  handler: toAzure(wrap(startStoryEstimation)),
});

app.http("recordAgreedEstimate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/stories/{key}/estimate",
  handler: toAzure(wrap(recordAgreedEstimate)),
});

app.http("removeParticipant", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/participants/remove",
  handler: toAzure(wrap(removeParticipant)),
});

app.http("leaveRoom", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/participants/leave",
  handler: toAzure(wrap(leaveRoom)),
});

app.http("participantPresence", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rooms/{code}/participants/presence",
  handler: toAzure(wrap(presence)),
});

app.http("negotiate", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "negotiate",
  handler: toAzure(wrap(negotiate)),
});

// OPTIONS must be listed so Web PubSub's CloudEvents abuse-protection
// handshake reaches the handler instead of the Functions host answering 404.
app.http("pubsubEvents", {
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "pubsub/events",
  handler: toAzure(wrap(pubsubEvents)),
});

app.http("me", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "me",
  handler: toAzure(wrap(me)),
});

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: toAzure(wrap(health)),
});

app.http("jiraAuthorize", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "jira/authorize",
  handler: toAzure(wrap(jiraAuthorize)),
});

app.http("jiraCallback", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "jira/callback",
  handler: toAzure(wrap(jiraCallback)),
});

app.http("jiraStatus", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "jira/status",
  handler: toAzure(wrap(jiraStatus)),
});

app.http("jiraFeed", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "jira/feed",
  handler: toAzure(wrap(jiraFeed)),
});

app.http("clientConfig", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "config",
  handler: toAzure(wrap(clientConfig)),
});