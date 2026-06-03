import { createContainer } from "@calcom/features/di/di";

import type { ResourceBookingService } from "../services/ResourceBookingService";
import { moduleLoader as resourceBookingServiceModule } from "./ResourceBookingService.module";

const container = createContainer();

export function getResourceBookingService(): ResourceBookingService {
  resourceBookingServiceModule.loadModule(container);
  return container.get<ResourceBookingService>(resourceBookingServiceModule.token);
}
