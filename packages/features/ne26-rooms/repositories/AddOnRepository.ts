import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import type { AddOnPriceType } from "@calcom/prisma/enums";

const publicSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  price: true,
  currency: true,
  priceType: true,
  vatRate: true,
  // The serving window travels with the add-on everywhere: the room page needs
  // it to grey the option out, and the order path needs it to refuse one that
  // was posted anyway.
  availableFromMinute: true,
  availableToMinute: true,
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

  /** Admin: update an add-on's editable fields (name, price in cents, VAT in bp). */
  update(
    id: number,
    data: {
      name?: string;
      description?: string | null;
      priceType?: AddOnPriceType;
      price?: number;
      vatRate?: number;
      isActive?: boolean;
      availableFromMinute?: number | null;
      availableToMinute?: number | null;
    }
  ) {
    return this.prismaClient.addOn.update({
      where: { id },
      data,
      select: { ...publicSelect, isActive: true },
    });
  }

  /** Admin: create a new add-on. Slug must be unique (caller derives it). */
  async create(data: {
    name: string;
    slug: string;
    description?: string | null;
    priceType: AddOnPriceType;
    price: number;
    currency?: string;
    vatRate: number;
    isActive?: boolean;
  }) {
    try {
      return await this.prismaClient.addOn.create({
        data,
        select: { ...publicSelect, isActive: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ErrorWithCode(
          ErrorCode.BadRequest,
          `An add-on with the slug "${data.slug}" already exists.`
        );
      }
      throw e;
    }
  }

  /**
   * Admin: delete an add-on. Refused if it is referenced by any booking (FK) —
   * deactivate it instead so past invoices keep their lines.
   */
  async delete(id: number): Promise<void> {
    try {
      await this.prismaClient.addOn.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ErrorWithCode(
          ErrorCode.BadRequest,
          "This add-on is used by existing bookings — deactivate it instead of deleting."
        );
      }
      throw e;
    }
  }
}
