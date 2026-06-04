import type { PrismaClient } from "@calcom/prisma";

const settingsSelect = {
  legalName: true,
  vatNumber: true,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  city: true,
  country: true,
  iban: true,
  bic: true,
  contactEmail: true,
  legalFooter: true,
  footerColumn1: true,
  footerColumn2: true,
  footerColumn3: true,
  euReverseChargeEnabled: true,
  euReverseChargeMention: true,
  nonEuExemptEnabled: true,
  nonEuExemptMention: true,
} as const;

export interface InvoiceSettings {
  legalName: string;
  vatNumber: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
  iban: string;
  bic: string;
  contactEmail: string;
  legalFooter: string;
  footerColumn1: string;
  footerColumn2: string;
  footerColumn3: string;
  euReverseChargeEnabled: boolean;
  euReverseChargeMention: string;
  nonEuExemptEnabled: boolean;
  nonEuExemptMention: string;
}

export class InvoiceSettingsRepository {
  constructor(private prismaClient: PrismaClient) {}

  // Singleton row (id=1); upsert guarantees it exists without a seed step.
  get(): Promise<InvoiceSettings> {
    return this.prismaClient.ne26InvoiceSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
      select: settingsSelect,
    });
  }

  async update(data: Partial<InvoiceSettings>): Promise<InvoiceSettings> {
    return this.prismaClient.ne26InvoiceSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
      select: settingsSelect,
    });
  }
}
