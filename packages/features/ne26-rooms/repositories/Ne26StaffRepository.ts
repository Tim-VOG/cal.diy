import type { PrismaClient } from "@calcom/prisma";

export interface StaffMember {
  userId: number;
  email: string;
  name: string | null;
  /** Cal's own role — "ADMIN" for administrators. */
  calRole: string;
  staffRole: "HOSTESS" | null;
  grantedAt: Date | null;
}

export interface AuditEntry {
  id: number;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  createdAt: Date;
}

/** An exhibitor account: someone who buys, as opposed to someone who works here. */
export interface BookerAccount {
  userId: number;
  email: string;
  name: string | null;
  createdAt: Date;
  /** Orders that could be removed with the account. */
  undocumentedOrders: number;
  /** Orders carrying an invoice or a credit note. These always survive. */
  documentedOrders: number;
}

export interface DeleteBookerResult {
  deleted: boolean;
  /** Why not, when it was refused — so the screen can say something true. */
  refusedBecause?: "staff" | "missing";
  ordersDeleted: number;
  ordersKept: number;
}

export interface RecordActionInput {
  actorUserId: number | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: string | null;
}

export class Ne26StaffRepository {
  constructor(private prismaClient: PrismaClient) {}

  /** The NE26 staff role for one account, if any. */
  async findStaffRole(userId: number): Promise<"HOSTESS" | null> {
    const row = await this.prismaClient.ne26StaffRole.findUnique({
      where: { userId },
      select: { role: true },
    });
    return row?.role ?? null;
  }

