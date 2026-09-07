-- NE26: remember that the team has already been told about a failed payment
-- attempt on this order, so a buyer trying three cards produces one follow-up
-- rather than three.
ALTER TABLE "Ne26Order" ADD COLUMN "paymentFailedNotifiedAt" TIMESTAMP(3);
