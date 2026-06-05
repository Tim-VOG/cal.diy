import { createContainer } from "@calcom/features/di/di";
import type { Ne26LegalPageRepository } from "../repositories/Ne26LegalPageRepository";
import { moduleLoader as ne26LegalPageRepositoryModule } from "./Ne26LegalPageRepository.module";

const container = createContainer();

export function getNe26LegalPageRepository(): Ne26LegalPageRepository {
  ne26LegalPageRepositoryModule.loadModule(container);
  return container.get<Ne26LegalPageRepository>(ne26LegalPageRepositoryModule.token);
}
