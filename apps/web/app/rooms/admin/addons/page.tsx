import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getAddOnRepository } from "@calcom/features/ne26-rooms/di/AddOnRepository.container";
import { buildEventSchedule } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { kitchenSheet } from "@calcom/features/ne26-rooms/lib/kitchenSheet";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadAdminBookings } from "../adminData";
import { requireNotDeskMode } from "../requireNotDeskMode";
import AddOnsManager from "./AddOnsManager";
import KitchenSheet from "./KitchenSheet";

export const metadata: Metadata = {
  title: "Manage add-ons · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function ManageAddOnsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/addons");
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  const [addOns, data] = await Promise.all([getAddOnRepository().findAllForAdmin(), loadAdminBookings()]);
  const days = kitchenSheet({
    schedule: buildEventSchedule(data.roomSettings.eventDays),
    bookings: data.rows,
    addOnOrder: addOns.map((a) => a.name),
  });
  return (
    <AddOnsManager
      kitchen={<KitchenSheet days={days} />}
      addOns={addOns.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description ?? "",
        priceType: a.priceType,
        price: a.price,
        currency: a.currency,
        vatRate: a.vatRate,
        isActive: a.isActive,
        availableFromMinute: a.availableFromMinute,
        availableToMinute: a.availableToMinute,
      }))}
    />
  );
}
