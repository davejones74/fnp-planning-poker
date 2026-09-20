# fnp-planning-poker

Lightweight web-based **Scrum / Planning Poker** estimation app.

**Phase 1: complete local MVP.** Runs on Node's built-in HTTP + WebSocket server with an in-memory room store. No database, no auth, no cloud dependencies.

**Phase 2 (roadmap → on disk): free Azure hosting — deployed.** The local handlers
run as an Azure Functions v4 bundle (`api/dist/index.js` via `npm run build:api`);
the deployed bundle is **CommonJS** (Static Web Apps managed Functions load the
entry point with `require()`) and the front end declares
`"platform": { "apiRuntime": "node:20" }`. Rooms persist to Cosmos DB Table API when
`COSMOS_TABLE_CONNECTION_STRING` is set; realtime negotiates an Azure Web PubSub
endpoint, and the frontend `RealtimeClient` speaks the `json.webpubsub.azure.v1`
subprotocol. A GitHub Actions workflow (`azure-setup.ps1` +
`.github/workflows/azure-static-web-apps.yml`) deploys the stack to Azure Static Web
Apps (Free plan). See "Deploying to Azure" for the live URL and resource names.

## Features

- Create a room and get a short, human-friendly 6-character room code
- Others join with a display name and share the join link
- Joining again from the same browser, a new tab, or after a refresh restores the same
  session (the participant id is kept in `localStorage`); use **Rejoin** to come back
- **Capacity:** a room accepts up to 20 participants (all states, online and offline) —
  the Web PubSub **Free_F1** ceiling of 20 concurrent connections; the counter next to
  the player list shows `Players: N / 20`
- **Presence:** a green dot marks participants who are online, a red dot those who
  dropped off (updated by Web PubSub connect/disconnect events)
- **Kick:** the facilitator can remove a participant; their sockets are closed
  immediately and that browser is returned to the home screen
- Facilitator can set/edit the story (e.g. JIRA-123 + description)
- **Import stories into a session backlog** — the facilitator uploads a Jira CSV (or
  RSS/XML) export; issues are parsed in the browser (the file never leaves the machine),
  and the parsed stories are shown with a checkbox each (all selected) so you can import
  just the ones you want. Imported stories join the room's backlog, and each story links
  back to its Jira ticket via the configured site. Duplicate keys are refreshed in place,
  invalid rows are skipped, and the backlog is capped at 200 stories. Live Jira fetch
  (OAuth) is implemented but disabled in the UI until credentials are provided
- **Story-based estimation (optional)** — with stories in the backlog the facilitator can
  also add manual stories (synthetic `MAN-` keys), start one story at a time, and after
  reveal record the agreed estimate from a deck dropdown (coffee excluded). Recording
  moves the story to **Completed** and opens a fresh story-free round
- The story panel has **HOW IT WORKS / STORIES TO ESTIMATE / COMPLETED** tabs, an
  "Estimation session: n / total" progress bar, a **current-story banner** above the deck,
  a completed table (key, title, agreed estimate, completion time), a discussion
  prompt when revealed estimates differ, and — once the last story is estimated — it
  switches itself to the **COMPLETED** tab; the import caveats (snapshot only, no
  write-back, room-lifetime backlog) sit behind a small **info tooltip** so the guide
  stays skim-friendly
- Default deck: **XS, S, M, L, XL, XXL, ?, coffee** (coffee = break; see `shared/decks.ts` for the fibonacci alternative)
- Participants pick a card; only a ✓ (voted) status is visible to others
- Facilitator reveals the cards; the reveal replaces the deck with a **vote chart** — a
  donut of all vote values (`?` and coffee included) plus a coloured legend with counts
- **Outlier prompts:** once revealed, the members holding the **lowest** (optimistic)
  and **highest** (pessimistic) estimates are highlighted with a flat purple / yellow
  row tint and a left accent bar, plus a ▼ / ▲ marker after their name; ties resolve
  randomly preferring online members, and highlights are skipped when all estimates
  match
