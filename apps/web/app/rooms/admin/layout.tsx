import type { ReactNode } from "react";
import AdminNav from "./AdminNav";

// Shared admin chrome (the tab nav). Authorization stays in each page.tsx —
// layouts don't intercept every request, so they must never gate access.
export default function RoomsAdminLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div>
      <AdminNav />
      {children}
    </div>
  );
}
