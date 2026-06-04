import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { InvoiceSettingsRepository } from "@calcom/features/ne26-rooms/repositories/InvoiceSettingsRepository";

export const invoiceSettingsRepositoryModule = createModule();
const token = DI_TOKENS.INVOICE_SETTINGS_REPOSITORY;
const moduleToken = DI_TOKENS.INVOICE_SETTINGS_REPOSITORY_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: invoiceSettingsRepositoryModule,
  moduleToken,
  token,
  classs: InvoiceSettingsRepository,
  dep: prismaModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
