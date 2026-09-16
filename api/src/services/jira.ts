import { ApiError } from "../shared/errors.ts";
import type { Configuration } from "../config/configuration.ts";
import { STORY_DESCRIPTION_MAX } from "../../../shared/validation.ts";

export interface JiraResource {
  id: string;
  site: string;
  name: string;
}

export interface JiraToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  resources: JiraResource[];
}

export interface JiraFeedQuery {
  site: string;
  jql?: string;
  filterId?: string;
}

export interface JiraStory {
  key: string;
  title: string;
  description: string;
  url: string;
}

interface JiraIssue {
  key?: string;
  fields?: {
    summary?: string;
    description?: unknown;
  };
}

type FetchLike = typeof fetch;

class InMemoryJiraTokenStore {
  private token: JiraToken | null = null;

  get(): JiraToken | null {
    return this.token;
  }

  set(token: JiraToken): void {
    this.token = token;
  }

  clear(): void {
    this.token = null;
  }
}

const AUTH_BASE = "https://auth.atlassian.com";
const API_BASE = "https://api.atlassian.com";
const SCOPES = "offline_access read:jira-work";

export const jiraTokenStore = new InMemoryJiraTokenStore();

// ── OAuth state (short-lived CSRF guard for the callback) ────────────────────

interface OAuthState {
  room: string;
  returnTo: string;
  createdAt: number;
}

const oauthStates = new Map<string, OAuthState>();
const STATE_TTL_MS = 10 * 60_000;
const STATE_MAX = 200;

export function createOAuthState(room: string, returnTo: string): string {
  const state =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  oauthStates.set(state, { room, returnTo, createdAt: Date.now() });
  if (oauthStates.size > STATE_MAX) {
    const oldest = oauthStates.keys().next().value;
    if (typeof oldest === "string") oauthStates.delete(oldest);
  }
  return state;
}

export function consumeOAuthState(state: string): OAuthState | null {
  const entry = oauthStates.get(state);
  if (!entry) return null;
  oauthStates.delete(state);
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
  return entry;
}

export function parseFeedUrl(raw: unknown): JiraFeedQuery {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ApiError(
      "INVALID_FEED",
      400,
      "A Jira link is required (saved filter or JQL search URL).",
    );
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ApiError("INVALID_FEED", 400, "The Jira link is not a valid URL.");
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) {
    throw new ApiError("INVALID_FEED", 400, "The Jira link must use https.");
  }

  const query: JiraFeedQuery = { site: url.origin };
  const jql = url.searchParams.get("jql");
  const jqlBase64 = url.searchParams.get("jqlBase64");
  const filterId = url.searchParams.get("filter");

  if (jql && jql.trim()) {
    query.jql = jql;
  } else if (jqlBase64 && jqlBase64.trim()) {
    try {
      query.jql = Buffer.from(jqlBase64, "base64").toString("utf8");
    } catch {
      throw new ApiError("INVALID_FEED", 400, "The Jira link contains an invalid jqlBase64 value.");
    }
  } else if (filterId && /^\d+$/.test(filterId)) {
    query.filterId = filterId;
  }

  if (!query.jql && !query.filterId) {
    throw new ApiError(
      "INVALID_FEED",
      400,
      "The Jira link must contain a saved filter (filter=) or a JQL query (jql=).",
    );
  }
  return query;
}

function truncated(text: string): string {
  return text.length > STORY_DESCRIPTION_MAX
    ? `${text.slice(0, STORY_DESCRIPTION_MAX - 1)}…`
    : text;
}

/** Jira can return descriptions as ADF JSON or a plain string. Collects text. */
export function extractStoryDescription(value: unknown): string {
  if (typeof value === "string") return truncated(value.trim());
  if (!value || typeof value !== "object") return "";
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as { text?: unknown; content?: unknown };
    if (typeof record.text === "string" && record.text.trim()) {
      parts.push(record.text.trim());
    }
    if (Array.isArray(record.content)) {
      for (const child of record.content) walk(child);
    }
  };
  walk(value);
  return truncated(parts.join(" "));
}

