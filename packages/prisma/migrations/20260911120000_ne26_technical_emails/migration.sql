-- NE26: separate the operational alerts from the sales notifications.
--
-- Everything the team received went to one list, so whoever read it got
-- "Payment captured with no matching order" next to "Room sold". Nobody on the
-- sales desk can act on the first, and mixing the two is how the ones that
-- matter stop being read.
ALTER TABLE "Ne26InvoiceSettings" ADD COLUMN "technicalEmails" TEXT NOT NULL DEFAULT '';

-- What notifyEmails holds today IS the technical list — it was set to
-- ne26@vo-group.be and the sales address was never a recipient, only the
-- contactEmail fallback that nothing ever fell back to. So move it rather than
-- inventing a value: whatever is configured now keeps receiving the alerts.
UPDATE "Ne26InvoiceSettings"
SET "technicalEmails" = "notifyEmails"
WHERE COALESCE(TRIM("technicalEmails"), '') = ''
  AND COALESCE(TRIM("notifyEmails"), '') <> '';

-- Nothing configured at all: fall back to the address the alerts are wanted at.
UPDATE "Ne26InvoiceSettings"
SET "technicalEmails" = 'ne26@vo-group.be'
WHERE COALESCE(TRIM("technicalEmails"), '') = '';

-- notifyEmails is deliberately NOT rewritten here. It now means "the sales
-- desk", and which address that is belongs to whoever runs the desk, not to a
-- migration guessing from contactEmail. Set it in Admin > Settings; until then
-- sales mails go to the technical address, which is where they go today.
