"use client";

import { trpc } from "@calcom/trpc/react";

export default function ResumePaymentButton({ uid }: { uid: string }): JSX.Element {
  const resume = trpc.viewer.rooms.resumeBooking.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    },
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={resume.isPending}
        onClick={() => resume.mutate({ uid })}
        className="rounded-lg bg-[#000643] px-3 py-1.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
        {resume.isPending ? "Loading…" : "Resume payment"}
      </button>
      {resume.error ? <span className="text-red-600 text-xs">{resume.error.message}</span> : null}
    </div>
  );
}
