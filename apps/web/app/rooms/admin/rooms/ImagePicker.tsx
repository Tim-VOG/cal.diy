"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";

/**
 * Upload a photo, or keep a hand-typed path.
 *
 * The value stored on the room is a URL either way, so photos that were entered
 * as `/rooms/suite-1.jpg` before uploads existed keep working — the field is
 * still editable by hand underneath. Uploading simply replaces it with a URL we
 * serve, and the preview is the confirmation that the right file landed.
 */
export default function ImagePicker({
  value,
  onChange,
  label,
  aspect = "aspect-[3/2]",
}: {
  value: string;
  onChange: (url: string) => void;
  label: string;
  aspect?: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ne26-rooms/upload-image", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error || "The upload failed.");
        return;
      }
      onChange(json.url);
    } catch {
      setError("The upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      // Let the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <span className="block font-medium text-gray-500 text-xs">{label}</span>

      <div
        className={`relative mt-1 ${aspect} w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50`}>
        {value ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: admin preview of an arbitrary URL, next/image adds no value */}
            <img src={value} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label={`Remove ${label}`}
              className="absolute top-1.5 right-1.5 rounded-md bg-white/90 p-1.5 text-gray-600 shadow-sm transition hover:text-red-700">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-[#000643]">
            {busy ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="h-6 w-6" aria-hidden />
            )}
            <span className="text-xs">{busy ? "Uploading…" : "Add a photo"}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-[#000643] text-xs underline transition hover:no-underline disabled:opacity-50">
          {value ? "Replace" : "Upload"}
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="or paste a path"
          aria-label={`${label} URL`}
          className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-gray-500 text-xs focus:border-[#000643] focus:outline-none"
        />
      </div>

      {error ? <p className="mt-1 text-red-600 text-xs">{error}</p> : null}
    </div>
  );
}
