import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { Ne26OrderRepository } from "@calcom/features/ne26-rooms/repositories/Ne26OrderRepository";

export const ne26OrderRepositoryModule = createModule();
const token = DI_TOKENS.NE26_ORDER_REPOSITORY;
const moduleToken = DI_TOKENS.NE26_ORDER_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: ne26OrderRepositoryModule,
  moduleToken,
  token,
  classs: Ne26OrderRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
