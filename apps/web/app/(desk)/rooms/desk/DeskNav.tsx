"use client";

import { CalendarDays, LayoutGrid, Lock, PlusCircle, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const TABS = [
  { href: "/rooms/desk", label: "Today", icon: CalendarDays },
  // The board answers "what is free this afternoon"; the day list answers "who
  // is arriving now". Both are needed, so neither replaces the other.
  { href: "/rooms/desk/planning", label: "Planning", icon: LayoutGrid },
  { href: "/rooms/desk/search", label: "Find", icon: Search },
  { href: "/rooms/desk/new", label: "New", icon: PlusCircle },
];

/**
 * The desk header.
 *
 * The navy bar carries the title and nothing else; the tabs sit below it on a
 * light background where they are legible at arm's length on a tablet. Touch
 * targets are deliberately large — this is used standing up, one-handed, while
 * talking to someone.
 */
export default function DeskNav({
  isAdmin,
  hostessName,
}: {
  isAdmin: boolean;
  hostessName: string | null;
}): JSX.Element {
  const pathname = usePathname() ?? "/rooms/desk";
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exitDesk(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ne26-rooms/desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exit", pin }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Wrong PIN.");
        setPin("");
        return;
      }
      router.push("/rooms/admin");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <header>
      <div className="bg-[#000643] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="font-semibold text-base sm:text-lg">Welcome desk — Meeting rooms</span>
          {hostessName ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/30 px-2.5 py-1 font-medium text-sm transition hover:bg-white/10">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {hostessName}
            </button>
          ) : isAdmin ? (
            <Link
              href="/rooms/admin"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/30 px-2.5 py-1 font-medium text-sm transition hover:bg-white/10">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Admin
            </Link>
          ) : null}
        </div>
      </div>

      <nav className="border-gray-200 border-b bg-white">
        <div className="mx-auto flex max-w-5xl">
          {TABS.map((tab) => {
            const active =
              tab.href === "/rooms/desk" ? pathname === tab.href : pathname.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-4 font-medium text-sm transition ${
                  active
                    ? "border-[#000643] text-[#000643]"
                    : "border-transparent text-gray-500 hover:text-[#000643]"
                }`}>
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {asking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="font-semibold text-[#000643] text-lg">Leave desk mode</h2>
            <p className="mt-1 text-gray-600 text-sm">
              Enter the four-digit PIN to unlock the admin on this tablet.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              autoFocus
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              aria-label="PIN"
              className="mt-4 w-full rounded-lg border border-gray-200 px-4 py-3 text-center text-2xl tracking-[0.5em] focus:border-[#000643] focus:outline-none"
            />
            {error ? <p className="mt-2 text-red-600 text-sm">{error}</p> : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAsking(false);
                  setPin("");
                  setError(null);
                }}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-3 font-medium text-[#000643] text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={pin.length !== 4 || busy}
                onClick={() => void exitDesk()}
                className="flex-1 rounded-lg bg-[#000643] px-4 py-3 font-medium text-sm text-white disabled:opacity-40">
                {busy ? "Checking…" : "Unlock"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
