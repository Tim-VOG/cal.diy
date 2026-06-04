import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Local filesystem storage for invoice PDFs. In production mount NE26_INVOICE_DIR
// on a Docker volume (or swap this module for object storage).
function storageDir(): string {
  return process.env.NE26_INVOICE_DIR || path.join(process.cwd(), ".ne26-invoices");
}

export type DocumentKind = "invoice" | "credit_note";

// uids are uuids; reject anything else to avoid path traversal.
function safeName(uid: string, kind: DocumentKind): string {
  if (!/^[a-zA-Z0-9-]+$/.test(uid)) throw new Error("Invalid invoice id");
  return kind === "credit_note" ? `${uid}-credit-note.pdf` : `${uid}.pdf`;
}

export async function saveInvoicePdf(uid: string, bytes: Uint8Array, kind: DocumentKind = "invoice"): Promise<void> {
  const dir = storageDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, safeName(uid, kind)), bytes);
}

export async function readInvoicePdf(uid: string, kind: DocumentKind = "invoice"): Promise<Buffer | null> {
  try {
    return await readFile(path.join(storageDir(), safeName(uid, kind)));
  } catch {
    return null;
  }
}
