"use client";

import { Plus, X } from "lucide-react";
import { useImageUpload } from "./useImageUpload";

const MAX_PHOTOS = 4;

/**
 * The room's extra photos, as a strip of thumbnails and one button.
 *
 * They used to be four permanent upload panels, each the size of the cover
 * picker — four empty grey rectangles on every room whether or not anybody
 * intended to use them, and the single largest thing on the card. A room with
 * no extra photos should cost one button's worth of space, not four panels.
 */
export default function GalleryStrip({
  images,
  onChange,
}: {
  images: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const filled = images.filter(Boolean);
  const { busy, error, fileInput, choose } = useImageUpload((url) => {
    if (filled.length >= MAX_PHOTOS) return;
    onChange([...filled, url]);
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="block font-medium text-gray-500 text-xs">Extra photos</span>
        <span className="text-gray-400 text-xs">
          {filled.length}/{MAX_PHOTOS}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {filled.map((url, i) => (
          <div
            key={url}
            className="group relative h-11 w-11 overflow-hidden rounded-md border border-gray-200">
            {/* biome-ignore lint/performance/noImgElement: admin preview of an arbitrary URL */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(filled.filter((_, j) => j !== i))}
              aria-label={`Remove extra photo ${i + 1}`}
              className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition group-hover:opacity-100">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}

        {filled.length < MAX_PHOTOS ? (
          <button
            type="button"
            onClick={choose}
            disabled={busy}
            aria-label="Add an extra photo"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-300 border-dashed text-gray-400 transition hover:border-[#000643] hover:text-[#000643] disabled:opacity-50">
            <Plus className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} aria-hidden />
          </button>
        ) : null}
      </div>

      {fileInput}
      {error ? <p className="mt-1 text-red-600 text-xs">{error}</p> : null}
    </div>
  );
}
