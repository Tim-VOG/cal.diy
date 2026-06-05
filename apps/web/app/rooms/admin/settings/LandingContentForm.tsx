"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";
const label = "block font-medium text-gray-500 text-xs";

export default function LandingContentForm({
  initialTitle,
  initialIntro,
}: {
  initialTitle: string;
  initialIntro: string;
}): JSX.Element {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [intro, setIntro] = useState(initialIntro);
  const save = trpc.viewer.rooms.updateRoomSettings.useMutation({ onSuccess: () => router.refresh() });

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-[#000643] text-lg">Landing page</h2>
      <p className="mt-1 text-gray-600 text-sm">
        Shown on the public rooms page (/rooms). The title appears above “Book a meeting room”; the intro is
        the paragraph below it.
      </p>

      <label className="mt-4 block">
        <span className={label}>Title (above “Book a meeting room”)</span>
        <input
          type="text"
          placeholder="e.g. Welcome to NATO Edge 26"
          className={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="mt-3 block">
        <span className={label}>Intro text</span>
        <textarea rows={4} className={input} value={intro} onChange={(e) => setIntro(e.target.value)} />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ landingTitle: title.trim(), landingIntro: intro.trim() })}
          className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
          {save.isPending ? "Saving…" : "Save landing content"}
        </button>
        {save.isSuccess ? <span className="text-green-600 text-sm">Saved ✓</span> : null}
      </div>
      {save.error ? <p className="mt-2 text-red-600 text-sm">{save.error.message}</p> : null}
    </div>
  );
}
