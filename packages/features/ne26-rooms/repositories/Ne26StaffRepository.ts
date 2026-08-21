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
