-- NE26: event staff roles and an action trail.
--
-- Cal's User.role already carries ADMIN and stays the source of truth for
-- administrators; this table only adds roles Cal has no concept of, so there is
-- never more than one answer to "is this person an admin?".
--
-- The audit log denormalises the actor's email and role on purpose: a welcome
-- desk runs on a shared tablet, so the account is several people, and the trail
-- has to survive that account being deleted.
CREATE TYPE "Ne26StaffRoleType" AS ENUM ('HOSTESS');

CREATE TABLE "Ne26StaffRole" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "Ne26StaffRoleType" NOT NULL,
    "grantedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ne26StaffRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ne26StaffRole_userId_key" ON "Ne26StaffRole"("userId");

ALTER TABLE "Ne26StaffRole" ADD CONSTRAINT "Ne26StaffRole_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Ne26AuditLog" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER,
    "actorEmail" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ne26AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ne26AuditLog_createdAt_idx" ON "Ne26AuditLog"("createdAt");
CREATE INDEX "Ne26AuditLog_action_idx" ON "Ne26AuditLog"("action");
