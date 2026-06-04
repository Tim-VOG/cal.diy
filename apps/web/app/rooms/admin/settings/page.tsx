import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getInvoiceSettingsRepository } from "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import InvoiceSettingsForm from "./InvoiceSettingsForm";

export const metadata: Metadata = {
  title: "Invoice settings · NATO Edge 26",
  robots: { index: false, follow: false },
};

export default async function InvoiceSettingsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/rooms/admin/settings");
  if (session.user.role !== "ADMIN") notFound();

  const settings = await getInvoiceSettingsRepository().get();
  return <InvoiceSettingsForm initial={settings} />;
}
