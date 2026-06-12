"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

// A stable username derived from the email (Cal requires one).
function usernameFromEmail(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function SignupForm(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params?.get("callbackUrl") || "/rooms";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameFromEmail(email),
          email,
          password,
          language: "en",
          callbackUrl: "/rooms",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message || "Could not create the account.");
        return;
      }
      // Account created — sign in and send them to their billing details.
      const login = await signIn("credentials", { email, password, redirect: false, callbackUrl });
      router.push(login && !login.error ? "/rooms/account" : "/rooms/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="font-bold text-2xl text-[#000643]">Create your account</h1>
        <p className="mt-1 text-gray-600 text-sm">
          Register as an exhibitor to book NATO Edge 26 meeting rooms.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="font-medium text-gray-700 text-sm">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="font-medium text-gray-700 text-sm">Password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="mt-1 block text-gray-400 text-xs">
              At least 7 characters, including a number and an uppercase letter.
            </span>
          </label>

          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-gray-600 text-sm">
          Already have an account?{" "}
          <Link
            href={`/rooms/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="font-semibold text-[#000643] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
