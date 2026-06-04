// VAT rate for room rental, in basis points (2100 = 21%). Not stored on Resource;
// confirm the correct Belgian treatment with VO accounting.
export const ROOM_VAT_RATE_BP = 2100;

export interface InvoiceLine {
  label: string;
  totalTtc: number; // cents, VAT-inclusive (what the buyer paid)
  vatRate: number; // basis points
  ht: number; // cents, excl. VAT
  vat: number; // cents
}

export interface VatBreakdownEntry {
  vatRate: number;
  base: number; // HT base for this rate
  vat: number;
}

export interface InvoiceModel {
  lines: InvoiceLine[];
  vatBreakdown: VatBreakdownEntry[];
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  currency: string;
  /** Legal mention when zero-rated (reverse charge / exemption), else null. */
  vatMention: string | null;
}

export interface VatTreatmentInput {
  zeroRated: boolean;
  mention: string | null;
}

export interface InvoiceInput {
  amountTotal: number;
  currency: string;
  roomName: string;
  durationMinutes: number;
  addOns: { name: string; quantity: number; lineTotal: number; vatRate: number }[];
}

/** Split a VAT-inclusive amount into HT + VAT for a given rate (basis points). */
function splitTtc(totalTtc: number, vatRateBp: number): { ht: number; vat: number } {
  const ht = Math.round((totalTtc * 10000) / (10000 + vatRateBp));
  return { ht, vat: totalTtc - ht };
}

/**
 * Build the invoice breakdown from a booking. Prices are treated as VAT-inclusive
 * (the buyer paid amountTotal via Stripe), so HT and VAT are derived from each
 * line's TTC. The room line's TTC is amountTotal minus the add-on lines.
 */
export function buildInvoiceModel(input: InvoiceInput, vat?: VatTreatmentInput): InvoiceModel {
  const addOnsTtc = input.addOns.reduce((sum, a) => sum + a.lineTotal, 0);
  const roomTtc = input.amountTotal - addOnsTtc;
  const zeroRated = vat?.zeroRated ?? false;

  // Zero-rated (reverse charge / exemption): no VAT, HT equals the amount paid.
  const lineFor = (label: string, ttc: number, baseRate: number): InvoiceLine => {
    if (zeroRated) return { label, totalTtc: ttc, vatRate: 0, ht: ttc, vat: 0 };
    const split = splitTtc(ttc, baseRate);
    return { label, totalTtc: ttc, vatRate: baseRate, ht: split.ht, vat: split.vat };
  };

  const lines: InvoiceLine[] = [
    lineFor(`${input.roomName} — meeting room rental (${input.durationMinutes / 60}h)`, roomTtc, ROOM_VAT_RATE_BP),
  ];
  for (const addOn of input.addOns) {
    lines.push(lineFor(addOn.quantity > 1 ? `${addOn.name} × ${addOn.quantity}` : addOn.name, addOn.lineTotal, addOn.vatRate));
  }

  const byRate = new Map<number, { base: number; vat: number }>();
  for (const line of lines) {
    const entry = byRate.get(line.vatRate) ?? { base: 0, vat: 0 };
    entry.base += line.ht;
    entry.vat += line.vat;
    byRate.set(line.vatRate, entry);
  }
  const vatBreakdown = Array.from(byRate.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([vatRate, e]) => ({ vatRate, base: e.base, vat: e.vat }));

  return {
    lines,
    vatBreakdown,
    totalHt: lines.reduce((s, l) => s + l.ht, 0),
    totalVat: lines.reduce((s, l) => s + l.vat, 0),
    totalTtc: lines.reduce((s, l) => s + l.totalTtc, 0),
    currency: input.currency,
    vatMention: zeroRated ? (vat?.mention ?? null) : null,
  };
}
