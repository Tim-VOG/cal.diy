import { describe, expect, it } from "vitest";
import type { AddOnRepository } from "../repositories/AddOnRepository";
import type { InvoiceSettings, InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
import type {
  BillingProfile,
  Ne26BillingProfileRepository,
} from "../repositories/Ne26BillingProfileRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";
import { RoomVatPreviewService } from "./RoomVatPreviewService";

const SETTINGS: InvoiceSettings = {
  legalName: "VO EUROPE SA",
  vatNumber: "BE0123",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  city: "",
  country: "Belgium",
  iban: "",
  bic: "",
  contactEmail: "",
  legalFooter: "",
  footerColumn1: "",
  footerColumn2: "",
  footerColumn3: "",
  euReverseChargeEnabled: true,
  euReverseChargeMention: "VAT reverse charge",
  nonEuExemptEnabled: true,
  nonEuExemptMention: "VAT not applicable",
};

function makeService(profile: BillingProfile | null) {
  const resourceRepository = {
    findBySlug: async () => ({
      id: 1,
      name: "Suite 1",
      slug: "suite-1",
      isActive: true,
      price1h: 35000,
      price2h: 65000,
      price3h: 90000,
      currency: "EUR",
    }),
  } as unknown as ResourceRepository;
  const addOnRepository = { findManyActiveBySlugs: async () => [] } as unknown as AddOnRepository;
  const invoiceSettingsRepository = { get: async () => SETTINGS } as unknown as InvoiceSettingsRepository;
  const ne26BillingProfileRepository = {
    findByUserId: async () => profile,
  } as unknown as Ne26BillingProfileRepository;

  return new RoomVatPreviewService({
    resourceRepository,
    addOnRepository,
    invoiceSettingsRepository,
    ne26BillingProfileRepository,
  });
}

function profile(country: string, vatNumber = ""): BillingProfile {
  return { legalName: "", vatNumber, country, addressLine1: "", addressLine2: "", postalCode: "", city: "" };
}

const input = { userId: 1, slug: "suite-1", durationHours: 1 as const };

describe("RoomVatPreviewService", () => {
  it("applies standard Belgian VAT (21%) for a BE buyer", async () => {
    const res = await makeService(profile("BE")).preview(input);
    expect(res.zeroRated).toBe(false);
    expect(res.hasBuyerCountry).toBe(true);
    // 35000 HT + 21% VAT = 42350 TTC
    expect(res.totalHt).toBe(35000);
    expect(res.totalVat).toBe(7350);
    expect(res.totalTtc).toBe(42350);
    expect(res.vatBreakdown).toEqual([{ vatRate: 2100, vat: 7350 }]);
  });

  it("charges VAT to an EU buyer whose VAT number is unverified", async () => {
    // The saved profile carries a self-declared number and nothing verifies it,
    // so the preview must quote VAT rather than promise a reverse charge the
    // invoice would not grant. That is every EU buyer today.
    const res = await makeService(profile("FR", "FR123")).preview(input);
    expect(res.zeroRated).toBe(false);
    expect(res.totalHt).toBe(35000);
    expect(res.totalVat).toBe(7350); // 21% added on top of HT
    expect(res.mention).toBeNull();
  });

  it("flags a missing buyer country", async () => {
    const res = await makeService(null).preview(input);
    expect(res.hasBuyerCountry).toBe(false);
    expect(res.zeroRated).toBe(false);
  });
});
