-- NE26: remember the Stripe Checkout session open for an order, so it can be
-- expired when the order is superseded or released. A live session over a
-- deleted order takes money for rooms nobody holds.
ALTER TABLE "Ne26Order" ADD COLUMN "stripeSessionId" TEXT;
