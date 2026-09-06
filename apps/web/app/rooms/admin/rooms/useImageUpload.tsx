"use client";

import { useRef, useState } from "react";

/**
 * The one upload path the admin has, shared by the cover picker and the gallery
 * strip so a change to how photos are stored is made once.
 */
export function useImageUpload(onUploaded: (url: string) => void) {
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
      onUploaded(json.url);
    } catch {
      setError("The upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      // Let the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const fileInput = (
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
  );

  return { busy, error, fileInput, choose: () => inputRef.current?.click() };
}
