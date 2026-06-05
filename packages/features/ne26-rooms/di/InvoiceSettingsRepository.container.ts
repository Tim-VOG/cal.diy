import { createContainer } from "@calcom/features/di/di";
import type { InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
import { moduleLoader as invoiceSettingsRepositoryModule } from "./InvoiceSettingsRepository.module";

const container = createContainer();

export function getInvoiceSettingsRepository(): InvoiceSettingsRepository {
  invoiceSettingsRepositoryModule.loadModule(container);
  return container.get<InvoiceSettingsRepository>(invoiceSettingsRepositoryModule.token);
}
