import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { AddOnRepository } from "@calcom/features/ne26-rooms/repositories/AddOnRepository";

export const addOnRepositoryModule = createModule();
const token = DI_TOKENS.ADD_ON_REPOSITORY;
const moduleToken = DI_TOKENS.ADD_ON_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: addOnRepositoryModule,
  moduleToken,
  token,
  classs: AddOnRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
