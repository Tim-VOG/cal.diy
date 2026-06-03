import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { ResourceRepository } from "@calcom/features/ne26-rooms/repositories/ResourceRepository";

export const resourceRepositoryModule = createModule();
const token = DI_TOKENS.RESOURCE_REPOSITORY;
const moduleToken = DI_TOKENS.RESOURCE_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: resourceRepositoryModule,
  moduleToken,
  token,
  classs: ResourceRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