- A new round clears all selections
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
| `WEB_PUBSUB_CONNECTION_STRING` | empty | Azure Web PubSub (empty = in-memory) |
| `WEB_PUBSUB_HUB` | `fnp` | Web PubSub hub name all rooms connect through |
| `COSMOS_TABLE_CONNECTION_STRING` | empty | Cosmos DB Table API connection string; empty = in-memory `RoomRepository` |
| `WEBSITE_HOSTNAME` | empty | Azure-assigned hostname (used to build absolute URLs) |
| `JIRA_HOST` | `https://hmcts.atlassian.net` | Base site for imported issues; a key links to `<JIRA_HOST>/browse/<KEY>` |
| `KEY` / `JIRA_PROJECT_KEY` | empty | Project prefix used to filter imported issues (`KEY=PAY`); `JIRA_PROJECT_KEY` wins when both are set |
| `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` | empty | Jira Cloud OAuth app credentials for the (currently disabled) live fetch |
| `JIRA_REDIRECT_URI` | `http://localhost:8080/api/jira/callback` | Callback URL of the OAuth app; must match what the browser hits |
| `JIRA_MOCK` | empty | `1` returns canned stories and a fake consent page so the UI works without an Atlassian app |

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
| `PUT` | `/api/rooms/{code}/story` | Facilitator-only; `{ participantId, title, description, key?, url? }` |
| `POST` | `/api/rooms/{code}/stories/import` | Facilitator-only; `{ participantId, stories: [{ key, title, description, url? }] }` → upserts the backlog and returns `{ imported, duplicatesSkipped, invalidSkipped, limitSkipped, stories }` |
| `POST` | `/api/rooms/{code}/stories/{key}/start` | Facilitator-only; marks the story `estimating` and starts a voting round carrying it |
| `POST` | `/api/rooms/{code}/stories/{key}/estimate` | Facilitator-only; `{ participantId, estimate }` — revealed round + valid deck value, records the agreed estimate and opens a story-free round |
| `POST` | `/api/rooms/{code}/participants/remove` | Facilitator-only; `{ participantId, targetParticipantId }` |
| `GET` | `/api/config` | Non-secret client config `{ jiraHost, jiraProjectKey }` used by the import dialog |
| `GET` | `/api/jira/authorize?room=&returnTo=` | Opens the Atlassian consent screen in a popup (mock consent page when `JIRA_MOCK=1`) |
| `GET` | `/api/jira/callback` | OAuth callback; exchanges the code and tells the opener via `postMessage` |
| `GET` | `/api/jira/status?code=&participantId=` | Whether a Jira connection exists and the room's last-used feed link |
| `POST` | `/api/jira/feed` | Facilitator-only; `{ roomCode, participantId, feedUrl? }` → `{ ok, stories, feedUrl }`; omitted `feedUrl` reuses the room's last-used link |
| `GET` | `/api/negotiate` | Returns `{ url }` for the WebSocket, e.g. `ws://host/ws` |
| `GET` | `/api/me` | `{ authenticated, isAdmin, identity }` (placeholder until auth) |
| `GET` | `/api/health` | Availability probe (the local dev server also serves `/health`) |

For anything with `participantId`, the server re-validates the participant exists in
the room and the sender is allowed to act (e.g. only the facilitator may reveal). The
client is never trusted.

## Importing stories

"Import stories" (visible to the facilitator in the story panel) parses a **Jira export
entirely in the browser** — the file is never uploaded:

1. In Jira, export the saved filter / board as **CSV** (`Export` → `Export CSV (all
   fields)`) or grab its **RSS/XML** feed, then pick the file in the import dialog.
2. The format is sniffed automatically (`frontend/src/import/`). CSV columns are located
   by header (`Summary`, `Issue key`, `Description`), quotes/newlines/CRLF are handled,
   and Jira wiki markup is flattened to plain text (descriptions truncated to 500 chars).
   For XML both the per-issue XML view and the RSS feed are understood. RSS/XML
   descriptions are cleaned from HTML (style/script blocks dropped, the `#descriptionArea`
   section preferred). Key comes from a
   `<key>` element, a `/browse/KEY` link or the title.
