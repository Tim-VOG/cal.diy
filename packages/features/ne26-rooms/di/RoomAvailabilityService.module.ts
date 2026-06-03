import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { RoomAvailabilityService } from "@calcom/features/ne26-rooms/services/RoomAvailabilityService";

import { moduleLoader as resourceBookingRepositoryModuleLoader } from "./ResourceBookingRepository.module";
import { moduleLoader as resourceRepositoryModuleLoader } from "./ResourceRepository.module";

export const roomAvailabilityServiceModule = createModule();
const token = DI_TOKENS.ROOM_AVAILABILITY_SERVICE;
const moduleToken = DI_TOKENS.ROOM_AVAILABILITY_SERVICE_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: roomAvailabilityServiceModule,
  moduleToken,
  token,
  classs: RoomAvailabilityService,
  depsMap: {
    resourceRepository: resourceRepositoryModuleLoader,
    resourceBookingRepository: resourceBookingRepositoryModuleLoader,
  },
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
