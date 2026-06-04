import type { Metadata } from "next";
import { Suspense } from "react";
import SignupForm from "./SignupForm";

export const metadata: Metadata = {
  title: "Create account · NATO Edge 26 Rooms",
  robots: { index: false, follow: false },
};

export default function RoomsSignupPage(): JSX.Element {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
