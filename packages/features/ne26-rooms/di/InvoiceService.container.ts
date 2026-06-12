import { createContainer } from "@calcom/features/di/di";
import type { InvoiceService } from "../services/InvoiceService";
import { moduleLoader as invoiceServiceModule } from "./InvoiceService.module";

const container = createContainer();

export function getInvoiceService(): InvoiceService {
  invoiceServiceModule.loadModule(container);
  return container.get<InvoiceService>(invoiceServiceModule.token);
}
