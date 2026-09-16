-- NE26: a human order number, "NE26-ORD-0042" once formatted.
--
-- Orders were identified by a uuid, or by their invoice number once one
-- existed — so an unpaid order, or a paid one whose invoice failed, had no
-- number anyone could read out, search for or quote to Stripe.
--
-- SERIAL numbers any existing rows in creation order is not guaranteed, so
-- they are numbered explicitly by createdAt first; new rows then continue the
-- sequence from the highest number.
ALTER TABLE "Ne26Order" ADD COLUMN "orderNumber" INTEGER;

CREATE SEQUENCE "Ne26Order_orderNumber_seq" OWNED BY "Ne26Order"."orderNumber";

UPDATE "Ne26Order" o
SET "orderNumber" = numbered.n
FROM (SELECT uid, ROW_NUMBER() OVER (ORDER BY "createdAt", uid) AS n FROM "Ne26Order") numbered
WHERE o.uid = numbered.uid;

SELECT setval('"Ne26Order_orderNumber_seq"', COALESCE((SELECT MAX("orderNumber") FROM "Ne26Order"), 0) + 1, false);

ALTER TABLE "Ne26Order"
  ALTER COLUMN "orderNumber" SET DEFAULT nextval('"Ne26Order_orderNumber_seq"'),
  ALTER COLUMN "orderNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Ne26Order_orderNumber_key" ON "Ne26Order"("orderNumber");