export function mapStories(issues: JiraIssue[], site: string): JiraStory[] {
  return issues
    .filter((issue) => typeof issue.key === "string")
    .map((issue) => {
      const key = issue.key as string;
      const summary = (issue.fields?.summary ?? "").trim() || key;
      return {
        key,
        title: `${key} - ${summary}`,
        description: extractStoryDescription(issue.fields?.description),
        url: `${site}/browse/${encodeURIComponent(key)}`,
      };
    });
}

export class JiraClient {
  private readonly config: Configuration;
  private readonly store: { get(): JiraToken | null; set(t: JiraToken): void; clear(): void };
  private readonly fetchImpl: FetchLike;

  constructor(
    config: Configuration,
    store: { get(): JiraToken | null; set(t: JiraToken): void; clear(): void } = jiraTokenStore,
    fetchImpl: FetchLike = fetch,
  ) {
    this.config = config;
    this.store = store;
    this.fetchImpl = fetchImpl;
  }

  get isConfigured(): boolean {
    return Boolean(this.config.jiraClientId && this.config.jiraClientSecret);
  }

  get isMock(): boolean {
    return Boolean(this.config.jiraMock);
  }

  get connected(): boolean {
    return this.isMock || this.store.get() !== null;
  }

  /** URL to open in a popup once; redirects to the Atlassian consent screen. */
  buildAuthorizeUrl(state: string): string {
    const clientId = this.requireConfig().jiraClientId as string;
    const redirectUri = this.requireConfig().jiraRedirectUri as string;
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      prompt: "consent",
    });
    return `${AUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeAuthorizationCode(code: string): Promise<void> {
    if (!this.isConfigured) this.notConfigured();
    const res = await this.fetchImpl(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.config.jiraClientId,
        client_secret: this.config.jiraClientSecret,
        redirect_uri: this.config.jiraRedirectUri,
        code,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      this.store.clear();
      throw this.authFailed(res.status, body);
    }
    await this.storeToken(body);
  }

  /** Ensures a live token for the given site, refreshing when nearly expired. */
  async ensureToken(): Promise<JiraToken> {
    const token = this.store.get();
    const now = Date.now();
    if (this.isMock) {
      return {
        accessToken: "mock",
        refreshToken: "mock",
        expiresAt: now + 3_600_000,
        resources: [],
      };
    }
    if (!token) {
      throw new ApiError("JIRA_AUTH_REQUIRED", 401, "Sign in to Jira to import stories.");
    }
    if (now >= token.expiresAt - 60_000) {
      return this.refresh(token);
    }
    return token;
  }

  /** Fetches stories from the given Jira link using the stored token. */
  async fetchStories(query: JiraFeedQuery, maxResults = 100): Promise<JiraStory[]> {
    if (this.isMock) return this.mockStories();
    const token = await this.ensureToken();
    const hostname = new URL(query.site).hostname;
    const resource = token.resources.find(
      (r) => new URL(r.site).hostname.toLowerCase() === hostname.toLowerCase(),
    );
    if (!resource) {
      throw new ApiError(
        "JIRA_AUTH_REQUIRED",
        401,
        `The connected Jira account is not authorised for ${hostname}.`,
      );
    }
    const jql = query.filterId ? `filter = ${query.filterId}` : (query.jql ?? "");
    if (!jql.trim()) {
      throw new ApiError("INVALID_FEED", 400, "The Jira link could not be resolved to a search.");
    }
    const searchUrl =
      `${API_BASE}/ex/jira/${encodeURIComponent(resource.id)}/rest/api/3/search` +
      `?jql=${encodeURIComponent(jql)}` +
      `&maxResults=${maxResults}` +
      `&fields=summary,description`;
    const res = await this.fetchImpl(searchUrl, {
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        accept: "application/json",
      },
    });
    if (res.status === 401) {
      // The access token may have just expired server-side; one refresh retry.
      const refreshed = await this.refresh(token);
      const retry = await this.fetchImpl(searchUrl, {
        headers: {
          authorization: `Bearer ${refreshed.accessToken}`,
          accept: "application/json",
        },
      });
      if (retry.status === 401) {
        this.store.clear();
        throw new ApiError("JIRA_AUTH_REQUIRED", 401, "Jira session expired — sign in again.");
      }
      if (!retry.ok) {
        throw new ApiError("JIRA_ERROR", 502, `Jira returned status ${retry.status}.`);
      }
      const retryData = (await retry.json()) as { issues?: JiraIssue[] };
      return mapStories(retryData.issues ?? [], query.site);
    }
    if (!res.ok) {
      throw new ApiError("JIRA_ERROR", 502, `Jira returned status ${res.status}.`);
    }
    const data = (await res.json()) as { issues?: JiraIssue[] };
    return mapStories(data.issues ?? [], query.site);
  }

  private async refresh(token: JiraToken): Promise<JiraToken> {
    const res = await this.fetchImpl(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: this.config.jiraClientId,
        client_secret: this.config.jiraClientSecret,
        refresh_token: token.refreshToken,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      this.store.clear();
      throw this.authFailed(res.status, body);
    }
    const updated = await this.storeToken(body);
    if (!updated) throw new ApiError("JIRA_ERROR", 502, "Could not refresh the Jira session.");
    return updated;
  }

  private async storeToken(body: Record<string, unknown>): Promise<JiraToken | null> {
    const accessToken =
      typeof body.access_token === "string" ? body.access_token : undefined;
    const refreshToken =
      typeof body.refresh_token === "string" ? body.refresh_token : undefined;
    const expiresIn =
      typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
        ? body.expires_in
        : 3_600;
    if (!accessToken || !refreshToken) return null;
    const resources = await this.accessibleResources(accessToken);
    const token: JiraToken = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      resources,
    };
    this.store.set(token);
    return token;
  }

  private async accessibleResources(accessToken: string): Promise<JiraResource[]> {
    const res = await this.fetchImpl(
      `${API_BASE}/oauth/token/accessible-resources`,
      { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ id?: string; url?: string; name?: string }>;
    return (Array.isArray(data) ? data : [])
      .filter((r) => typeof r.id === "string" && typeof r.url === "string")
      .map((r) => ({ id: r.id as string, site: r.url as string, name: r.name ?? "" }));
  }

  private mockStories(): JiraStory[] {
    return [
      { key: "FPB-101", title: "FPB-101 - Create an estimation room", description: "Let a user create a room and share the code.", url: "https://mock.atlassian.net/browse/FPB-101" },
      { key: "FPB-102", title: "FPB-102 - Invite participants", description: "Share a join link so teammates can join the round.", url: "https://mock.atlassian.net/browse/FPB-102" },
      { key: "FPB-103", title: "FPB-103 - Reveal cards", description: "Facilitator reveals selections with a single click.", url: "https://mock.atlassian.net/browse/FPB-103" },
      { key: "FPB-104", title: "FPB-104 - Import from Jira", description: "Pull stories from a saved filter into the story panel.", url: "https://mock.atlassian.net/browse/FPB-104" },
    ];
  }

  private requireConfig(): Configuration {
    if (!this.isConfigured) this.notConfigured();
    return this.config;
  }

  private notConfigured(): never {
    throw new ApiError(
      "JIRA_NOT_CONFIGURED",
      503,
      "Jira is not configured. Set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET.",
    );
  }

  private authFailed(status: number, body: Record<string, unknown>): ApiError {
    if (status === 401 || status === 400 || status === 403) {
      return new ApiError("JIRA_AUTH_REQUIRED", 401, "Jira could not complete sign-in — try again.");
    }
    const detail = typeof body.error_description === "string" ? body.error_description : undefined;
    return new ApiError("JIRA_ERROR", 502, detail ?? `Jira sign-in returned status ${status}.`);
  }
}