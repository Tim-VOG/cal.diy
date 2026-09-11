#!/bin/bash
#
# Put the sale back to zero without touching who can log in.
#
# The line this draws: everything that records a SALE goes — orders, bookings,
# the atomic slots that hold rooms off the market, the numbered PDFs and the
# counters behind them. Everything that records a PERSON or the EVENT stays —
# accounts, billing profiles, staff roles, the nine rooms, the footer pages, the
# invoice issuer's own details. Colleagues come back on Monday to the account
# they already made and an empty calendar.
#
# Refuses to run without the word below, spelled out in full, because there is
# no undo beyond the backup it takes first.
#
set -euo pipefail

if [ "${1:-}" != "--yes-delete-all-bookings" ]; then
  echo "Refusing. Re-run with --yes-delete-all-bookings once you mean it." >&2
  exit 2
fi

DB=${NE26_DB:-calcom}
U=$(docker exec calcom-db printenv POSTGRES_USER)
q() { docker exec calcom-db psql -U "$U" -d "$DB" -At -F"|" -c "$1"; }

echo "== Backing up first =="
if [ "$DB" = "calcom" ]; then /usr/local/bin/ne26-backup.sh; else echo "(rehearsal on $DB — no backup taken)"; fi

echo
echo "== Before =="
q "SELECT 'orders', count(*) FROM \"Ne26Order\"
   UNION ALL SELECT 'bookings', count(*) FROM \"ResourceBooking\"
   UNION ALL SELECT 'slots', count(*) FROM \"ResourceSlot\"
   UNION ALL SELECT 'accounts', count(*) FROM \"users\"
   UNION ALL SELECT 'rooms', count(*) FROM \"Resource\"
   UNION ALL SELECT 'billing profiles', count(*) FROM \"Ne26BillingProfile\"
   UNION ALL SELECT 'pages', count(*) FROM \"Ne26LegalPage\";"

# The PDFs are set aside rather than deleted: they are already inside the backup
# taken above, and a tarball next to it costs 55 KB against the chance that one
# of them turns out to have been wanted.
STAMP=$(date -u +%Y%m%d-%H%M%S)
if [ "$DB" = "calcom" ] && compgen -G "/opt/calcom/invoices/*.pdf" > /dev/null; then
  tar -czf "/var/backups/ne26/retired-invoices-$STAMP.tar.gz" -C /opt/calcom invoices
  rm -f /opt/calcom/invoices/*.pdf
  echo "Invoice PDFs archived to /var/backups/ne26/retired-invoices-$STAMP.tar.gz and cleared."
fi

echo
echo "== Deleting =="
# One transaction: a half-cleared database would leave orders pointing at
# bookings that no longer exist, which is worse than either state.
# Order matters even with the cascades — being explicit is what makes it
# readable six months from now.
docker exec -i calcom-db psql -U "$U" -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM "ResourceSlot";
DELETE FROM "ResourceBooking";
DELETE FROM "Ne26Order";
DELETE FROM "Ne26AuditLog";
-- Back to zero, so the first real sale is NE26-2026-0001 and the series a
-- bookkeeper reads starts where the event starts.
UPDATE "Ne26DocumentCounter" SET "lastNumber" = 0, "updatedAt" = CURRENT_TIMESTAMP;
COMMIT;
SQL

# psql exits 0 when it is handed no input at all, which is exactly what happened
# when the docker exec above was missing -i: the script reported success and
# deleted nothing. Counting afterwards is the only honest proof.
left=$(q "SELECT (SELECT count(*) FROM \"Ne26Order\") + (SELECT count(*) FROM \"ResourceBooking\") + (SELECT count(*) FROM \"ResourceSlot\");")
if [ "$left" != "0" ]; then
  echo "FAILED: $left order/booking/slot rows survived. Nothing was cleared." >&2
  exit 1
fi

echo
echo "== After =="
q "SELECT 'orders', count(*) FROM \"Ne26Order\"
   UNION ALL SELECT 'bookings', count(*) FROM \"ResourceBooking\"
   UNION ALL SELECT 'slots', count(*) FROM \"ResourceSlot\"
   UNION ALL SELECT 'accounts', count(*) FROM \"users\"
   UNION ALL SELECT 'rooms', count(*) FROM \"Resource\"
   UNION ALL SELECT 'billing profiles', count(*) FROM \"Ne26BillingProfile\"
   UNION ALL SELECT 'pages', count(*) FROM \"Ne26LegalPage\";"
q "SELECT series, \"lastNumber\" FROM \"Ne26DocumentCounter\";"
