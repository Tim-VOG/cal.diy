/** Max extra photos shown in a room's detail gallery. */
export const MAX_GALLERY_IMAGES = 4;

/**
 * Coerce the Resource.galleryImages JSON column (or any untrusted value) into a
 * clean, capped list of non-empty image URLs/paths.
 */
export function normalizeGalleryImages(value: unknown, max = MAX_GALLERY_IMAGES): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, max);
}

/**
 * The ordered, de-duplicated photo list for a room's detail page: the cover
 * image first (when set), then the gallery photos.
 */
export function buildRoomPhotoList(imageUrl: string | null | undefined, gallery: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [imageUrl ?? "", ...normalizeGalleryImages(gallery)]) {
    const u = (url ?? "").trim();
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
