"use client";

import { trpc } from "@calcom/trpc/react";
import { Check, KeyRound, Tablet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

/**
 * Put this tablet into desk mode, and set the PIN that gets it back out.
 *
 * There is no hostess account: a different person works the desk each day, and
 * issuing logins for each of them is friction nobody keeps up with mid-event.
 * Instead an admin hands over a tablet that is locked to the desk, having typed
 * in who is taking it — that name, not the account, is what the trail records.
 */
export default function DeskModeCard(): JSX.Element {
  const router = useRouter();
  const status = trpc.viewer.rooms.deskPinStatus.useQuery();
  const setPin = trpc.viewer.rooms.setDeskPin.useMutation({
    onSuccess: () => {
      setPinValue("");
      void status.refetch();
    },
  });

  const [pinValue, setPinValue] = useState("");
  const [hostess, setHostess] = useState("");
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);

  async function enterDesk(): Promise<void> {
    setEntering(true);
    setEnterError(null);
    try {
      const res = await fetch("/api/ne26-rooms/desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enter", hostessName: hostess }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setEnterError(json.error || "Could not start desk mode.");
        return;
      }
      router.push("/rooms/desk");
      router.refresh();
    } finally {
      setEntering(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 font-semibold text-[#000643] text-lg">
        <Tablet className="h-5 w-5 shrink-0" aria-hidden />
        Desk mode
      </h2>
      <p className="mt-1 text-gray-600 text-sm">
        Hands this tablet to the welcome desk. While desk mode is on, this session cannot reach pricing,
        refunds, bookings or accounts — not by button and not by URL. The PIN is the only way back.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <span className="flex items-center gap-1.5 font-medium text-gray-700 text-sm">
            <KeyRound className="h-4 w-4 shrink-0 text-[#000643]" aria-hidden />
            Exit PIN
          </span>
          <p className="mt-0.5 text-gray-500 text-xs">
            {status.data?.isSet
              ? "A PIN is set. Enter a new one to replace it."
              : "No PIN yet — desk mode cannot be started until you set one."}
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
            placeholder="4 digits"
            aria-label="Desk exit PIN"
            className={`${inputClass} tracking-[0.4em]`}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={pinValue.length !== 4 || setPin.isPending}
              onClick={() => setPin.mutate({ pin: pinValue })}
              className="rounded-lg bg-[#000643] px-3 py-1.5 font-semibold text-white text-xs transition hover:opacity-90 disabled:opacity-40">
              {setPin.isPending ? "Saving…" : status.data?.isSet ? "Replace PIN" : "Set PIN"}
            </button>
            {setPin.isSuccess ? (
              <span className="flex items-center gap-1 text-green-600 text-xs">
                <Check className="h-3.5 w-3.5" aria-hidden />
                Saved
              </span>
            ) : null}
          </div>
          {setPin.error ? <p className="mt-1 text-red-600 text-xs">{setPin.error.message}</p> : null}
        </div>

        <div>
          <span className="font-medium text-gray-700 text-sm">Start desk mode</span>
          <p className="mt-0.5 text-gray-500 text-xs">
            Who is taking the desk? Recorded against everything done during the shift.
          </p>
          <input
            type="text"
            value={hostess}
            onChange={(e) => setHostess(e.target.value)}
            placeholder="Hostess name"
            aria-label="Hostess name"
            className={inputClass}
          />
          <button
            type="button"
            disabled={!hostess.trim() || entering || !status.data?.isSet}
            onClick={() => void enterDesk()}
            className="mt-2 rounded-lg border border-[#000643] px-3 py-1.5 font-semibold text-[#000643] text-xs transition hover:bg-[#000643] hover:text-white disabled:opacity-40">
            {entering ? "Starting…" : "Hand over the tablet"}
          </button>
          {enterError ? <p className="mt-1 text-red-600 text-xs">{enterError}</p> : null}
        </div>
      </div>
    </section>
  );
}
