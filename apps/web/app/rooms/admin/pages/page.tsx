import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26LegalPageRepository } from "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import LegalPagesManager from "./LegalPagesManager";

export const metadata: Metadata = {
  title: "Pages · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function ManageLegalPagesPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/pages");
  if (session.user.role !== "ADMIN") notFound();

  const pages = await getNe26LegalPageRepository().findAllForAdmin();
  return (
    <LegalPagesManager
      pages={pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        content: p.content,
        published: p.published,
      }))}
    />
  );
}
