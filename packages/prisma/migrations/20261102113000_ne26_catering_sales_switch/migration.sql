-- NE26: one switch for whether catering is on sale.
--
-- Closed by default, deliberately. The caterer needs notice and, once their
-- order is placed, nothing more can be served — but the rooms themselves keep
-- selling up to the slot, and did so while catering was still being offered
-- alongside them. An admin opens this when the kitchen says they can take more.
ALTER TABLE "Ne26RoomSettings" ADD COLUMN "cateringSalesOpen" BOOLEAN NOT NULL DEFAULT false;
