import { checkNewEmail, type EmailRefusal, emailRefusalMessage } from "../lib/accountEmail";
import type { Ne26AccountRepository } from "../repositories/Ne26AccountRepository";

/** What this needs from Stripe: keeping the mirrored customer's address in step. */
export interface CustomerEmailGateway {
  updateCustomerEmail(customerId: string, email: string): Promise<void>;
}

export interface IAccountEmailDeps {
  accounts: Ne26AccountRepository;
  customers: CustomerEmailGateway;
  verifyPassword: (plain: string, hash: string) => Promise<boolean>;
  /** Appends to the NE26 trail. Never throws. */
  recordAction: (input: {
    actorUserId: number | null;
    actorEmail: string;
    actorRole: string;
    action: string;
    targetType?: string;
    targetId?: string;
    detail?: string;
  }) => Promise<void>;
}

export class EmailChangeRefused extends Error {
  constructor(
    readonly reason: EmailRefusal | "not-found" | "wrong-password" | "no-password",
    message: string
  ) {
    super(message);
  }
}

/**
 * Changing the address an account signs in with — by the exhibitor, or by an
 * admin fixing a typo taken down at the desk.
 *
 * The address is copied onto every order and every room when they are bought,
 * because an invoice must say who it was made out to at the time. Those copies
 * are what the resend button and the Bookers list read, so leaving them behind
 * would send a corrected exhibitor's invoice to the address they just told us
 * was wrong, and show them twice in the admin. They move with the account.
 *
 * What does NOT move: the PDFs already issued. They print the address of the
 * day they were raised, and an issued document is not rewritten — the billing
 * correction tool exists for the parts of an invoice that may be corrected.
 */
export class AccountEmailService {
  constructor(private deps: IAccountEmailDeps) {}

  /**
   * The exhibitor changing their own address. The password is asked for because
   * this address is how they sign in: without it, a session left open on a
   * borrowed laptop is enough to take the account.
   */
  async changeOwnEmail(userId: number, rawEmail: string, password: string): Promise<{ email: string }> {
    const account = await this.deps.accounts.findForEmailChange(userId);
    if (!account) throw new EmailChangeRefused("not-found", "No such account.");
    if (!account.password?.hash) {
      throw new EmailChangeRefused(
        "no-password",
        "This account has no password set, so we cannot confirm the change here. Write to us and we will do it."
      );
    }
    if (!(await this.deps.verifyPassword(password, account.password.hash))) {
      throw new EmailChangeRefused("wrong-password", "That password is not right.");
    }
    return this.apply(userId, rawEmail, {
      actorUserId: userId,
      actorEmail: account.email,
      actorRole: "USER",
      action: "account.email.change",
    });
  }

  /** An admin correcting an address for somebody else. */
  async changeEmailAsAdmin(
    userId: number,
    rawEmail: string,
    admin: { id: number; email: string }
  ): Promise<{ email: string }> {
    const account = await this.deps.accounts.findForEmailChange(userId);
    if (!account) throw new EmailChangeRefused("not-found", "No such account.");
    return this.apply(userId, rawEmail, {
      actorUserId: admin.id,
      actorEmail: admin.email,
      actorRole: "ADMIN",
      action: "account.email.change.admin",
    });
  }

  private async apply(
    userId: number,
    rawEmail: string,
    actor: { actorUserId: number; actorEmail: string; actorRole: string; action: string }
  ): Promise<{ email: string }> {
    const account = await this.deps.accounts.findForEmailChange(userId);
    if (!account) throw new EmailChangeRefused("not-found", "No such account.");

    const takenBy = await this.deps.accounts.findUserIdByEmail(rawEmail);
    const verdict = checkNewEmail(rawEmail, account.email, takenBy, userId);
    if (!verdict.ok) throw new EmailChangeRefused(verdict.reason, emailRefusalMessage(verdict.reason));

    const previous = account.email;
    await this.deps.accounts.changeEmail(userId, verdict.email);

    // Best-effort, and after the fact on purpose: a Stripe mirror that cannot be
    // reached must not undo an address the exhibitor has already been told is
    // theirs. It is rewritten at their next checkout anyway.
    if (account.stripeCustomerId) {
      await this.deps.customers
        .updateCustomerEmail(account.stripeCustomerId, verdict.email)
        .catch(() => undefined);
    }

    await this.deps.recordAction({
      actorUserId: actor.actorUserId,
      actorEmail: actor.actorEmail,
      actorRole: actor.actorRole,
      action: actor.action,
      targetType: "account",
      targetId: String(userId),
      detail: `Email: ${previous} → ${verdict.email}`,
    });

    return { email: verdict.email };
  }
}
