#!/bin/bash
#
# Every five minutes, ask the four questions that have an answer.
#
# restart=always brings a container back when the PROCESS dies. It does nothing
# for the failures that actually happen: a disk with no room left, which stops
# Postgres accepting writes; a container up but wedged; a site returning 502.
# Those look healthy to Docker and look broken to an exhibitor.
#
# Mails only when the answer CHANGES, plus once every six hours while it is
# still wrong — an alert that arrives every five minutes is an alert nobody
# reads by the second hour.
#
set -uo pipefail

URL=${URL:-https://rooms.vo-eu.be/rooms/login}
DISK_WARN=${DISK_WARN:-80}
STATE_DIR=/var/lib/ne26-watch
REALERT_SECONDS=$((6 * 3600))
ENV_FILE=/opt/calcom/.env

mkdir -p "$STATE_DIR"
state_file="$STATE_DIR/state"
stamp_file="$STATE_DIR/last-alert"

problems=()

# 1. Disk. Named first because it is the one that takes the database with it.
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$disk" -ge "$DISK_WARN" ] && problems+=("Disk at ${disk}% (threshold ${DISK_WARN}%).")

# 2. Containers. Health as Docker sees it, which is necessary and not enough.
for c in calcom calcom-db; do
  status=$(docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo "absent")
  case "$status" in
    running/healthy|running/none) ;;
    *) problems+=("Container $c is $status.") ;;
  esac
done

# 3. Postgres answering a real query, not merely listening.
db_user=$(docker exec calcom-db printenv POSTGRES_USER 2>/dev/null || true)
if [ -z "$db_user" ]; then
  problems+=("Could not reach the database container to ask it anything.")
else
  if ! docker exec calcom-db psql -U "$db_user" -d calcom -Atc 'SELECT count(*) FROM "Ne26Order";' >/dev/null 2>&1; then
    problems+=("Postgres is up but refused a read of Ne26Order.")
  fi
fi

# 4. The site, over HTTPS, from outside the container — which also exercises
#    Nginx and the certificate.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" || echo 000)
[ "$code" != "200" ] && problems+=("$URL returned HTTP $code.")

now=$(date -u +%s)
previous=$(cat "$state_file" 2>/dev/null || echo ok)
last_alert=$(cat "$stamp_file" 2>/dev/null || echo 0)

# Read one key out of the env file without SOURCING it: sourcing executes
# whatever is in there, and a value containing a space or a backtick would
# either break the script or run. Values never leave this function.
env_get() {
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

send() {
  local subject="$1" body="$2"
  local from to host port user pass scheme msg
  from=$(env_get EMAIL_FROM | grep -oE '[^<[:space:]]+@[^>[:space:]]+' | head -1)
  to=$(env_get NE26_ALERT_TO)
  [ -z "$to" ] && to="$from"
  host=$(env_get EMAIL_SERVER_HOST)
  port=$(env_get EMAIL_SERVER_PORT)
  [ -z "$port" ] && port=587
  user=$(env_get EMAIL_SERVER_USER)
  pass=$(env_get EMAIL_SERVER_PASSWORD)
  if [ -z "$host" ] || [ -z "$from" ] || [ -z "$to" ] || [ -z "$user" ]; then
    echo "no usable SMTP settings in $ENV_FILE — alert not sent" >&2
    return 0
  fi
  scheme=smtp
  [ "$port" = "465" ] && scheme=smtps
  msg=$(mktemp)
  {
    printf 'From: %s\r\n' "$from"
    printf 'To: %s\r\n' "$to"
    printf 'Subject: %s\r\n' "$subject"
    printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'
    printf '%s\r\n' "$body"
    printf '\r\n-- \r\nne26-watch on %s, %s UTC\r\n' "$(hostname)" "$(date -u '+%Y-%m-%d %H:%M')"
  } > "$msg"
  curl --silent --show-error --ssl-reqd --max-time 30 \
    --url "$scheme://$host:$port" \
    --user "$user:$pass" \
    --mail-from "$from" --mail-rcpt "$to" \
    --upload-file "$msg" >/dev/null 2>&1 \
    || echo "SMTP send failed" >&2
  rm -f "$msg"
}

if [ ${#problems[@]} -gt 0 ]; then
  printf 'PROBLEM: %s\n' "${problems[@]}"
  echo down > "$state_file"
  if [ "$previous" = "ok" ] || [ $((now - last_alert)) -ge $REALERT_SECONDS ]; then
    send "NE26 Rooms: $(printf '%s' "${problems[0]}" | cut -c1-60)" "$(printf '%s\n' "${problems[@]}")"
    echo "$now" > "$stamp_file"
  fi
else
  echo "ok (disk ${disk}%, HTTP $code)"
  echo ok > "$state_file"
  if [ "$previous" = "down" ]; then
    send "NE26 Rooms: back to normal" "Everything the watcher checks is answering again. Disk at ${disk}%, the site returned 200."
    echo "$now" > "$stamp_file"
  fi
fi
