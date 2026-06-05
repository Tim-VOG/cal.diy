import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { Ne26LegalPageRepository } from "@calcom/features/ne26-rooms/repositories/Ne26LegalPageRepository";

export const ne26LegalPageRepositoryModule = createModule();
const token = DI_TOKENS.NE26_LEGAL_PAGE_REPOSITORY;
const moduleToken = DI_TOKENS.NE26_LEGAL_PAGE_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: ne26LegalPageRepositoryModule,
  moduleToken,
  token,
  classs: Ne26LegalPageRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
