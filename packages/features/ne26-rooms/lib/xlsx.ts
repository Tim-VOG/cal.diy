import { createZip } from "./zip";

/**
 * A one-sheet Excel workbook, built from rows.
 *
 * The bookings export was a CSV, which the accounting team opened in Excel and
 * had to talk through a text-import dialog every time: semicolons or commas,
 * which encoding, why "NE26-2026-0006" turned into a date. A real .xlsx opens
 * on a double click, keeps its column types, and needs no explanation.
 *
 * Deliberately minimal — no styles, no shared strings, no formulas. Strings are
 * written inline, which costs a few bytes on a file of a few hundred rows and
 * removes an indirection that would otherwise have to be right.
 */

export type CellValue = string | number | null | undefined;

/**
 * Control characters are illegal in XML 1.0, and Excel refuses the whole file
 * rather than skipping the one cell that carries one. Built from escapes so the
 * characters themselves never appear in this source.
 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");

const escapeXml = (value: string) =>
  value
    .replace(CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "A", "B", ... "Z", "AA": the column's spreadsheet letter, from a zero-based index. */
export function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cell(ref: string, value: CellValue): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function sheetXml(headers: string[], rows: CellValue[][]): string {
  const all = [headers as CellValue[], ...rows];
  const body = all
    .map((row, r) => {
      const cells = row.map((value, c) => cell(`${columnName(c)}${r + 1}`, value)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Build an .xlsx file. `sheetName` is what the tab is called in Excel. */
export function buildXlsx(input: {
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  at?: Date;
}): Uint8Array {
  // Excel forbids these characters in a tab name and silently truncates past 31.
  const tab = escapeXml(input.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31)) || "Sheet1";
  const enc = (s: string) => new TextEncoder().encode(s);

  return createZip(
    [
      {
        name: "[Content_Types].xml",
        data: enc(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
        ),
      },
      {
        name: "_rels/.rels",
        data: enc(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
        ),
      },
      {
        name: "xl/workbook.xml",
        data: enc(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${tab}" sheetId="1" r:id="rId1"/></sheets></workbook>`
        ),
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: enc(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
        ),
      },
      { name: "xl/worksheets/sheet1.xml", data: enc(sheetXml(input.headers, input.rows)) },
    ],
    input.at
  );
}
