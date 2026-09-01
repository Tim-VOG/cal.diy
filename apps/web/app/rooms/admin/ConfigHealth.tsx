import {
  type ConfigSettings,
  checkNe26ConfigFromProcess,
} from "@calcom/features/ne26-rooms/lib/configCheck";
import { AlertTriangle, XOctagon } from "lucide-react";

/**
 * Deployment problems that are invisible until money moves — test Stripe keys,
 * a missing webhook secret, invoices being written somewhere the next deploy
 * wipes, email still diverted to one test address.
 *
 * Shown at the top of the dashboard because that is where the person who can
 * fix them actually looks, and because each of these is only ever discovered
 * after the sale it broke.
 */
export default function ConfigHealth({
  settings,
}: {
  /** From the database, which env alone cannot see — the page fetches it. */
  settings: ConfigSettings;
}): JSX.Element | null {
  const issues = checkNe26ConfigFromProcess(settings);
  if (!issues.length) return null;

  return (
    <section className="mb-6 space-y-2" aria-label="Deployment checks">
      {issues.map((issue) => {
        const isError = issue.level === "error";
        const Icon = isError ? XOctagon : AlertTriangle;
        return (
          <div
            key={issue.key}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
              isError ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
            }`}>
            <Icon
              className={`mt-0.5 h-5 w-5 shrink-0 ${isError ? "text-red-600" : "text-amber-600"}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className={`font-semibold text-sm ${isError ? "text-red-800" : "text-amber-900"}`}>
                {issue.title}
              </p>
              <p className={`mt-0.5 text-sm ${isError ? "text-red-700" : "text-amber-800"}`}>
                {issue.detail}
              </p>
              <p className="mt-1 font-mono text-gray-500 text-xs">{issue.key}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
