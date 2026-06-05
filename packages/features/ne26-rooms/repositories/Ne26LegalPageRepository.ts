import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";

const adminSelect = {
  id: true,
  slug: true,
  title: true,
  content: true,
  published: true,
  updatedAt: true,
} as const;

const publicSelect = {
  slug: true,
  title: true,
  content: true,
} as const;

export class Ne26LegalPageRepository {
  constructor(private prismaClient: PrismaClient) {}

  /** All pages (published and drafts) for admin management. */
  findAllForAdmin() {
    return this.prismaClient.ne26LegalPage.findMany({
      orderBy: { slug: "asc" },
      select: adminSelect,
    });
  }

  /** A single published page for public rendering; null if missing or a draft. */
  findPublishedBySlug(slug: string) {
    return this.prismaClient.ne26LegalPage.findFirst({
      where: { slug, published: true },
      select: publicSelect,
    });
  }

  async create(data: { slug: string; title: string; content: string; published?: boolean }) {
    try {
      return await this.prismaClient.ne26LegalPage.create({ data, select: adminSelect });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ErrorWithCode(ErrorCode.BadRequest, `A page with the slug "${data.slug}" already exists.`);
      }
      throw e;
    }
  }

  async update(id: number, data: { slug?: string; title?: string; content?: string; published?: boolean }) {
    try {
      return await this.prismaClient.ne26LegalPage.update({ where: { id }, data, select: adminSelect });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ErrorWithCode(ErrorCode.BadRequest, `A page with the slug "${data.slug}" already exists.`);
      }
      throw e;
    }
  }

  async delete(id: number): Promise<void> {
    await this.prismaClient.ne26LegalPage.delete({ where: { id } });
  }
}
