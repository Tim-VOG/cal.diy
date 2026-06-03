import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { ResourceBookingRepository } from "@calcom/features/ne26-rooms/repositories/ResourceBookingRepository";

export const resourceBookingRepositoryModule = createModule();
const token = DI_TOKENS.RESOURCE_BOOKING_REPOSITORY;
const moduleToken = DI_TOKENS.RESOURCE_BOOKING_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: resourceBookingRepositoryModule,
  moduleToken,
  token,
  classs: ResourceBookingRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
