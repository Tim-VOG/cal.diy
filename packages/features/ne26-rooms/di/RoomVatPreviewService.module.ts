import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { RoomVatPreviewService } from "@calcom/features/ne26-rooms/services/RoomVatPreviewService";
import { moduleLoader as addOnRepositoryModuleLoader } from "./AddOnRepository.module";
import { moduleLoader as invoiceSettingsRepositoryModuleLoader } from "./InvoiceSettingsRepository.module";
import { moduleLoader as ne26BillingProfileRepositoryModuleLoader } from "./Ne26BillingProfileRepository.module";
import { moduleLoader as resourceRepositoryModuleLoader } from "./ResourceRepository.module";

export const roomVatPreviewServiceModule = createModule();
const token = DI_TOKENS.ROOM_VAT_PREVIEW_SERVICE;
const moduleToken = DI_TOKENS.ROOM_VAT_PREVIEW_SERVICE_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: roomVatPreviewServiceModule,
  moduleToken,
  token,
  classs: RoomVatPreviewService,
  depsMap: {
    resourceRepository: resourceRepositoryModuleLoader,
    addOnRepository: addOnRepositoryModuleLoader,
    invoiceSettingsRepository: invoiceSettingsRepositoryModuleLoader,
    ne26BillingProfileRepository: ne26BillingProfileRepositoryModuleLoader,
  },
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};
