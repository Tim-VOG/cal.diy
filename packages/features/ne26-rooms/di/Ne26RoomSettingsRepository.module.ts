import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { Ne26RoomSettingsRepository } from "@calcom/features/ne26-rooms/repositories/Ne26RoomSettingsRepository";

export const ne26RoomSettingsRepositoryModule = createModule();
const token = DI_TOKENS.NE26_ROOM_SETTINGS_REPOSITORY;
const moduleToken = DI_TOKENS.NE26_ROOM_SETTINGS_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: ne26RoomSettingsRepositoryModule,
  moduleToken,
  token,
  classs: Ne26RoomSettingsRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
