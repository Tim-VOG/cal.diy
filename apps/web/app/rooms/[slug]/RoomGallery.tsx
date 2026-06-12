"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// Room photo gallery with a click-to-enlarge lightbox (keyboard + arrows).
export default function RoomGallery({
  photos,
  roomName,
}: {
  photos: string[];
  roomName: string;
}): JSX.Element | null {
  const [open, setOpen] = useState<number | null>(null);

  const close = useCallback(() => setOpen(null), []);
  const go = useCallback(
    (dir: 1 | -1) => setOpen((i) => (i === null ? i : (i + dir + photos.length) % photos.length)),
    [photos.length]
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, go]);

  if (photos.length === 0) return null;

  const [cover, ...rest] = photos;

  return (
    <div className="mt-4">
      {/* Cover */}
      <button
        type="button"
        onClick={() => setOpen(0)}
        className="block w-full overflow-hidden rounded-xl border border-gray-200">
        {/* biome-ignore lint/performance/noImgElement: admin-provided URL/path, next/image adds no value here */}
        <img
          src={cover}
          alt={roomName}
          className="h-56 w-full object-cover transition hover:opacity-95 sm:h-72"
        />
      </button>

      {/* Thumbnails */}
      {rest.length > 0 ? (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {rest.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setOpen(i + 1)}
              className="overflow-hidden rounded-lg border border-gray-200">
              {/* biome-ignore lint/performance/noImgElement: admin-provided URL/path, next/image adds no value here */}
              <img
                src={src}
                alt={`${roomName} — photo ${i + 2}`}
                className="h-16 w-full object-cover transition hover:opacity-90 sm:h-20"
              />
            </button>
          ))}
        </div>
      ) : null}

      {/* Lightbox */}
      {open !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
          {/* Backdrop closes */}
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute inset-0 cursor-default"
          />
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20">
            <X className="h-6 w-6" aria-hidden />
          </button>
          {photos.length > 1 ? (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(-1)}
              className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20">
              <ChevronLeft className="h-7 w-7" aria-hidden />
            </button>
          ) : null}
          {/* biome-ignore lint/performance/noImgElement: admin-provided URL/path, next/image adds no value here */}
          <img
            src={photos[open]}
            alt={`${roomName} — photo ${open + 1}`}
            className="z-0 max-h-[85vh] max-w-full rounded-lg object-contain"
          />
          {photos.length > 1 ? (
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(1)}
              className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20">
              <ChevronRight className="h-7 w-7" aria-hidden />
            </button>
          ) : null}
          <span className="absolute bottom-4 z-10 rounded-full bg-white/10 px-3 py-1 text-sm text-white">
            {open + 1} / {photos.length}
          </span>
        </div>
      ) : null}
    </div>
  );
}
