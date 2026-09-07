import { describe, expect, it } from "vitest";
import { buildXlsx, columnName } from "./xlsx";
import { createZip } from "./zip";

/** Read the entry names out of a zip's central directory. */
function entryNames(zip: Uint8Array): string[] {
  const names: string[] = [];
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i < zip.length - 4; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      const len = view.getUint16(i + 28, true);
      names.push(new TextDecoder().decode(zip.subarray(i + 46, i + 46 + len)));
    }
  }
  return names;
}

const text = (zip: Uint8Array) => new TextDecoder().decode(zip);

describe("createZip", () => {
  it("writes the signatures a reader looks for", () => {
    const zip = createZip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(entryNames(zip)).toEqual(["a.txt"]);
  });

  it("keeps every entry, in order", () => {
    const enc = new TextEncoder();
    const zip = createZip([
      { name: "one.txt", data: enc.encode("1") },
      { name: "nested/two.txt", data: enc.encode("2") },
    ]);
    expect(entryNames(zip)).toEqual(["one.txt", "nested/two.txt"]);
  });

  it("survives an empty archive", () => {
    const zip = createZip([]);
    expect(entryNames(zip)).toEqual([]);
    expect(zip.length).toBe(22);
  });
});

describe("columnName", () => {
  it("counts like a spreadsheet, not like an array", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });
});

describe("buildXlsx", () => {
  const book = buildXlsx({
    sheetName: "Bookings",
    headers: ["Room", "Amount", "Invoice"],
    rows: [["Small Room 2", 376, "NE26-2026-0006"]],
  });

  it("contains the parts Excel opens a workbook by", () => {
    expect(entryNames(book)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("writes numbers as numbers and text as text", () => {
    const xml = text(book);
    expect(xml).toContain("<v>376</v>");
    expect(xml).toContain(">Small Room 2<");
    // The invoice number stays text, so Excel cannot decide it is a date.
    expect(xml).toContain(">NE26-2026-0006<");
  });

  it("escapes what would otherwise break the file", () => {
    const xml = text(buildXlsx({ sheetName: "S", headers: ["A"], rows: [['Ben & Jerry <"co">']] }));
    expect(xml).toContain("Ben &amp; Jerry &lt;&quot;co&quot;&gt;");
  });

  it("drops control characters rather than letting Excel refuse the file", () => {
    const withNul = `a${String.fromCharCode(0)}b`;
    const xml = text(buildXlsx({ sheetName: "S", headers: ["A"], rows: [[withNul]] }));
    expect(xml).toContain(">ab<");
  });

  it("trims a tab name to what Excel accepts", () => {
    const xml = text(buildXlsx({ sheetName: "a/b:c*d", headers: ["A"], rows: [] }));
    expect(xml).toContain('name="a b c d"');
  });

  it("leaves an empty cell out entirely", () => {
    const xml = text(buildXlsx({ sheetName: "S", headers: ["A", "B"], rows: [["x", null]] }));
    expect(xml).toContain('<row r="2">');
    expect(xml).not.toContain('r="B2"');
  });
});
