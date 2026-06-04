import { type Container, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { StripeCheckoutService } from "@calcom/features/ne26-rooms/services/StripeCheckoutService";

export const stripeCheckoutServiceModule = createModule();
const token = DI_TOKENS.STRIPE_CHECKOUT_SERVICE;
const moduleToken = DI_TOKENS.STRIPE_CHECKOUT_SERVICE_MODULE;

// No DI dependencies — the Stripe client is built from STRIPE_PRIVATE_KEY — so a
// factory binding (like the Prisma module) rather than bindModuleToClassOnToken.
stripeCheckoutServiceModule.bind(token).toFactory(() => new StripeCheckoutService(), "singleton");

export const moduleLoader: ModuleLoader = {
  token,
  loadModule: (container: Container) => {
    container.load(moduleToken, stripeCheckoutServiceModule);
  },
};
