"use client";

import { signOut } from "next-auth/react";

export default function LogoutButton(): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/rooms/login" })}
      className="rounded-md border border-white/30 px-3 py-1 text-sm transition hover:bg-white/10">
      Log out
    </button>
  );
}
