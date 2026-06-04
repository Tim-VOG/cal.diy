import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { ResourceBookingService } from "@calcom/features/ne26-rooms/services/ResourceBookingService";
import { moduleLoader as addOnRepositoryModuleLoader } from "./AddOnRepository.module";
import { moduleLoader as ne26RoomSettingsRepositoryModuleLoader } from "./Ne26RoomSettingsRepository.module";
import { moduleLoader as resourceBookingRepositoryModuleLoader } from "./ResourceBookingRepository.module";
import { moduleLoader as resourceRepositoryModuleLoader } from "./ResourceRepository.module";

export const resourceBookingServiceModule = createModule();
const token = DI_TOKENS.RESOURCE_BOOKING_SERVICE;
const moduleToken = DI_TOKENS.RESOURCE_BOOKING_SERVICE_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: resourceBookingServiceModule,
  moduleToken,
  token,
  classs: ResourceBookingService,
  depsMap: {
    resourceRepository: resourceRepositoryModuleLoader,
    addOnRepository: addOnRepositoryModuleLoader,
    resourceBookingRepository: resourceBookingRepositoryModuleLoader,
    ne26RoomSettingsRepository: ne26RoomSettingsRepositoryModuleLoader,
  },
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
