import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getAddOnRepository } from "@calcom/features/ne26-rooms/di/AddOnRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import AddOnsManager from "./AddOnsManager";

export const metadata: Metadata = {
  title: "Manage add-ons · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function ManageAddOnsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/rooms/admin/addons");
  if (session.user.role !== "ADMIN") notFound();

  const addOns = await getAddOnRepository().findAllForAdmin();
  return (
    <AddOnsManager
      addOns={addOns.map((a) => ({
        id: a.id,
        name: a.name,
        priceType: a.priceType,
        price: a.price,
        currency: a.currency,
        vatRate: a.vatRate,
        isActive: a.isActive,
      }))}
    />
  );
}
