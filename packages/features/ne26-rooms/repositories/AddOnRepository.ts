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
}
