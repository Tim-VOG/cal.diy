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
  /** HT (excl. VAT) total = room HT + add-on HT lines. */
  amountTotal: number;
  currency: string;
  roomName: string;
  durationMinutes: number;
  /** Add-on lineTotal is HT (excl. VAT). */
  addOns: { name: string; quantity: number; lineTotal: number; vatRate: number }[];
}

/**
 * Build the invoice breakdown from a booking. Prices are treated as VAT-EXCLUSIVE
 * (HT): each line's VAT is added on top at its rate, and TTC = HT + VAT. The room
 * line's HT is amountTotal minus the add-on HT lines. Zero-rated (reverse charge
 * / exemption) keeps VAT at 0, so TTC = HT.
 */
export function buildInvoiceModel(input: InvoiceInput, vat?: VatTreatmentInput): InvoiceModel {
  const addOnsHt = input.addOns.reduce((sum, a) => sum + a.lineTotal, 0);
  const roomHt = input.amountTotal - addOnsHt;
  const zeroRated = vat?.zeroRated ?? false;

  const lineFor = (label: string, ht: number, baseRate: number): InvoiceLine => {
    if (zeroRated) return { label, totalTtc: ht, vatRate: 0, ht, vat: 0 };
    const vatAmount = Math.round((ht * baseRate) / 10000);
    return { label, totalTtc: ht + vatAmount, vatRate: baseRate, ht, vat: vatAmount };
  };

  const lines: InvoiceLine[] = [
    lineFor(
      `${input.roomName} — meeting room rental (${input.durationMinutes / 60}h)`,
      roomHt,
      ROOM_VAT_RATE_BP
    ),
  ];
  for (const addOn of input.addOns) {
    lines.push(
      lineFor(
        addOn.quantity > 1 ? `${addOn.name} × ${addOn.quantity}` : addOn.name,
        addOn.lineTotal,
        addOn.vatRate
      )
    );
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