3. A filter's RSS is an **activity feed** (it lists comments). Those comment items are
   skipped, and when nothing usable is found the dialog suggests the CSV export instead.
4. The parsed stories are listed with a checkbox each (all selected); uncheck any you
   want to leave out, or use **Select all / None**, then import the checked ones.
5. Imported issues are added to the room's **session backlog** (upsert by issue key,
   preserving each story's status and any recorded estimate). Every story's key links to
   `<JIRA_HOST>/browse/<KEY>`, and `KEY` (or `JIRA_PROJECT_KEY`) filters the list to a
   single project. From the backlog the facilitator starts one story at a time for the
   room to estimate.

Live fetch (below) is disabled in the UI for now; the file path needs no Atlassian
credentials.

## Jira import (live OAuth fetch — disabled)

The OAuth version of the import is implemented but hidden behind the disabled UI: it
authenticates with **Jira Cloud OAuth 2.0 (3-legged)**.

1. The facilitator pastes a link from Jira — a saved filter (`.../issues/?filter=18527`),
   a JQL search (`.../issues/?jql=...`), or its base64 form — into the import dialog.
2. If no app token exists yet, a popup opens to Atlassian's consent screen. The
   callback page (`/api/jira/callback`) exchanges the code and reports back to the room
   via `postMessage`; a 10-minute state token guards the callback.
3. Server-side, the link is parsed into `site` + JQL/filter, and stories are fetched
   from the Jira API with a refresh-token retry on expiry.

Phase 1 uses one shared app-level token (the last consent wins), and the OAuth app
must be registered at developer.atlassian.com (free). For a no-credentials test drive
set `JIRA_MOCK=1` — the authorize endpoint shows a mock consent page and the feed
returns canned stories, so the whole UI flow works end to end.

## Realtime protocol (`/ws`)

The client connects to the URL from `/api/negotiate` and sends:

```json
{ "type": "connect", "roomCode": "3FCP9E", "participantId": "p_xxx" }
```

The server binds the socket to the room and starts broadcasting room events:
`participant.joined`, `participant.left`, `participant.updated` (presence),
`card.selected` (contains **only** `{ participantId, hasSelected }` — never the card
value), `cards.revealed` (full selections), `round.started` (carries the current story
when one is active), `story.updated`, `stories.updated` (full session backlog — the
client replaces its list).

## Security invariants

- **Card values are never broadcast before reveal** — `card.selected` carries no value; the room snapshot hides all cards but the requester's own.
- **Facilitator actions are enforced server-side** — the `isFacilitator` flag can't be set by a client.
- **All input validated server-side** — room codes, display names (1–30), story key (1–20) / title (1–100) / description (0–500) / url (0–500), and card values; the session backlog is capped at 200 stories.

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
`npm ci && npm run build`, then `Azure/static-web-apps-deploy` publishes the prebuilt
front end (`app_location=dist/frontend`, `skip_app_build=true`) and the managed
Functions API from `api` (`api_location=api`). Preview environments per PR come for
free on the SWA free plan.

### Phase 2 work items

- [x] 1. **Functions host** — `api/package.json` + `@azure/functions` entry; `scripts/build-api.mjs`
  bundles all handlers into `api/dist/index.js` as **CommonJS** (a nested
  `dist/package.json` keeps `api/package.json` ESM for local dev), so SWA managed
  Functions run them as-is.
- [x] 2. **Durable repository** — `CosmosTableRoomRepository` implementing `RoomRepository`
  (swap in `api/src/services/index.ts`).
- [x] 3. **Web PubSub realtime** — `negotiate` returns the Azure endpoint + token; the frontend
  `RealtimeClient` speaks the `json.webpubsub.azure.v1` subprotocol (join group, envelope
  parsing, pings, renegotiation on reconnect). Local dev still uses the in-process `ws` server.
- [ ] 4. **Auth** — SWA built-in auth provider config + real `me()`; identity `displayName`
  flows into room creation/join. (Not started — out of scope until asked.)
