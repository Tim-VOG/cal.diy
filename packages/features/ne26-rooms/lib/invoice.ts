// Default VAT rate for room rental, in basis points (2100 = 21%). Used for NEW
// orders; an issued invoice keeps the rate frozen on the booking, so changing
// this can never re-split a document that has already gone out.
export const ROOM_VAT_RATE_BP = 2100;

export interface InvoiceLine {
  label: string;
  /** Second, quieter line under the label — the slot the room was booked for. */
  sublabel?: string;
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

/** One room of an order, with whatever was ordered alongside it. */
export interface InvoiceRoom {
  /** HT (excl. VAT) total for this room = its rental HT + its add-on HT lines. */
  amountTotal: number;
  roomName: string;
  durationMinutes: number;
  /** "Tue, 17 Nov 2026, 09:00-10:00 TRT" — printed under the line. */
  slotLabel?: string;
  /** Add-on lineTotal is HT (excl. VAT). */
  addOns: { name: string; quantity: number; lineTotal: number; vatRate: number }[];
}

export interface InvoiceInput {
  currency: string;
  /**
   * Every room on the order. One payment can cover several, so the document
   * lists them all — an exhibitor who booked three rooms receives one invoice,
   * not three.
   */
  rooms: InvoiceRoom[];
  /**
   * Room-rental VAT rate in basis points. Callers pass the rate FROZEN on the
   * booking when re-rendering an issued document, and ROOM_VAT_RATE_BP for a new
   * order or a live preview. Defaulted so existing callers keep today's rate.
   */
  roomVatRate?: number;
}

/**
 * Build the invoice breakdown from a booking. Prices are treated as VAT-EXCLUSIVE
 * (HT): each line's VAT is added on top at its rate, and TTC = HT + VAT. The room
 * line's HT is amountTotal minus the add-on HT lines. Zero-rated (reverse charge
 * / exemption) keeps VAT at 0, so TTC = HT.
 */
export function buildInvoiceModel(input: InvoiceInput, vat?: VatTreatmentInput): InvoiceModel {
  const zeroRated = vat?.zeroRated ?? false;

  const lineFor = (label: string, ht: number, baseRate: number, sublabel?: string): InvoiceLine => {
    if (zeroRated) return { label, sublabel, totalTtc: ht, vatRate: 0, ht, vat: 0 };
    const vatAmount = Math.round((ht * baseRate) / 10000);
    return { label, sublabel, totalTtc: ht + vatAmount, vatRate: baseRate, ht, vat: vatAmount };
  };

  const lines: InvoiceLine[] = [];
  for (const room of input.rooms) {
    const addOnsHt = room.addOns.reduce((sum, a) => sum + a.lineTotal, 0);
    lines.push(
      lineFor(
        `${room.roomName} — meeting room rental (${room.durationMinutes / 60}h)`,
        room.amountTotal - addOnsHt,
        input.roomVatRate ?? ROOM_VAT_RATE_BP,
        // When the room was actually booked for. It used to sit in a highlighted
        // block below the totals, which repeated the line above it and pushed the
        // money down the page — it belongs with the thing being charged for.
        room.slotLabel
      )
    );
    for (const addOn of room.addOns) {
      lines.push(
        lineFor(
          addOn.quantity > 1 ? `${addOn.name} × ${addOn.quantity}` : addOn.name,
          addOn.lineTotal,
          addOn.vatRate
        )
      );
    }
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
