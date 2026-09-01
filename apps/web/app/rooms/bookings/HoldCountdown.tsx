"use client";

import { useEffect, useState } from "react";

/**
 * How long is left to pay, ticking down.
 *
 * The hold was invisible: a buyer left the payment page to fetch a purchase
 * order, came back, and the room was gone with nothing having said it would be.
 * Rendered on the client because the server's "23 minutes" is stale the moment
 * it is sent, and this number is the whole point.
 */
export default function HoldCountdown({ expiresAt }: { expiresAt: string }): JSX.Element {
  const target = new Date(expiresAt).getTime();
  // Null until mounted: the server has no clock the buyer can trust, and
  // rendering a number here would mismatch on hydration.
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setMsLeft(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  if (msLeft === null) return <span className="text-gray-400 text-xs">Held for a short while</span>;
  if (msLeft <= 0) {
    return (
      <span className="font-medium text-red-600 text-xs">
        Hold expired — the room is back on sale
      </span>
    );
  }

  const totalSeconds = Math.floor(msLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  // Under five minutes it stops being information and becomes a warning.
  const urgent = msLeft < 5 * 60_000;

  return (
    <span className={`font-medium text-xs tabular-nums ${urgent ? "text-red-600" : "text-amber-700"}`}>
      {minutes}:{String(seconds).padStart(2, "0")} left to pay
    </span>
  );
}
