import { DECKS } from "../../../shared/decks.ts";
import type { CardValue } from "../../../shared/types.ts";

export interface Configuration {
  adminUsers: string[];
  roomExpiryHours: number;
  defaultDeck: CardValue[];
  webPubSubConnectionString?: string;
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
  };
}