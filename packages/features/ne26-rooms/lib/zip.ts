/**
 * A minimal ZIP writer, shared by the Excel export and the accounting bundle.
 *
 * Two features need archives — an .xlsx IS a zip, and the accountant wants
 * every invoice PDF in one download — and both are served by about a hundred
 * lines. Pulling a zip library and a spreadsheet library into a Cal.com fork
 * for that is a poor trade: two more dependencies to audit and upgrade, inside
 * a codebase whose custom surface is deliberately confined.
 *
 * Entries are STORED, never deflated. PDFs are already compressed so deflating
 * them buys nothing, the XML in a workbook of a few hundred rows is small, and
 * storing keeps this isomorphic — the same code runs in the browser, where
 * Node's zlib does not exist.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, "/" separated. */
  name: string;
  data: Uint8Array;
}

/** Encode a name as UTF-8; the language-encoding flag is set so readers trust it. */
const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * MS-DOS date and time, which is what the format stores. Seconds have a
 * two-second resolution — a quirk of 1980, faithfully preserved.
 */
function dosDateTime(at: Date): { time: number; date: number } {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (Math.floor(at.getSeconds() / 2) & 0x1f);
  const date = (((at.getFullYear() - 1980) & 0x7f) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return { time, date };
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
    );
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/** Build a ZIP archive from entries, in the order given. */
export function createZip(entries: ZipEntry[], at: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(at);
  const body = new ByteWriter();
  const directory = new ByteWriter();

  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const offset = body.length;

    body.u32(0x04034b50); // local file header
    body.u16(20); // version needed
    body.u16(0x0800); // UTF-8 names
    body.u16(0); // stored
    body.u16(time);
    body.u16(date);
    body.u32(crc);
    body.u32(entry.data.length);
    body.u32(entry.data.length);
    body.u16(name.length);
    body.u16(0); // no extra field
    body.push(name);
    body.push(entry.data);

    directory.u32(0x02014b50); // central directory header
    directory.u16(20); // version made by
    directory.u16(20); // version needed
    directory.u16(0x0800);
    directory.u16(0);
    directory.u16(time);
    directory.u16(date);
    directory.u32(crc);
    directory.u32(entry.data.length);
    directory.u32(entry.data.length);
    directory.u16(name.length);
    directory.u16(0); // extra
    directory.u16(0); // comment
    directory.u16(0); // disk
    directory.u16(0); // internal attrs
    directory.u32(0); // external attrs
    directory.u32(offset);
    directory.push(name);
  }

  const end = new ByteWriter();
  end.u32(0x06054b50); // end of central directory
  end.u16(0);
  end.u16(0);
  end.u16(entries.length);
  end.u16(entries.length);
  end.u32(directory.length);
  end.u32(body.length);
  end.u16(0); // no archive comment

  const out = new ByteWriter();
  out.push(body.toUint8Array());
  out.push(directory.toUint8Array());
  out.push(end.toUint8Array());
  return out.toUint8Array();
}
