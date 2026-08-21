import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, checkRoomImage, isUploadedRoomImage, roomImageUrl } from "./roomImage";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);

describe("checkRoomImage", () => {
  it("accepts the three formats we serve", () => {
    expect(checkRoomImage("image/jpeg", JPEG)).toMatchObject({ ok: true, ext: "jpg" });
    expect(checkRoomImage("image/png", PNG)).toMatchObject({ ok: true, ext: "png" });
    expect(checkRoomImage("image/webp", WEBP)).toMatchObject({ ok: true, ext: "webp" });
  });

  it("tolerates casing and stray whitespace in the declared type", () => {
    expect(checkRoomImage(" IMAGE/JPEG ", JPEG)).toMatchObject({ ok: true });
  });

  it("refuses types we will not serve", () => {
    expect(checkRoomImage("image/svg+xml", PNG)).toMatchObject({ ok: false, reason: "type" });
    expect(checkRoomImage("text/html", PNG)).toMatchObject({ ok: false, reason: "type" });
    expect(checkRoomImage("application/pdf", PNG)).toMatchObject({ ok: false, reason: "type" });
  });

  it("refuses a file that lies about what it is", () => {
    // The declared type comes from the browser. An HTML file announced as a JPEG
    // would otherwise be stored and then served back from our own origin.
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(checkRoomImage("image/jpeg", html)).toMatchObject({ ok: false, reason: "content" });
    // An SVG renamed to .png is the same attack with a different extension.
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>");
    expect(checkRoomImage("image/png", svg)).toMatchObject({ ok: false, reason: "content" });
  });

  it("refuses a RIFF container that is not actually WebP", () => {
    const riffButNotWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
    ]);
    expect(checkRoomImage("image/webp", riffButNotWebp)).toMatchObject({ ok: false, reason: "content" });
  });

  it("refuses an empty file", () => {
    expect(checkRoomImage("image/png", new Uint8Array())).toMatchObject({ ok: false, reason: "content" });
  });

  it("refuses anything over the size limit", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG.slice(0, 8));
    const result = checkRoomImage("image/png", big);
    expect(result).toMatchObject({ ok: false, reason: "size" });
    if (!result.ok) expect(result.message).toContain("resize");
  });

  it("accepts a file exactly at the limit", () => {
    const exact = new Uint8Array(MAX_IMAGE_BYTES);
    exact.set(PNG.slice(0, 8));
    expect(checkRoomImage("image/png", exact)).toMatchObject({ ok: true });
  });
});

describe("roomImageUrl", () => {
  it("round-trips through the uploaded-image check", () => {
    expect(isUploadedRoomImage(roomImageUrl("abc123"))).toBe(true);
  });

  it("leaves hand-typed paths recognisable as not ours", () => {
    expect(isUploadedRoomImage("/rooms/suite-1.jpg")).toBe(false);
    expect(isUploadedRoomImage("https://example.com/photo.jpg")).toBe(false);
  });
});
