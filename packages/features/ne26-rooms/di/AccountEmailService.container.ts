import { verifyPassword } from "@calcom/features/auth/lib/verifyPassword";
import { AccountEmailService } from "../services/AccountEmailService";
import { getNe26AccountRepository } from "./Ne26AccountRepository.container";
import { getNe26StaffRepository } from "./Ne26StaffRepository.container";

/**
 * Assembled by hand: two of its dependencies are functions, and taking them as
 * dependencies is what lets a test check that the password is actually verified
 * and the Stripe mirror actually updated, without a password or a Stripe key.
 */
export function getAccountEmailService(): AccountEmailService {
  return new AccountEmailService({
    accounts: getNe26AccountRepository(),
    // Resolved at the moment it is used, not here: building the Stripe client
    // throws when no key is configured, and keeping somebody from correcting
    // their own address because a MIRROR cannot be reached is the wrong trade.
    customers: {
      updateCustomerEmail: async (customerId, email) => {
        const { getStripeCheckoutService } = await import("./StripeCheckoutService.container");
        await getStripeCheckoutService().updateCustomerEmail(customerId, email);
      },
    },
    verifyPassword,
    recordAction: (input) => getNe26StaffRepository().recordAction(input),
  });
}
