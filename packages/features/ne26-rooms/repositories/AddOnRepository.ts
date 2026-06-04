import type { PrismaClient } from "@calcom/prisma";

const publicSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  price: true,
  currency: true,
  priceType: true,
  vatRate: true,
} as const;

export class AddOnRepository {
  constructor(private prismaClient: PrismaClient) {}

  findManyActive() {
    return this.prismaClient.addOn.findMany({
      where: { isActive: true },
      select: publicSelect,
      orderBy: { id: "asc" },
    });
  }

  findManyActiveBySlugs(slugs: string[]) {
    return this.prismaClient.addOn.findMany({
      where: { isActive: true, slug: { in: slugs } },
      select: publicSelect,
    });
  }

  /** All add-ons (active and inactive) for admin management. */
  findAllForAdmin() {
    return this.prismaClient.addOn.findMany({
      orderBy: { id: "asc" },
      select: { ...publicSelect, isActive: true },
    });
  }

  /** Admin: update an add-on's editable fields (price in cents, VAT in bp). */
  update(id: number, data: { price?: number; vatRate?: number; isActive?: boolean }) {
    return this.prismaClient.addOn.update({
      where: { id },
      data,
      select: { ...publicSelect, isActive: true },
    });
  }
}