- [x] 5. **CI/CD** — `.github/workflows/azure-static-web-apps.yml` builds and deploys on push
  to `master`; PR previews come free with the SWA Free plan.
- [x] 6. **Frontend negotiate** — `roomsApi.negotiate(code, participantId)` returns
  `{ url, protocol, group }`, parsed by the Azure `RealtimeClient`.

### Deploying to Azure ($0/mo)

**Live deployment (access details)**

| Item | Value |
| --- | --- |
| Custom domain (managed TLS) | https://planning-poker.runningcode.dev |
| Public URL (SWA default) | https://salmon-glacier-03161df0f.6.azurestaticapps.net |
| API health check | https://salmon-glacier-03161df0f.6.azurestaticapps.net/api/health |
| Resource group | `planning-poker` |
| Static Web App (Free) | `fnppokerswa` — East US 2 |
| Cosmos DB Table API (free tier) | `fnppokercosmos` |
| Web PubSub (Free_F1, hub `fnp`) | `fnppokerwps` |
| Deployment token | GitHub Actions secret `AZURE_STATIC_WEB_APPS_API_TOKEN` (never commit its value) |

1. Run `./azure-setup.ps1` in Azure Cloud Shell (PowerShell) — it creates the resource
   group, a Cosmos DB Table API account, a Web PubSub **Free_F1** instance and a Static
   Web App, wires the connection strings into the SWA app settings
   (`COSMOS_TABLE_CONNECTION_STRING`, `WEB_PUBSUB_CONNECTION_STRING`, `WEB_PUBSUB_HUB`),
   configures the Web PubSub hub event handler (see below) and prints the SWA
   **deployment token**.
   > **Hub event handler (required for presence):** the hub must deliver
   > `system-event=connected` / `system-event=disconnected` to
   > `https://<swa-host>/api/pubsub/events`, with `--allow-anonymous false`.
   > Without it clients connect fine but every participant stays "online" forever.
   > Verify with `az webpubsub hub list -n fnppokerwps -g planning-poker` (must not be
   > `[]`). To apply it to an existing deployment:
   > `az webpubsub hub update --name fnppokerwps -g planning-poker --hub-name fnp --allow-anonymous false --event-handler "url-template=https://<swa-host>/api/pubsub/events" "system-event=connected" "system-event=disconnected"`.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   named `AZURE_STATIC_WEB_APPS_API_TOKEN` with that token as the value
   (do **not** commit the token).
3. Push to `master`. `.github/workflows/azure-static-web-apps.yml` runs
   `npm ci && npm run build` (typecheck + bundle both sides) and deploys
   `dist/frontend` + `api` via `Azure/static-web-apps-deploy`.

> **Managed Functions gotcha:** SWA only deploys the API when it can determine the
> runtime language/version — it reads `platform.apiRuntime` from
> `frontend/public/staticwebapp.config.json` (set to `node:20`). The entry bundle must
> also be CommonJS, because the managed Functions host loads `main` with `require()`;
> an ESM (`"type": "module"`) entry fails to index and every `/api/*` route returns 404
> even though the deploy is green.

The SWA **Free** plan (2026) includes the managed Functions API (1M executions/mo),
100 GB bandwidth/mo and 3 preview environments. Web PubSub F1 caps at 20 concurrent
connections / 20k messages/day, and Cosmos free tier at 1000 RU/s / 25 GB — a small
squad room stays comfortably inside all of them. Rooms expire after `ROOM_EXPIRY_HOURS`
of inactivity (default 24h), keeping Cosmos usage tiny.

### Phase 3 (only if it grows past free caps)

- SWA **Standard** plan (move from service-defined to custom auth) and/or bring your
  own Functions app; Web PubSub **Standard** (first 1M messages/day free per unit);
  or move the whole HTTP+WS path onto Azure Container Apps. All changes happen behind
  the existing `RoomRepository` / pub-sub seams.

No paid timelines are required to keep the app running — the subscription cost for the
Phase 2 stack is $0 unless traffic exceeds the free quotas above.