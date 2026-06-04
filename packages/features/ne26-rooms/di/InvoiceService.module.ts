import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { InvoiceService } from "@calcom/features/ne26-rooms/services/InvoiceService";

import { moduleLoader as invoiceSettingsRepositoryModuleLoader } from "./InvoiceSettingsRepository.module";
import { moduleLoader as resourceBookingRepositoryModuleLoader } from "./ResourceBookingRepository.module";

export const invoiceServiceModule = createModule();
const token = DI_TOKENS.INVOICE_SERVICE;
const moduleToken = DI_TOKENS.INVOICE_SERVICE_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: invoiceServiceModule,
  moduleToken,
  token,
  classs: InvoiceService,
  depsMap: {
    resourceBookingRepository: resourceBookingRepositoryModuleLoader,
    invoiceSettingsRepository: invoiceSettingsRepositoryModuleLoader,
  },
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
