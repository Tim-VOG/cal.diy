import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { Ne26BillingProfileRepository } from "@calcom/features/ne26-rooms/repositories/Ne26BillingProfileRepository";

export const ne26BillingProfileRepositoryModule = createModule();
const token = DI_TOKENS.NE26_BILLING_PROFILE_REPOSITORY;
const moduleToken = DI_TOKENS.NE26_BILLING_PROFILE_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: ne26BillingProfileRepositoryModule,
  moduleToken,
  token,
  classs: Ne26BillingProfileRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
