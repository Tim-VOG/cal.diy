import { createContainer } from "@calcom/features/di/di";
import type { RoomAvailabilityService } from "../services/RoomAvailabilityService";
import { moduleLoader as roomAvailabilityServiceModule } from "./RoomAvailabilityService.module";

const container = createContainer();

export function getRoomAvailabilityService(): RoomAvailabilityService {
  roomAvailabilityServiceModule.loadModule(container);
  return container.get<RoomAvailabilityService>(roomAvailabilityServiceModule.token);
}
