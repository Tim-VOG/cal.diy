-- NE26: when an order was paid, as opposed to when it was placed.
--
-- The desk reconciles against Stripe by date and had neither: createdAt lives on
-- the order but was not surfaced, and the moment of payment was not recorded at
-- all. Two different questions, two columns.
ALTER TABLE "Ne26Order" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Orders already confirmed before this column existed: the best available
-- answer is when the row was last written, which for a confirmed order is its
-- confirmation. Left NULL for anything unpaid, where there is no answer.
UPDATE "Ne26Order" SET "paidAt" = "updatedAt" WHERE "status" = 'CONFIRMED';
