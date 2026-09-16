"use client";

import { fmtCountdown, fmtTime } from "../../format";
import { useNow } from "../../ui";

/** "14:32 (12:05 left)", ticking; just the time until the page has mounted. */
export default function HoldCountdownText({ expiresAt }: { expiresAt: string }): JSX.Element {
  const now = useNow();
  const left = now ? new Date(expiresAt).getTime() - now.getTime() : null;
  return (
    <span className="tabular-nums">
      {fmtTime(expiresAt)}
      {left !== null ? (
        <span className={left < 5 * 60_000 ? "text-red-600" : "text-amber-700"}>
          {" "}
          ({left > 0 ? `${fmtCountdown(left)} left` : "lapsed"})
        </span>
      ) : null}
    </span>
  );
}
