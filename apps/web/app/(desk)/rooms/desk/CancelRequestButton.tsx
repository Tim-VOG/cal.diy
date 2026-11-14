"use client";

import { trpc } from "@calcom/trpc/react";
import { Check, MessageSquareWarning } from "lucide-react";
import { useState } from "react";

/**
 * "They want to cancel" — taken at the counter, decided elsewhere.
 *
 * The desk cannot cancel a room and this does not let it: no refund, no slot
 * released, nothing an exhibitor can read as a yes. It records who asked and
 * what they said, and mails sales. That is the whole feature, and saying so on
 * the screen matters as much as doing it — a hostess who believes she has just
 * cancelled a room will tell the exhibitor so.
 *
 * Asked in two steps, like everything here that cannot be taken back by the
 * person pressing it. A counter is a place of elbows and interruptions.
 *
 * Red, on the button and on the question. Not because anything is destroyed —
 * nothing is — but because this is the one thing at the desk that sets a refund
 * in motion somewhere else, and it should not be reachable by a thumb aiming at
 * Check in. The wording carries the rest: red says stop and read, the sentence
 * says nothing has happened yet.
 */
export default function CancelRequestButton({
  uid,
  roomLabel,
  requestedAt,
  requestedBy,
  onDone,
  compact,
}: {
  uid: string;
  roomLabel: string;
  /** Already asked for: the button becomes a statement. */
  requestedAt: string | null;
  requestedBy: string | null;
  onDone?: () => void;
  /** In a list row rather than a panel: smaller, and no free-text note. */
  compact?: boolean;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const request = trpc.viewer.rooms.deskRequestCancellation.useMutation({
    onSuccess: () => {
      setSent(true);
      setAsking(false);
      onDone?.();
    },
  });

  if (requestedAt || sent) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-gray-600 leading-snug">
        <Check className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        <span>
          Cancellation asked for{requestedBy ? ` by ${requestedBy}` : ""} — sales have it. The room is still
          booked until they decide.
        </span>
      </p>
    );
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={
          compact
            ? "whitespace-nowrap rounded-md border border-red-200 px-2 py-0.5 font-medium text-[11px] text-red-600 transition hover:border-red-400 hover:bg-red-50"
            : "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-medium text-red-700 text-sm transition hover:bg-red-100"
        }>
        <MessageSquareWarning className={compact ? "hidden" : "h-4 w-4 shrink-0"} aria-hidden />
        They want to cancel
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="font-medium text-red-900 text-sm">
        Tell sales that <span className="font-semibold">{roomLabel}</span> is being given back?
      </p>
      <p className="mt-1 text-red-800/80 text-xs">
        Nothing is cancelled and nothing is refunded here — the room stays booked and stays theirs until sales
        decide. Say they will be contacted, not that it is done.
      </p>

      {compact ? null : (
        <input
          type="text"
          value={note}
          maxLength={400}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything they said (optional)"
          aria-label="What the exhibitor said"
          className="mt-3 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
        />
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={request.isPending}
          onClick={() => request.mutate({ uid, note: note.trim() || undefined })}
          className="flex-1 rounded-lg bg-red-600 px-3 py-2.5 font-medium text-sm text-white transition hover:bg-red-700 disabled:opacity-50">
          {request.isPending ? "Sending…" : "Yes, tell sales"}
        </button>
        <button
          type="button"
          disabled={request.isPending}
          onClick={() => {
            setAsking(false);
            setNote("");
            request.reset();
          }}
          className="flex-1 rounded-lg border border-red-200 bg-white px-3 py-2.5 font-medium text-[#000643] text-sm transition hover:border-[#000643] disabled:opacity-50">
          Not now
        </button>
      </div>

      {request.error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-300 bg-white px-2.5 py-1.5 font-medium text-red-700 text-xs">
          {request.error.message}
        </p>
      ) : null}
    </div>
  );
}
