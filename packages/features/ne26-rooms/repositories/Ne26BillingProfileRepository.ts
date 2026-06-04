import type { PrismaClient } from "@calcom/prisma";

const profileSelect = {
  legalName: true,
  vatNumber: true,
  country: true,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  city: true,
} as const;

export interface BillingProfile {
  legalName: string;
  vatNumber: string;
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
    return this.prismaClient.ne26BillingProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: profileSelect,
    });
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
