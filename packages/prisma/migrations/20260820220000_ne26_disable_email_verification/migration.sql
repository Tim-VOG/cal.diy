-- NE26: turn off Cal's signup email verification.
--
-- Exhibitors register at the booth, standing next to the hostess, and get access
-- to the rooms immediately — nothing in the NE26 flow gates on a verified
-- address. The verification mail was therefore pure friction: one more step, on
-- a phone, in a queue, for no security gain.
--
-- Cal seeds this flag to true in 20230523101834_email_verification_feature_flag.
-- Flipping it here rather than by hand on the server keeps every environment
-- consistent and survives a rebuild. Set it back to true to restore the mail.
UPDATE "Feature"
SET enabled = false, "updatedAt" = NOW()
WHERE slug = 'email-verification';
