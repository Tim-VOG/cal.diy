import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import {
  ACCOUNTING_HEADERS,
  accountingFileName,
  accountingRows,
} from "@calcom/features/ne26-rooms/lib/accountingExport";
import { deskSessionFromCookieHeader } from "@calcom/features/ne26-rooms/lib/deskSession";
import { buildXlsx } from "@calcom/features/ne26-rooms/lib/xlsx";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

/**
 * The accounting export: every invoice and credit note as a spreadsheet row.
 *
 * Served from the server rather than built in the browser like the other
 * exports, because it needs the billing block and the frozen VAT of every
 * order — neither of which the dashboard loads, and neither of which belongs
 * in a payload sent to every admin screen.
 *
 * Refused in desk mode, like the invoice archive: the welcome desk tablet sits
 * in a public hall, and this file names every buyer and every amount.
 */
export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const session = await getServerSession({ req: buildLegacyRequest(headerStore, cookieStore) });
  if (!session?.user?.id) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Admins only" }, { status: 403 });
  if (deskSessionFromCookieHeader(headerStore.get("cookie"))) {
    return Response.json(
      { error: "This tablet is in desk mode. Enter the PIN to leave it before exporting." },
      { status: 403 }
    );
  }

  const orders = await getNe26OrderRepository().findForAccounting();
  const book = buildXlsx({
    sheetName: "Accounting",
    headers: ACCOUNTING_HEADERS,
    rows: accountingRows(orders),
  });

  return new Response(book as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${accountingFileName(new Date())}"`,
      "Cache-Control": "no-store",
    },
  });
}
