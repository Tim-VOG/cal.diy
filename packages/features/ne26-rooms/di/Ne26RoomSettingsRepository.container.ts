import { createContainer } from "@calcom/features/di/di";
import type { Ne26RoomSettingsRepository } from "../repositories/Ne26RoomSettingsRepository";
import { moduleLoader as ne26RoomSettingsRepositoryModule } from "./Ne26RoomSettingsRepository.module";

const container = createContainer();

export function getNe26RoomSettingsRepository(): Ne26RoomSettingsRepository {
  ne26RoomSettingsRepositoryModule.loadModule(container);
  return container.get<Ne26RoomSettingsRepository>(ne26RoomSettingsRepositoryModule.token);
}
