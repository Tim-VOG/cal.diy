import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { deskSessionFromCookieHeader } from "@calcom/features/ne26-rooms/lib/deskSession";
import { readInvoicePdf } from "@calcom/features/ne26-rooms/lib/invoiceStorage";
import { createZip, type ZipEntry } from "@calcom/features/ne26-rooms/lib/zip";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

/**
 * Every invoice and credit note in one archive, for the accountant.
 *
 * They were downloadable one order at a time, which for a three-day event is a
 * few hundred clicks and a filing convention invented on the spot. The archive
 * names each document by its number, so it sorts into the ledger's order in any
 * file browser, and separates credit notes from invoices.
 *
 * Refused while the tablet is in desk mode. Everywhere else that matters checks
 * this; a single request handing over every invoice VO has issued is not the
 * place to make an exception, and the welcome desk sits in a public hall.
 */
export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const session = await getServerSession({ req: buildLegacyRequest(headerStore, cookieStore) });
  if (!session?.user?.id) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Admins only" }, { status: 403 });

  const deskCookie = headerStore.get("cookie");
  if (deskSessionFromCookieHeader(deskCookie)) {
    return Response.json(
      { error: "This tablet is in desk mode. Enter the PIN to leave it before exporting." },
      { status: 403 }
    );
  }

  const repo = getNe26OrderRepository();
  // Two sources, because the first four invoices VO issued predate orders and
  // hang off the booking instead. Reading only one of them hands the accountant
  // a third of the file while looking complete.
  const [orders, legacy] = await Promise.all([repo.findIssuedDocuments(), repo.findLegacyIssuedDocuments()]);
  const documents = [
    ...orders.map((o) => ({
      uid: o.uid,
      invoiceNumber: o.invoiceNumber,
      creditNoteNumber: o.creditNoteNumber,
      who: o.bookerLegalName || o.bookerName || "",
    })),
    ...legacy.map((b) => ({
      uid: b.uid,
      invoiceNumber: b.invoiceNumber,
      creditNoteNumber: b.creditNoteNumber,
      who: b.bookerName || "",
    })),
  ].sort((a, b) => (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "", "en"));

  const entries: ZipEntry[] = [];

  for (const order of documents) {
    // Named for a human filing them: the number first, so the archive sorts
    // into the ledger's order, then who it was made out to.
    const who = order.who.replace(/[\\/:*?"<>|]/g, " ").trim();
    if (order.invoiceNumber) {
      const pdf = await readInvoicePdf(order.uid, "invoice");
      if (pdf) {
        entries.push({
          name: `invoices/${order.invoiceNumber}${who ? ` - ${who}` : ""}.pdf`,
          data: new Uint8Array(pdf),
        });
      }
    }
    if (order.creditNoteNumber) {
      const pdf = await readInvoicePdf(order.uid, "credit_note");
      if (pdf) {
        entries.push({
          name: `credit-notes/${order.creditNoteNumber}${who ? ` - ${who}` : ""}.pdf`,
          data: new Uint8Array(pdf),
        });
      }
    }
  }

  // An empty archive is a valid archive, and says plainly that nothing has been
  // issued yet — better than an error the admin has to interpret.
  const zip = createZip(entries);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ne26-documents-${stamp}.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
