import { DECKS } from "../../../shared/decks.ts";
import type { CardValue } from "../../../shared/types.ts";

export interface Configuration {
  adminUsers: string[];
  roomExpiryHours: number;
  defaultDeck: CardValue[];
  webPubSubConnectionString?: string;
  /** Web PubSub hub name all rooms connect through. */
  webPubSubHub: string;
  /** Cosmos DB Table API connection string; empty keeps the in-memory store. */
  cosmosTableConnectionString?: string;
  jiraClientId?: string;
  jiraClientSecret?: string;
  jiraRedirectUri?: string;
  jiraSite?: string;
  jiraMock: boolean;
  /** Base URL of the Jira site, e.g. https://hmcts.atlassian.net */
  jiraHost?: string;
  /** Project key prefix used to filter imported issues, e.g. PAY */
  jiraProjectKey?: string;
}

export function loadConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): Configuration {
  const hours = Number(env.ROOM_EXPIRY_HOURS ?? "24");
  const roomExpiryHours = Number.isFinite(hours) && hours > 0 ? hours : 24;

  const requestedDeck = env.DEFAULT_DECK?.trim() || "fandp";
  const defaultDeck = DECKS[requestedDeck] ?? DECKS.fandp;
  if (!DECKS[requestedDeck]) {
    console.warn(`Unknown DEFAULT_DECK "${requestedDeck}", falling back to fandp.`);
  }

  return {
    adminUsers: (env.ADMIN_USERS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    roomExpiryHours,
    defaultDeck,
    webPubSubConnectionString: env.WEB_PUBSUB_CONNECTION_STRING || undefined,
    webPubSubHub: env.WEB_PUBSUB_HUB?.trim() || "fnp",
    cosmosTableConnectionString:
      env.COSMOS_TABLE_CONNECTION_STRING || undefined,
    jiraClientId: env.JIRA_CLIENT_ID || undefined,
    jiraClientSecret: env.JIRA_CLIENT_SECRET || undefined,
    jiraRedirectUri: env.JIRA_REDIRECT_URI || undefined,
    jiraSite: env.JIRA_SITE || undefined,
    jiraMock: env.JIRA_MOCK === "1" || env.JIRA_MOCK?.toLowerCase() === "true",
    jiraHost: env.JIRA_HOST?.trim() || "https://hmcts.atlassian.net",
    jiraProjectKey: (env.JIRA_PROJECT_KEY ?? env.KEY)?.trim() || undefined,
  };
}