  /**
   * Everyone who holds a role: Cal admins and NE26 staff, in one list.
   *
   * Two queries rather than one, because the two roles live in different places
   * on purpose (see lib/staff.ts) and neither is a subset of the other.
   */
  async listStaff(): Promise<StaffMember[]> {
    const [admins, staff] = await Promise.all([
      this.prismaClient.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true, email: true, name: true, role: true },
        orderBy: { email: "asc" },
      }),
      this.prismaClient.ne26StaffRole.findMany({
        select: {
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const byUserId = new Map<number, StaffMember>();
    for (const admin of admins) {
      byUserId.set(admin.id, {
        userId: admin.id,
        email: admin.email,
        name: admin.name,
        calRole: admin.role,
        staffRole: null,
        grantedAt: null,
      });
    }
    for (const row of staff) {
      const existing = byUserId.get(row.user.id);
      if (existing) {
        // An admin who also holds a staff role appears once, with both shown.
        existing.staffRole = row.role;
        existing.grantedAt = row.createdAt;
        continue;
      }
      byUserId.set(row.user.id, {
        userId: row.user.id,
        email: row.user.email,
        name: row.user.name,
        calRole: row.user.role,
        staffRole: row.role,
        grantedAt: row.createdAt,
      });
    }
    return Array.from(byUserId.values()).sort((a, b) => a.email.localeCompare(b.email));
  }

  /**
   * Everyone with an account who is not staff.
   *
   * The Bookers screen is built from BOOKINGS, so it cannot see an exhibitor who
   * registered and never got as far as buying — which is most of them on the
   * first day, and every test account. This is the account side of the same
   * people, counted by what would survive their removal.
   */
  async listBookerAccounts(): Promise<BookerAccount[]> {
    const staffIds = (await this.prismaClient.ne26StaffRole.findMany({ select: { userId: true } })).map(
      (r) => r.userId
    );
    const users = await this.prismaClient.user.findMany({
      where: { role: { not: "ADMIN" }, id: { notIn: staffIds } },
      select: { id: true, email: true, name: true, createdDate: true },
      orderBy: { createdDate: "desc" },
    });
    if (users.length === 0) return [];

    // Two counts in one pass rather than a query per account.
    const orders = await this.prismaClient.ne26Order.findMany({
      where: { bookerUserId: { in: users.map((u) => u.id) } },
      select: { bookerUserId: true, invoiceNumber: true, creditNoteNumber: true },
    });
    const counts = new Map<number, { documented: number; undocumented: number }>();
    for (const order of orders) {
      if (order.bookerUserId === null) continue;
      const entry = counts.get(order.bookerUserId) ?? { documented: 0, undocumented: 0 };
      if (order.invoiceNumber || order.creditNoteNumber) entry.documented += 1;
      else entry.undocumented += 1;
      counts.set(order.bookerUserId, entry);
    }

    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdDate,
      undocumentedOrders: counts.get(u.id)?.undocumented ?? 0,
      documentedOrders: counts.get(u.id)?.documented ?? 0,
    }));
  }

  /**
   * Remove an exhibitor account, and the orders of theirs that never became a
   * document.
   *
   * Those orders go with the account because leaving them behind would leave
   * rooms held by somebody who no longer exists. Deleting them cascades to the
   * bookings and their slot rows, which is what puts the rooms back on sale.
   *
   * Anything carrying an invoice or a credit note stays, and stays complete: the
   * order froze the buyer's name, email and billing address at the time of sale,
   * and there is no foreign key from the order to the account, so the record the
   * accountant needs survives the account being gone.
   *
   * Refuses staff outright. Administrators and hostesses are managed on the
   * Access page, where removing a role is reversible; this is not.
   */
  async deleteBookerAccount(userId: number): Promise<DeleteBookerResult> {
    return this.prismaClient.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!user) return { deleted: false, refusedBecause: "missing" as const, ordersDeleted: 0, ordersKept: 0 };
      const staffRole = await tx.ne26StaffRole.findUnique({ where: { userId }, select: { id: true } });
      if (user.role === "ADMIN" || staffRole) {
        return { deleted: false, refusedBecause: "staff" as const, ordersDeleted: 0, ordersKept: 0 };
      }

      const removed = await tx.ne26Order.deleteMany({
        where: { bookerUserId: userId, invoiceNumber: null, creditNoteNumber: null },
      });
      const ordersKept = await tx.ne26Order.count({ where: { bookerUserId: userId } });
      await tx.user.delete({ where: { id: userId } });
      return { deleted: true, ordersDeleted: removed.count, ordersKept };
    });
  }

  /** Look an account up by email, so a role can be granted without an id. */
  findUserByEmail(email: string) {
    return this.prismaClient.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  async grantHostess(userId: number, grantedByUserId: number): Promise<void> {
    await this.prismaClient.ne26StaffRole.upsert({
      where: { userId },
      create: { userId, role: "HOSTESS", grantedByUserId },
      update: { role: "HOSTESS", grantedByUserId },
    });
  }

  async revokeStaffRole(userId: number): Promise<void> {
    await this.prismaClient.ne26StaffRole.deleteMany({ where: { userId } });
  }

  async setCalRole(userId: number, role: "ADMIN" | "USER"): Promise<void> {
    await this.prismaClient.user.update({ where: { id: userId }, data: { role } });
  }

  /** How many admins remain — the guard against locking everyone out. */
  countAdmins(): Promise<number> {
    return this.prismaClient.user.count({ where: { role: "ADMIN" } });
  }

  /**
   * Append to the trail. Never throws: an action that succeeded must not be
   * reported as failed because its log line could not be written.
   */
  async recordAction(input: RecordActionInput): Promise<void> {
    try {
      await this.prismaClient.ne26AuditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          detail: input.detail ?? null,
        },
      });
    } catch {
      // Swallowed on purpose — see above.
    }
  }

  listRecentActions(limit = 200): Promise<AuditEntry[]> {
    return this.prismaClient.ne26AuditLog.findMany({
      select: {
        id: true,
        actorEmail: true,
        actorRole: true,
        action: true,
        targetType: true,
        targetId: true,
        detail: true,
        createdAt: true,
      },
      orderBy: { id: "desc" },
      take: limit,
    });
  }
}
