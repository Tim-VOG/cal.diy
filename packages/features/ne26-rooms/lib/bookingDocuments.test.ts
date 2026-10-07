import { describe, expect, it } from "vitest";
import { bookingDocuments } from "./bookingDocuments";

const ORDER_UID = "12389044-0faa-45ba-9a07-66d30989b0a8";
const ROOM_UID = "b7c1f0d2-5e11-4c3a-9d2e-0a1b2c3d4e5f";

describe("bookingDocuments", () => {
  it("reads the invoice from the order, and links to the order's PDF", () => {
    // The case the Bookers tab got wrong: every sale made through an order.
    expect(
      bookingDocuments({
        uid: ROOM_UID,
        invoiceNumber: null,
        creditNoteNumber: null,
        order: { uid: ORDER_UID, invoiceNumber: "NE26-2026-0001", creditNoteNumber: null },
      })
    ).toEqual({ documentUid: ORDER_UID, invoiceNumber: "NE26-2026-0001", creditNoteNumber: null, creditNoteUid: null });
  });

  it("carries the credit note with its invoice", () => {
    const docs = bookingDocuments({
      uid: ROOM_UID,
      order: { uid: ORDER_UID, invoiceNumber: "NE26-2026-0001", creditNoteNumber: "NE26-CN-2026-0001" },
    });
    expect(docs.creditNoteNumber).toBe("NE26-CN-2026-0001");
    expect(docs.documentUid).toBe(ORDER_UID);
  });

  it("falls back to a document issued on the room before orders existed", () => {
    expect(
      bookingDocuments({
        uid: ROOM_UID,
        invoiceNumber: "NE26-2026-0004",
        creditNoteNumber: null,
        order: null,
      })
    ).toEqual({ documentUid: ROOM_UID, invoiceNumber: "NE26-2026-0004", creditNoteNumber: null, creditNoteUid: null });
  });

  it("shows the room's own credit note, and links to it by number", () => {
    // A payment covering three rooms is credited one room at a time, so the
    // number on the order is not the number for this room.
    expect(
      bookingDocuments({
        uid: ROOM_UID,
        creditNote: { number: "NE26-CN-2026-0009" },
        order: { uid: ORDER_UID, invoiceNumber: "NE26-2026-0001", creditNoteNumber: null },
      })
    ).toEqual({
      documentUid: ORDER_UID,
      invoiceNumber: "NE26-2026-0001",
      creditNoteNumber: "NE26-CN-2026-0009",
      creditNoteUid: "NE26-CN-2026-0009",
    });
  });

  it("prefers the order when both carry a number", () => {
    const docs = bookingDocuments({
      uid: ROOM_UID,
      invoiceNumber: "NE26-2026-0004",
      order: { uid: ORDER_UID, invoiceNumber: "NE26-2026-0009", creditNoteNumber: null },
    });
    expect(docs).toMatchObject({ documentUid: ORDER_UID, invoiceNumber: "NE26-2026-0009" });
  });

  it("points at the order when nothing has been issued yet", () => {
    expect(
      bookingDocuments({
        uid: ROOM_UID,
        order: { uid: ORDER_UID, invoiceNumber: null, creditNoteNumber: null },
      })
    ).toEqual({ documentUid: ORDER_UID, invoiceNumber: null, creditNoteNumber: null, creditNoteUid: null });
  });
});
