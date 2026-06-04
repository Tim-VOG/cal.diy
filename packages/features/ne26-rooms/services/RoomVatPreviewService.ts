import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { DurationHours } from "../lib/eventSchedule";
import { buildInvoiceModel } from "../lib/invoice";
import { computeAddOnLine } from "../lib/pricing";
import { resolveVatTreatment } from "../lib/vat";
import type { AddOnRepository } from "../repositories/AddOnRepository";
import type { InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
import type { Ne26BillingProfileRepository } from "../repositories/Ne26BillingProfileRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";

export interface IRoomVatPreviewServiceDeps {
  resourceRepository: ResourceRepository;
  addOnRepository: AddOnRepository;
  invoiceSettingsRepository: InvoiceSettingsRepository;
  ne26BillingProfileRepository: Ne26BillingProfileRepository;
}

export interface VatPreviewInput {
  userId: number;
  slug: string;
  durationHours: DurationHours;
  addOns?: { slug: string; quantity: number }[];
}

export interface VatPreview {
  currency: string;
  totalTtc: number;
  totalHt: number;
  totalVat: number;
  /** Per-rate VAT lines (rate in basis points). Empty when zero-rated. */
  vatBreakdown: { vatRate: number; vat: number }[];
  zeroRated: boolean;
  mention: string | null;
  /** False when the buyer has no saved country yet — VAT can't be resolved here. */
  hasBuyerCountry: boolean;
}

/**
 * Compute the VAT breakdown for a live room selection, using the signed-in
 * exhibitor's saved billing profile (country + VAT number) and the admin VAT
 * matrix. Shown on our page before redirecting to Stripe — we keep the VAT
 * logic server-side rather than calling Stripe Tax.
 */
export class RoomVatPreviewService {
  constructor(private deps: IRoomVatPreviewServiceDeps) {}

  async preview(input: VatPreviewInput): Promise<VatPreview> {
    const room = await this.deps.resourceRepository.findBySlug(input.slug);
    if (!room || !room.isActive) {
      throw new ErrorWithCode(ErrorCode.NotFound, `Room "${input.slug}" not found`);
    }

    const durationMinutes = input.durationHours * 60;
    const roomPrice = { 1: room.price1h, 2: room.price2h, 3: room.price3h }[input.durationHours];

    const requested = input.addOns ?? [];
    const catalog = requested.length
      ? await this.deps.addOnRepository.findManyActiveBySlugs(requested.map((a) => a.slug))
      : [];
    const bySlug = new Map(catalog.map((a) => [a.slug, a]));
    const addOnLines = requested.map((req) => {
      const addOn = bySlug.get(req.slug);
      if (!addOn) throw new ErrorWithCode(ErrorCode.BadRequest, `Unknown or inactive add-on "${req.slug}"`);
      const { quantity, lineTotal } = computeAddOnLine(
        addOn.priceType,
        addOn.price,
        req.quantity,
        input.durationHours
      );
      return { name: addOn.name, quantity, lineTotal, vatRate: addOn.vatRate };
    });

    const amountTotal = roomPrice + addOnLines.reduce((sum, l) => sum + l.lineTotal, 0);

    const profile = await this.deps.ne26BillingProfileRepository.findByUserId(input.userId);
    const country = profile?.country?.trim() || null;
    const settings = await this.deps.invoiceSettingsRepository.get();
    const vat = resolveVatTreatment({ country, vatNumber: profile?.vatNumber ?? null }, settings);

    const model = buildInvoiceModel(
      { amountTotal, currency: room.currency, roomName: room.name, durationMinutes, addOns: addOnLines },
      vat
    );

    return {
      currency: model.currency,
      totalTtc: model.totalTtc,
      totalHt: model.totalHt,
      totalVat: model.totalVat,
      vatBreakdown: model.vatBreakdown.map((v) => ({ vatRate: v.vatRate, vat: v.vat })),
      zeroRated: vat.zeroRated,
      mention: model.vatMention,
      hasBuyerCountry: Boolean(country),
    };
  }
}
