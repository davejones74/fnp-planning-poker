import { loadConfiguration } from "../config/configuration.ts";
import { CosmosTableRoomRepository } from "./CosmosTableRoomRepository.ts";
import { InMemoryPubSubService } from "./InMemoryPubSubService.ts";
import { InMemoryRoomRepository } from "./InMemoryRoomRepository.ts";
import { RoomService } from "./RoomService.ts";
import { JiraClient } from "./jira.ts";

/**
 * Wiring for the local prototype. The same services run on Azure Functions;
 * only this composition changes. A COSMOS_TABLE_CONNECTION_STRING swaps in the
 * durable repository, and a WEB_PUBSUB_CONNECTION_STRING swaps in the managed
 * Web PubSub broadcaster.
 */
export const configuration = loadConfiguration();
export const roomRepository = configuration.cosmosTableConnectionString
  ? new CosmosTableRoomRepository(configuration.cosmosTableConnectionString)
  : new InMemoryRoomRepository();
export const realtime = new InMemoryPubSubService();
export const rooms = new RoomService(roomRepository, realtime, {
  deck: configuration.defaultDeck,
  roomExpiryHours: configuration.roomExpiryHours,
});
export const jira = new JiraClient(configuration);