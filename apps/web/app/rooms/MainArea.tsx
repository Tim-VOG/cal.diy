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
export default function MainArea({ children, nav }: { children: ReactNode; nav?: ReactNode }): JSX.Element {
  const pathname = usePathname();
  const isAdmin = SHOPPING_PANEL_PREFIXES.some((p) => pathname?.startsWith(p));

  // Signed in: the site navigation rail sits to the left of the page. The
  // shopping pages keep room on the right for the shortlist panel, so they get
  // a wider container to make up for the rail rather than a narrower page.
  if (nav) {
    return (
      <main
        className={
          isAdmin
            ? "w-full flex-1 px-4 py-8 sm:px-6"
            : "mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 xl:pr-[23rem]"
        }>
        <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          {nav}
          <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
        </div>
      </main>
    );
  }

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
