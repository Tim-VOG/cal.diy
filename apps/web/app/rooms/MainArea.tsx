"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Where the shortlist panel is parked, and therefore where it must not sit. */
const SHOPPING_PANEL_PREFIXES = ["/rooms/admin", "/rooms/desk", "/rooms/login", "/rooms/signup"];

/**
 * The page's content area, sized for what is beside it.
 *
 * The shortlist panel is fixed to the right on a wide screen, so the shopping
 * pages reserve that width or the panel would sit on top of them. The admin has
 * no panel and no reason to be narrowed — the bookings table wants every pixel
 * — so it gets the full width and a wider container than the public pages,
 * which are a reading width on purpose.
 */
export default function MainArea({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname();
  const isAdmin = SHOPPING_PANEL_PREFIXES.some((p) => pathname?.startsWith(p));

  return (
    <main
      className={
        isAdmin
          ? "w-full flex-1 px-4 py-8 sm:px-6"
          : "mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 xl:pr-[23rem]"
      }>
      {children}
    </main>
  );
}
