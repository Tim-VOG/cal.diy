import { createContainer } from "@calcom/features/di/di";

import type { AddOnRepository } from "../repositories/AddOnRepository";
import { moduleLoader as addOnRepositoryModule } from "./AddOnRepository.module";

const container = createContainer();

export function getAddOnRepository(): AddOnRepository {
  addOnRepositoryModule.loadModule(container);
  return container.get<AddOnRepository>(addOnRepositoryModule.token);
}
