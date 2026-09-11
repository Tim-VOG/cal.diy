# What runs on the VPS that is not the application

Four things, installed by hand into `/usr/local/bin` and `/etc/systemd/system`,
kept here so a rebuilt box can be put back the way it was.

| File | Installed as | When it runs |
| --- | --- | --- |
| `ne26-backup.sh` | `/usr/local/bin/ne26-backup.sh` | nightly, 02:30 UTC |
| `ne26-watch.sh` | `/usr/local/bin/ne26-watch.sh` | every 5 minutes |
| `ne26-reset-bookings.sh` | `/usr/local/bin/ne26-reset-bookings.sh` | by hand, never on a timer |
| `daemon.json` | `/etc/docker/daemon.json` | read by Docker at daemon start |

## Why each one exists

**The backup** is the gap that mattered most: there was none. It takes the
database *and* the invoice PDFs, because the PDFs are numbered documents on a
bind mount and are not derivable from the database — restoring one without the
other leaves a VAT return pointing at files that are gone. Written to a `.part`
file and renamed only once it is plausibly complete, and retention is applied
only after a successful write, so a failed run can never be the run that deletes
the last good copy. Proved by restoring one into a scratch database and
comparing counts, not by watching it produce a file.

**The watcher** exists because `restart: always` only answers the failure where
the process dies. It does nothing for a full disk (which stops Postgres
accepting writes), a container that is up but wedged, or a 502 from Nginx — all
of which look healthy to Docker. It mails on a *change* of answer plus once
every six hours while still wrong, because an alert arriving every five minutes
is one nobody reads by the second hour. It reads SMTP settings out of
`/opt/calcom/.env` with `sed` rather than sourcing the file: sourcing executes
whatever is in there.

Set `NE26_ALERT_TO=` in `/opt/calcom/.env` to send alerts somewhere other than
`EMAIL_FROM`.

This checks the service from the box it runs on, so it cannot tell you the box
itself is unreachable. That case wants a free external pinger pointed at
`https://rooms.vo-eu.be/rooms/login`.

**The reset** clears a round of testing without touching who can log in: orders,
bookings, atomic slots, invoice PDFs and the document counters go; accounts,
billing profiles, staff roles, the nine rooms and the footer pages stay. It
refuses to run without `--yes-delete-all-bookings`, backs up first, and counts
the rows afterwards — the first version reported success and deleted nothing,
because `docker exec` without `-i` hands psql no input and psql exits 0. Rehearse
it against a restored copy before pointing it at production:

```bash
NE26_DB=ne26_rehearsal /usr/local/bin/ne26-reset-bookings.sh --yes-delete-all-bookings
```

**The log caps** are also set per service in `/opt/calcom/docker-compose.yml`,
which is what actually takes effect: `systemctl reload docker` does not apply
`log-opts`, and a container writing 70 MB proved it. The compose entries apply at
the next `docker compose up -d`; `daemon.json` covers anything else started on
the box.
