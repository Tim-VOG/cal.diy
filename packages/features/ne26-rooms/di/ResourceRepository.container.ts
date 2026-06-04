import { createContainer } from "@calcom/features/di/di";
import type { ResourceRepository } from "../repositories/ResourceRepository";
import { moduleLoader as resourceRepositoryModule } from "./ResourceRepository.module";

const container = createContainer();

export function getResourceRepository(): ResourceRepository {
  resourceRepositoryModule.loadModule(container);
  return container.get<ResourceRepository>(resourceRepositoryModule.token);
}
