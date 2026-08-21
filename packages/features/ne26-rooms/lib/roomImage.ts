/**
 * What the admin is allowed to upload as a room photo.
 *
 * Kept pure so the rules can be tested without a request: an upload endpoint
 * that trusts the browser's declared type is how a "photo" becomes an HTML file
 * served from our own origin.
 */

/** 3 MB. Comfortably above a phone photo resized for the web, well below a limit that hurts the database. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const ALLOWED = new Map<string, { ext: string; magic: number[][] }>([
  ["image/jpeg", { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] }],
  ["image/png", { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] }],
  // WEBP is "RIFF....WEBP": the first four bytes plus a marker at offset 8.
  ["image/webp", { ext: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] }],
]);

export type ImageRejection =
  | { ok: false; reason: "type"; message: string }
  | { ok: false; reason: "size"; message: string }
  | { ok: false; reason: "content"; message: string };

export type ImageCheck = { ok: true; mimeType: string; ext: string } | ImageRejection;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Validate an upload by its declared type AND its actual bytes.
 *
 * The declared type comes from the browser and is trivially forged; the magic
 * number is what the file really is. Both must agree, so a renamed .html or a
 * .svg (which can carry script) cannot be stored and then served back from our
 * own origin.
 */
export function checkRoomImage(declaredType: string, bytes: Uint8Array): ImageCheck {
  const allowed = ALLOWED.get(declaredType.toLowerCase().trim());
  if (!allowed) {
    return {
      ok: false,
      reason: "type",
      message: "Only JPEG, PNG and WebP images can be uploaded.",
    };
  }
  if (bytes.length === 0) {
    return { ok: false, reason: "content", message: "That file is empty." };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: "size",
      message: `That image is ${Math.round(bytes.length / 1024 / 1024)} MB. The limit is ${
        MAX_IMAGE_BYTES / 1024 / 1024
      } MB — resize it first.`,
    };
  }

  const matches = allowed.magic.some((magic) => startsWith(bytes, magic));
  const isWebp =
    declaredType.toLowerCase() === "image/webp" &&
    bytes.length > 12 &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP";

  if (!matches || (declaredType.toLowerCase() === "image/webp" && !isWebp)) {
    return {
      ok: false,
      reason: "content",
      message: "That file is not the image type it claims to be.",
    };
  }

  return { ok: true, mimeType: declaredType.toLowerCase().trim(), ext: allowed.ext };
}

/** The public path a stored image is served from. */
export function roomImageUrl(key: string): string {
  return `/api/ne26-rooms/image/${key}`;
}

/** Whether a stored value is one of our uploads rather than a hand-typed path. */
export function isUploadedRoomImage(url: string): boolean {
  return url.startsWith("/api/ne26-rooms/image/");
}
