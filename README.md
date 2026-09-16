# fnp-planning-poker

Lightweight web-based **Scrum / Planning Poker** estimation app.

**Phase 1 (current): complete local MVP.** Runs on Node's built-in HTTP + WebSocket server with an in-memory room store. No database, no auth, no cloud dependencies.

## Features

- Create a room and get a short, human-friendly 6-character room code
- Others join with a display name and share the join link
- Joining again from the same browser (or after a refresh) restores the same session
- Facilitator can set/edit the story (e.g. JIRA-123 + description)
- Default deck: **XS, S, M, L, XL, XXL, ?, coffee** (coffee = break; see `shared/decks.ts` for the fibonacci alternative)
- Participants pick a card; only a ✓ (voted) status is visible to others
- Facilitator reveals the cards; a new round clears all selections
- Participants leaving are marked offline in real time
- Room running time (and each player's time in the room) is shown live
- Realtime updates via WebSocket; the client auto-reconnects with backoff

## Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│  Browser (vanilla TS)       │  WS    │  Node server                          │
│  frontend/src/**            │◄──────►│  api/src/server.ts                    │
│  - app.ts (router)          │  /ws   │  - HTTP /api + static hosting        │
│  - state/room-state.ts      │        │  - WebSocket presence                │
│  - realtime/client.ts       │        │  api/src/services/RoomService.ts     │
│  - api/* (fetch client)     │  HTTP   │  - business rules + validation       │
│  - components/*             │ /api   │  - InMemoryRoomRepository (swap later)│
│                             │        │  - InMemoryPubSubService             │
└─────────────────────────────┘        └──────────────────────────────────────┘
     shared/types.ts, shared/decks.ts, shared/validation.ts  (used by both)
```

- **`frontend/src`** — vanilla TypeScript/DOM, bundled into a single IIFE by esbuild.
- **`api/src`** — the server. Each endpoint is a `(request) => Response` handler in
  `api/src/functions/`, written in an Azure-Functions-friendly shape so Phase 3 can move
  them largely as-is. The realtime transport is an `ws` server bound to the same HTTP
  instance.
- **`shared/`** — types, the deck catalog, and validation rules shared by both sides.
- Node runs the server directly via its built-in TypeScript type-stripping support
  (Node ≥ 22.6 / 24); no tsx or bundler is used for the server.

## Project layout

```
shared/                  Shared types, decks, validation
api/src/server.ts        Local dev server: HTTP + WebSocket + static hosting
api/src/functions/       One file per HTTP endpoint (create, join, vote, reveal, ...)
api/src/services/        RoomService (domain), repositories, pub/sub, config
api/test/                node:test suites
frontend/index.html      App shell
frontend/styles/         Vanilla CSS
frontend/src/app.ts      Entry point + routing
frontend/src/api/        HTTP client (rooms, users)
frontend/src/realtime/   WebSocket client + event guards
frontend/src/state/      Client-side room/app state
frontend/src/components/ header, home, room, estimation-deck, players-panel, story-panel
scripts/build.mjs        esbuild bundle + static copy into dist/frontend
```

## Requirements

- Node.js **≥ 24** (uses TypeScript type-stripping and `node --test`)

## Setup & commands

```bash
npm install        # installs ws (runtime) + typescript/esbuild (dev)
npm run dev        # typechecks + builds frontend, starts server on :8080
npm test           # runs api/test/*.test.ts via node --test
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + bundle frontend to dist/frontend
```

On some Windows shells `npm` may resolve to `npm.ps1` and be blocked by Execution
Policy; use `npm.cmd` instead.

Open http://localhost:8080, create a room, then share the room URL.

> Windows gotcha: keep file names case-consistent. The filesystem is
> case-insensitive, so `RoomService.ts` and `roomService.ts` refer to the same file.

## Environment variables

Copied from `.env.example`; the app reads them from the process environment. The dev
scripts do **not** load a `.env` file automatically — either set them in your shell or
run with `node --env-file=.env api/src/server.ts`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Local dev server port (Azure Functions ignore this) |
| `ROOM_EXPIRY_HOURS` | `24` | Rooms are auto-expired after this long without activity |
| `DEFAULT_DECK` | `fandp` | Deck key from `shared/decks.ts` (`fandp` = XS…coffee, or `fibonacci`) |
| `ADMIN_USERS` | empty | Comma-separated identities allowed to administer (Phase 1: informational) |
| `WEB_PUBSUB_CONNECTION_STRING` | empty | Azure Web PubSub (used from Phase 2; empty = in-memory) |
| `WEBSITE_HOSTNAME` | empty | Azure-assigned hostname (used to build absolute URLs) |

## API

All endpoints are under `/api`. Errors are `{ "error": { "code": ..., "message": ... } }`
with the matching HTTP status. Room codes use the alphabet
`ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no I/L/O/0/1).

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/rooms` | `{ displayName }` → creates a room, caller becomes facilitator |
| `POST` | `/api/rooms/{code}/join` | `{ displayName, participantId? }` → join, or resume the same participant |
| `GET` | `/api/rooms/{code}?participantId=` | Public room snapshot; `self` reveals only your own card |
| `GET` | `/api/rooms/{code}/participants` | Participant list (cards hidden) |
| `POST` | `/api/rooms/{code}/vote` | `{ participantId, card }` — card must be in the room's deck |
| `POST` | `/api/rooms/{code}/reveal` | Facilitator-only; publishes `cards.revealed` |
| `POST` | `/api/rooms/{code}/round` | Facilitator-only; clears selections, new round |
| `PUT` | `/api/rooms/{code}/story` | Facilitator-only; `{ participantId, title, description }` |
| `POST` | `/api/rooms/{code}/participants/remove` | Facilitator-only; `{ participantId, targetParticipantId }` |
| `GET` | `/api/negotiate` | Returns `{ url }` for the WebSocket, e.g. `ws://host/ws` |
| `GET` | `/api/me` | `{ authenticated, isAdmin, identity }` (placeholder until auth) |
| `GET` | `/health` | Availability probe |

For anything with `participantId`, the server re-validates the participant exists in
the room and the sender is allowed to act (e.g. only the facilitator may reveal). The
client is never trusted.

## Realtime protocol (`/ws`)

The client connects to the URL from `/api/negotiate` and sends:

```json
{ "type": "connect", "roomCode": "3FCP9E", "participantId": "p_xxx" }
```

The server binds the socket to the room and starts broadcasting room events:
`participant.joined`, `participant.left`, `participant.updated` (presence),
`card.selected` (contains **only** `{ participantId, hasSelected }` — never the card
value), `cards.revealed` (full selections), `round.started`, `story.updated`.

## Security invariants

- **Card values are never broadcast before reveal** — `card.selected` carries no value; the room snapshot hides all cards but the requester's own.
- **Facilitator actions are enforced server-side** — the `isFacilitator` flag can't be set by a client.
- **All input validated server-side** — room codes, display names (1–30), story title (1–100) / description (0–500), and card values.

## Known limitations (Phase 1)

- Rooms live **in process memory only**. Restarting the server loses every room; a 404
  (`ROOM_EXPIRIED`/`NOT_FOUND`) is returned once they are gone. Swapped out in Phase 2.
- No authentication; anyone with the room code can join. Admin identity (`/api/me`)
  is a placeholder until SWA auth is wired up in Phase 2.
- Single-server; no horizontal scaling while on the local dev server.

## Roadmap — free Azure hosting (Phase 2, target $0/mo)

The goal is the full stack on **free-tier Azure services only**, with the existing
`RoomService` and `(request) => Response` handlers reused as-is where possible. The
composition root in `api/src/services/index.ts` is the single place to swap
implementations.

| Tier | Azure Free option (2026) | What it gives us |
| --- | --- | --- |
| SPA hosting + API | **Azure Static Web Apps — Free plan** | Serves `dist/frontend` (immutable `index.html` SPA + assets); managed Functions API included in the **1M free executions/mo**; 100 GB bandwidth/sub/mo; 2 custom domains; 3 preview apps for PRs |
| Authentication | **SWA built-in auth** (service-defined providers) | No auth code in the app: GitHub / Entra ID / Google / X logins via `staticwebapp.config.json`; Functions read `x-ms-client-principal` so `/api/me` becomes real, and the display name comes from the identity |
| Realtime (WebSockets) | **Azure Web PubSub — Free (F1)** | Managed WebSocket broker; `negotiate` issues a token, clients connect directly to `wss://…/client/hubs`; Functions bindings publish events. **Caps: 20 concurrent connections and 20k messages/day** — fine for a small squad, hard ceiling beyond |
| Durable rooms & presence | **Azure Cosmos DB — Free tier** (1000 RU/s, 25 GB) | New `RoomRepository` impl via `@azure/data-tables` (Table API) replaces `InMemoryRoomRepository`; room 24h expiry keeps usage tiny; `pubsub` swaps to the Web PubSub service |

**Deployment & CI/CD — GitHub Actions**: a workflow runs
`npm ci && npm run build`, then `Azure/static-web-apps-deploy` publishes
`output_location=dist/frontend` and the managed Functions API. Preview
environments per PR come for free on the SWA free plan.

### Phase 2 work items

1. **Functions host** — add `api/package.json` + `@azure/functions` entry so SWA
   managed Functions can run the existing handlers (they already match the
   `(request) => Response` shape).
2. **Durable repository** — `CosmosTableRoomRepository` implementing `RoomRepository`
   (swap in `api/src/services/index.ts`).
3. **Web PubSub realtime** — `negotiate` returns the Azure endpoint + token; server
   goes serverless (no `ws` server, no in-memory PubSub); the frontend
   `RealtimeClient` speaks the `json.webpubsub.azure.v1` subprotocol with per-room
   groups; presence driven by connect/disconnect CloudEvents.
4. **Auth** — SWA `staticwebapp.config.json` provider config + real `me()`; identity
   `displayName` flows into room creation/join.
5. **CI/CD** — GitHub Actions workflow + preview environments.
6. **Frontend** — `roomsApi.negotiate()` already returns `{ url }`; extend it to carry
   the token and endpoint for the Azure client.

### Phase 3 (only if it grows past free caps)

- SWA **Standard** plan (move from service-defined to custom auth) and/or bring your
  own Functions app; Web PubSub **Standard** (first 1M messages/day free per unit);
  or move the whole HTTP+WS path onto Azure Container Apps. All changes happen behind
  the existing `RoomRepository` / pub-sub seams.

No paid timelines are required to keep the app running — the subscription cost for the
Phase 2 stack is $0 unless traffic exceeds the free quotas above.