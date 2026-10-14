import type { PrismaClient } from "@calcom/prisma";
import { normalizeEmail } from "../lib/accountEmail";

export interface INe26AccountRepositoryDeps {
  prismaClient: PrismaClient;
}

/**
 * The exhibitor's account, for the few things NE26 does to it.
 *
 * Cal owns the users table; this reads and writes only what the rooms app has a
 * reason to: the address they sign in with, and the copies of it carried by
 * what they bought.
 */
export class Ne26AccountRepository {
  constructor(private readonly prismaClient: PrismaClient) {}

  /** The account and what a change of address has to carry with it. */
  async findForEmailChange(userId: number) {
    const user = await this.prismaClient.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, password: { select: { hash: true } } },
    });
    if (!user) return null;
    const profile = await this.prismaClient.ne26BillingProfile.findUnique({
      where: { userId },
      select: { stripeCustomerId: true },
    });
    return { ...user, stripeCustomerId: profile?.stripeCustomerId ?? null };
  }

  /** Who already signs in with this address, if anybody. */
  async findUserIdByEmail(email: string): Promise<number | null> {
    const found = await this.prismaClient.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true },
    });
    return found?.id ?? null;
  }

  /**
   * The address on the account, and the copies of it on everything they bought,
   * in one transaction.
   *
   * The copies are what the resend button mails and what the Bookers list groups
   * by. Updated by ACCOUNT rather than by old address, so a row that was already
   * corrected by hand is not left behind.
   */
  async changeEmail(userId: number, email: string): Promise<void> {
    await this.prismaClient.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { email } });
      await tx.ne26Order.updateMany({ where: { bookerUserId: userId }, data: { bookerEmail: email } });
      await tx.resourceBooking.updateMany({
        where: { bookerUserId: userId },
        data: { bookerEmail: email },
      });
    });
  }
}
