import { createContainer } from "@calcom/features/di/di";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";
import { moduleLoader as resourceBookingRepositoryModule } from "./ResourceBookingRepository.module";

const container = createContainer();

export function getResourceBookingRepository(): ResourceBookingRepository {
  resourceBookingRepositoryModule.loadModule(container);
  return container.get<ResourceBookingRepository>(resourceBookingRepositoryModule.token);
}
