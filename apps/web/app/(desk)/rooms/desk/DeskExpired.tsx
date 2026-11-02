"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { exitDeskMode } from "./deskExit";

/**
 * What the counter tablet shows once its shift has ended.
 *
 * A shift ends by itself at 04:00, because the name typed when the tablet was
 * handed over is what the audit trail records and yesterday's hostess has gone
 * home. Ending it used to mean the lock simply stopped applying: the next
 * morning the tablet was a full administrator session — pricing, refunds,
 * accounts — in the hands of whoever picked it up, with nothing on screen
 * saying so.
 *
 * So it ends here instead. Nothing works, the admin stays shut, and the only
 * way on is the PIN — the same PIN, with the same lockout, that leaving desk
 * mode has always needed.
 */
export default function DeskExpired({ hostessName }: { hostessName: string }): JSX.Element {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const message = await exitDeskMode(pin);
      if (message) {
        setError(message);
        setPin("");
        return;
      }
      // Straight to where a tablet is handed over, since that is almost always
      // what comes next: unlock, type today's name, give it back.
      router.push("/rooms/admin/access");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#000643] text-white">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6">
          <span className="font-semibold text-base sm:text-lg">Welcome desk — Meeting rooms</span>
        </div>
      </div>

      <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-[#000643]">
            <Lock className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="mt-4 font-bold text-[#000643] text-2xl">This shift has ended</h1>
          <p className="mt-2 text-gray-600 text-sm">
            The tablet was handed over to {hostessName}, and that shift is over. Nothing can be done from here
            until someone starts a new one.
          </p>
          <p className="mt-2 text-gray-600 text-sm">
            Enter the PIN to unlock it, then hand it over again under today's name.
          </p>

          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            aria-label="PIN"
            className="mt-5 w-full rounded-lg border border-gray-200 px-4 py-3 text-center text-2xl tracking-[0.5em] focus:border-[#000643] focus:outline-none"
          />
          {error ? (
            <p role="alert" className="mt-2 text-red-600 text-sm">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={pin.length !== 4 || busy}
            onClick={() => void unlock()}
            className="mt-4 w-full rounded-lg bg-[#000643] px-4 py-3 font-medium text-sm text-white disabled:opacity-40">
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </main>
    </div>
  );
}
