import type { PrismaClient } from "@calcom/prisma";
import type { ResourceCategory } from "@calcom/prisma/enums";

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
  imageUrl: true,
  galleryImages: true,
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

  /** All rooms (active and inactive) with the fields the admin can edit. */
  findAllForAdmin() {
    return this.prismaClient.resource.findMany({
      orderBy: { id: "asc" },
      select: { ...publicSelect, isActive: true },
    });
  }

  /** Admin: update a room's editable fields (name, prices in cents, etc.). */
  update(
    id: number,
    data: {
      name?: string;
      description?: string | null;
      category?: ResourceCategory;
      capacity?: number;
      surface?: number;
      price1h?: number;
      price2h?: number;
      price3h?: number;
      imageUrl?: string | null;
      galleryImages?: string[];
      isActive?: boolean;
    }
  ) {
    return this.prismaClient.resource.update({
      where: { id },
      data,
      select: { ...publicSelect, isActive: true },
    });
  }
}
