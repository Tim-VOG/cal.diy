import { WEBAPP_URL } from "@calcom/lib/constants";
import { notifyTeam } from "../lib/notifyTeam";
import { BookerCancellationService } from "../services/BookerCancellationService";
import { getInvoiceService } from "./InvoiceService.container";
import { getInvoiceSettingsRepository } from "./InvoiceSettingsRepository.container";
import { getNe26OrderRepository } from "./Ne26OrderRepository.container";
import { getNe26RoomSettingsRepository } from "./Ne26RoomSettingsRepository.container";
import { getStripeCheckoutService } from "./StripeCheckoutService.container";

/**
 * Assembled by hand rather than through the DI modules: two of its
 * dependencies are a function and a URL, and the point of taking them as
 * dependencies at all is that a test can pass a Stripe that records what it
 * was asked to refund instead of one that moves money.
 */
export function getBookerCancellationService(): BookerCancellationService {
  return new BookerCancellationService({
    ne26OrderRepository: getNe26OrderRepository(),
    invoiceService: getInvoiceService(),
    refunds: getStripeCheckoutService(),
    ne26RoomSettingsRepository: getNe26RoomSettingsRepository(),
    invoiceSettingsRepository: getInvoiceSettingsRepository(),
    notifyTeam,
    webappUrl: WEBAPP_URL,
  });
}
