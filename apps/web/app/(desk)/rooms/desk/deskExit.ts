"use client";

/**
 * Leave desk mode with the PIN. Returns null when it worked, or the message to
 * show when it did not.
 *
 * Shared by the header (a shift in progress, handed back to an admin) and the
 * expired screen (a shift that ran out overnight), because both are the same
 * act: the one thing that clears the cookie is this PIN.
 */
export async function exitDeskMode(pin: string): Promise<string | null> {
  const res = await fetch("/api/ne26-rooms/desk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "exit", pin }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? null : json.error || "Wrong PIN.";
}
