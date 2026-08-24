import type { PrismaClient } from "@calcom/prisma";

const profileSelect = {
  firstName: true,
  lastName: true,
  legalName: true,
  vatNumber: true,
  poNumber: true,
  internalReference: true,
  country: true,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  city: true,
} as const;

export interface BillingProfile {
  firstName: string;
  lastName: string;
  legalName: string;
  vatNumber: string;
  poNumber: string;
  internalReference: string;
  country: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
}

export class Ne26BillingProfileRepository {
  constructor(private prismaClient: PrismaClient) {}

  findByUserId(userId: number): Promise<BillingProfile | null> {
    return this.prismaClient.ne26BillingProfile.findUnique({
      where: { userId },
      select: profileSelect,
    });
  }

  async upsertByUserId(userId: number, data: Partial<BillingProfile>): Promise<BillingProfile> {
    const profile = await this.prismaClient.ne26BillingProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: profileSelect,
    });

    // Cal's User.name drives its own emails and the booking's bookerName. NE26
    // signup only asks for an email, so without this mirror both fall back to
    // the slugified address ("tleskens-vo-group-be"). Kept one-way: this
    // profile is the source of truth, Cal is the mirror.
    const fullName = [profile.firstName, profile.lastName]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    if (fullName) {
      await this.prismaClient.user.update({ where: { id: userId }, data: { name: fullName } });
    }

    return profile;
  }

  async findStripeCustomerId(userId: number): Promise<string | null> {
    const row = await this.prismaClient.ne26BillingProfile.findUnique({
      where: { userId },
      select: { stripeCustomerId: true },
    });
    return row?.stripeCustomerId ?? null;
  }

  async setStripeCustomerId(userId: number, stripeCustomerId: string): Promise<void> {
    await this.prismaClient.ne26BillingProfile.update({
      where: { userId },
      data: { stripeCustomerId },
    });
  }
}
