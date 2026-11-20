# GitHub and Hetzner operations

Repository: https://github.com/rasuljondev/lsl-bot

All school projects live under `/var/www/lsl`:

- `lsl-bot`: active Telegram bot source.
- `lslschool`: active public website source.
- `lsl-tracker`: active Express API and exported teacher/parent portal.
- Hidden `.releases`: immutable releases named by full Git commit.
- Hidden `.shared`: private runtime configuration, outside Git.
- Hidden `.state`: current commit, previous release and deployment status.
- Hidden `.legacy`: original server source retained during consolidation.
- Hidden `.acme`: certificate-renewal challenge files.

Pushes to `main` run `.github/workflows/deploy.yml`. Tests/builds finish before
upload. The project-specific SSH key accepts only the deployment command for
this repository, and the server records the exact deployed commit. Previous
source/release files are retained; source drift in an active immutable release
blocks another deployment until reviewed. Application health failure restores
the previous process/release. GitHub Actions success and the recorded server
state must both be checked after a push.

Develop locally, commit, and push. Use `git pull --ff-only` on a clean local
checkout before starting later work; a push from another computer cannot update
this computer automatically. Do not edit active server releases or run `git
reset --hard` to synchronize. Preserve uncommitted work before pulling.

Environment files, private rosters, databases, cookies and backups are not code
artifacts and are not synchronized through GitHub. Existing PostgreSQL and
MongoDB data stay in their respective databases; deployment runs no schema
migration, roster import or sample seed. Local and server environment values
can intentionally differ (ports and production origins).

Protected backups are under `/root/lsl-backups`. MongoDB dumps are verified for
gzip integrity; PostgreSQL dump tables are listed with `pg_restore -l`. These
checks are not a full restore drill or an off-server disaster-recovery backup.
Only school services are restarted. Restore application code without restoring
an old database over newer school records.

The root SSH deployment gateway is installed from
`lsl-tracker/deploy/hetzner_gateway.py`. Updating that privileged gateway requires
an explicit reviewed server update; an ordinary project push does not overwrite
it. Credentials for the tracker are `/etc/lsl-tracker/api.env` (mode 600).

## Partial attendance and today's recovery (1.2.1)

Apply additive migration `004_partial_attendance.sql` after a verified PostgreSQL
backup and before starting 1.2.1. It preserves existing rows. Explicit class counts
are independent of identity resolution; wrong or missing names do not block a
report. `status_confirmed=false` preserves uncertain individual history while
excluding it from current student statistics. Class summaries mark pending names.
Roster spellings are never changed automatically.

`scripts/recover-attendance.js --logfile /root/.pm2/logs/lsl-bot-out.log` previews
today's latest saved reports. Add `--apply --output /protected/path/recovery.json`
to recover, under the same per-class locks as live attendance. Existing later
reports and movements are preserved. PM2 logs can recover numeric prefixes that
were rejected before being saved; truncated names and exact Telegram timestamps
are not invented. Log evidence has a null Telegram message ID. Recovery sends no
Telegram notifications. Save its output with the database backup. Do not roll back
to a version that ignores `status_confirmed` after accepting partial reports.

After a matching-rule improvement, `--class 9B --resolve-pending` previews
re-resolving identities for the same still-pending source report. It cannot
replace a newer class report or movement. Review the preview before `--apply`.

## Editing student lists in the bot (1.3.0)

The owner and one admin (`ROSTER_EDITOR_ID` in the shared `.env`) can open
`📝 Ro‘yxatni tahrirlash` in the bot's private chat, pick a class, and add, remove
(mark inactive, history kept) or rename students. Renames keep the old spelling as
an alias. Every change is recorded in `roster_changes` (migration
`005_roster_changes.sql`, applied before deploying 1.3.0). The last student of a
class cannot be removed. After such edits the database is the source of truth: a
later `roster:import` of an older JSON file would undo them, so export the current
active roster from the database before any bulk import.
