#!/bin/bash
#
# A nightly copy of everything that cannot be rebuilt.
#
# Two things qualify and they are different in kind:
#   - the database, which holds the orders and the money;
#   - the invoice PDFs, which are numbered documents living on a bind mount and
#     are NOT derivable from the database. Restoring one without the other
#     leaves a VAT return referring to files that no longer exist.
#
# Written to a .part file and renamed only once it is plausibly complete, so a
# dump interrupted halfway never overwrites the newest good one and never gets
# counted as a backup.
#
set -euo pipefail

DEST=/var/backups/ne26
KEEP_DAYS=14
MIN_BYTES=20000   # a dump smaller than this is a failure, not a small database

mkdir -p "$DEST"
STAMP=$(date -u +%Y%m%d-%H%M%S)
USER_NAME=$(docker exec calcom-db printenv POSTGRES_USER)

db_part="$DEST/db-$STAMP.sql.gz.part"
docker exec calcom-db pg_dump -U "$USER_NAME" calcom | gzip > "$db_part"
size=$(stat -c%s "$db_part")
if [ "$size" -lt "$MIN_BYTES" ]; then
  rm -f "$db_part"
  echo "dump too small ($size bytes) — kept nothing" >&2
  exit 1
fi
mv "$db_part" "$DEST/db-$STAMP.sql.gz"

inv_part="$DEST/invoices-$STAMP.tar.gz.part"
tar -czf "$inv_part" -C /opt/calcom invoices
mv "$inv_part" "$DEST/invoices-$STAMP.tar.gz"

# Retention is applied AFTER a successful write, never before: a run that fails
# must not be the run that deletes the last good copy.
find "$DEST" -maxdepth 1 -name 'db-*.sql.gz'        -mtime +$KEEP_DAYS -delete
find "$DEST" -maxdepth 1 -name 'invoices-*.tar.gz'  -mtime +$KEEP_DAYS -delete
find "$DEST" -maxdepth 1 -name '*.part'             -mtime +1          -delete

echo "db $(stat -c%s "$DEST/db-$STAMP.sql.gz") bytes, invoices $(stat -c%s "$DEST/invoices-$STAMP.tar.gz") bytes"
