import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { Ne26StaffRepository } from "@calcom/features/ne26-rooms/repositories/Ne26StaffRepository";

export const ne26StaffRepositoryModule = createModule();
const token = DI_TOKENS.NE26_STAFF_REPOSITORY;
const moduleToken = DI_TOKENS.NE26_STAFF_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: ne26StaffRepositoryModule,
  moduleToken,
  token,
  classs: Ne26StaffRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
