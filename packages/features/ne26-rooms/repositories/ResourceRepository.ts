import type { PrismaClient } from "@calcom/prisma";

const publicSelect = {
  id: true,
  name: true,
  slug: true,
  category: true,
  capacity: true,
  surface: true,
  price1h: true,
  price2h: true,
  price3h: true,
  currency: true,
  description: true,
} as const;

export class ResourceRepository {
  constructor(private prismaClient: PrismaClient) {}

  findManyActive() {
    return this.prismaClient.resource.findMany({
      where: { isActive: true },
      select: publicSelect,
      orderBy: { id: "asc" },
    });
  }

  findBySlug(slug: string) {
    return this.prismaClient.resource.findUnique({
      where: { slug },
      select: { ...publicSelect, isActive: true },
    });
  }
}
