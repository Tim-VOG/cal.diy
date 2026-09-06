"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useImageUpload } from "./useImageUpload";

/**
 * The room's cover photo: one thumbnail and the two things you can do to it.
 *
 * It used to be a full-width 3:2 drop panel with the path field underneath —
 * the tallest element on a card that also has prices, capacity, a description
 * and an icon to set. A photo you have already chosen needs to be recognisable,
 * not large; a photo you have not needs a button.
 *
 * The value stored on the room is a URL either way, so photos entered by hand
 * as `/rooms/suite-1.jpg` before uploads existed keep working — the field is
 * still editable underneath.
 */
export default function ImagePicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (url: string) => void;
  label: string;
}): JSX.Element {
  const { busy, error, fileInput, choose } = useImageUpload(onChange);

  return (
    <div>
      <span className="block font-medium text-gray-500 text-xs">{label}</span>

      <div className="mt-1 flex items-start gap-2">
        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
          {value ? (
            <>
              {/* biome-ignore lint/performance/noImgElement: admin preview of an arbitrary URL */}
              <img src={value} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange("")}
                aria-label={`Remove ${label}`}
                className="absolute top-0.5 right-0.5 rounded bg-white/90 p-0.5 text-gray-600 shadow-sm transition hover:text-red-700">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={choose}
              disabled={busy}
              aria-label={`Add ${label}`}
              className="flex h-full w-full items-center justify-center text-gray-400 transition hover:bg-gray-100 hover:text-[#000643]">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="h-4 w-4" aria-hidden />
              )}
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={choose}
            disabled={busy}
            className="text-[#000643] text-xs underline transition hover:no-underline disabled:opacity-50">
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </button>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="or paste a path"
            aria-label={`${label} URL`}
            className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-gray-500 text-xs focus:border-[#000643] focus:outline-none"
          />
        </div>
      </div>

      {fileInput}
      {error ? <p className="mt-1 text-red-600 text-xs">{error}</p> : null}
    </div>
  );
}
