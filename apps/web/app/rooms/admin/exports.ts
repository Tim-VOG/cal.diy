"use client";

import { buildXlsx, type CellValue } from "@calcom/features/ne26-rooms/lib/xlsx";

/**
 * Hand a workbook to the browser.
 *
 * Every admin screen that exports was writing the same six lines of Blob and
 * anchor plumbing, and they had started to disagree about the file name.
 * Dates go in the name so a folder of exports sorts by the day they were taken.
 */
export function downloadWorkbook(input: {
  /** Without extension or date, e.g. "ne26-bookings". */
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
}): void {
  const book = buildXlsx({ sheetName: input.sheetName, headers: input.headers, rows: input.rows });
  const blob = new Blob([book as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${input.fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
