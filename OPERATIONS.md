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
