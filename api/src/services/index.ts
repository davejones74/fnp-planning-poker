import { loadConfiguration } from "../config/configuration.ts";
import { InMemoryPubSubService } from "./InMemoryPubSubService.ts";
import { InMemoryRoomRepository } from "./InMemoryRoomRepository.ts";
import { RoomService } from "./RoomService.ts";

/**
 * Wiring for the local prototype. The same services run on Azure Functions
 * (Phase 3); only this composition changes (e.g. swapping the repository or
 * pub/sub implementation).
 */
export const configuration = loadConfiguration();
export const roomRepository = new InMemoryRoomRepository();
export const realtime = new InMemoryPubSubService();
export const rooms = new RoomService(roomRepository, realtime, {
  deck: configuration.defaultDeck,
  roomExpiryHours: configuration.roomExpiryHours,
});