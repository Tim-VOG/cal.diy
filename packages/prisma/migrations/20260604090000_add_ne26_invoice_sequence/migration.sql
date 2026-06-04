-- Sequence backing NE26 invoice numbers (NE26-2026-0001, 0002, …).
-- Not a Prisma model: numbers are allocated via nextval() in the repository.
CREATE SEQUENCE IF NOT EXISTS "ne26_invoice_seq" AS integer START WITH 1 INCREMENT BY 1;
