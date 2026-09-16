import type { ReactNode } from "react";

// The admin's navigation now lives in the site-wide rail (rooms/layout.tsx), so
// this layout adds nothing. Authorization stays in each page.tsx — layouts
// don't intercept every request, so they must never gate access.
export default function RoomsAdminLayout({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
