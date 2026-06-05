import { createContainer } from "@calcom/features/di/di";
import type { StripeCheckoutService } from "../services/StripeCheckoutService";
import { moduleLoader as stripeCheckoutServiceModule } from "./StripeCheckoutService.module";

const container = createContainer();

export function getStripeCheckoutService(): StripeCheckoutService {
  stripeCheckoutServiceModule.loadModule(container);
  return container.get<StripeCheckoutService>(stripeCheckoutServiceModule.token);
}
