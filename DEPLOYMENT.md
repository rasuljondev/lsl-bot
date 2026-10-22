# Student attendance release 1.2.0

The 381-student roster is already active. This upgrade adds missing minutes for
08:30?16:00 Tashkent school days. Absence reasons remain excluded.

For an existing 1.1.0 deployment, apply the migrations and run roster:check.
Skip roster import: do not replace or reset the active student rosters or history.

## Local validation and release

```sh
npm ci
npm test
npm run db:migrate
npm run roster:import -- roster.example.json
npm run release:pack
```

The migration and roster commands above are dry runs. Tests use an isolated
PostgreSQL 18 engine through PGlite and mocked Telegram APIs, including actual
Telegraf command/callback routing and an HTTP health check. They never use the real
bot token or connect to the production database. PGlite is a development dependency.
Multi-connection concurrency, PM2 restart behavior, and real Telegram interaction
still require verification on the eventual deployment; class mutations use
transaction-scoped PostgreSQL advisory locks in production.

The generated `dist/lsl-bot-1.2.0.tar.gz` contains source, SQL, tests, tools and docs.
Its accompanying manifest records every file hash and the archive SHA256. Credentials,
real rosters, dependencies and Git internals are excluded.

Compatible dependency updates remove the previously reported critical proxy-addr
advisory and qs advisories. The dependency audit still reports two moderate entries
for node-cron 3 / its uuid dependency. The reported uuid issue affects buffer-taking
v3/v5/v6 APIs; installed node-cron uses `uuid.v4()` without a buffer. Upgrading
node-cron across its major version is deliberately separate from this feature.

## Production procedure — execute later

Current known target is `/var/www/lsl-bot` on `37.27.5.14`, PM2 process `lsl-bot`,
health port 3009, PostgreSQL database `lslbot`. Recheck those facts at deployment.
The deployed directory currently has no `.git`, so use a source archive and its
manifest rather than assuming `git pull` will work.

1. Review the supplied full class lists and assign permanent student IDs. Validate
   the complete JSON locally; do not import the example roster.
2. Choose an after-hours activation window, preferably before the next school day,
   so the first individual attendance day begins with the new workflow. Inform
   teachers of the new meaning of the names: they list absent students.
3. Make a protected backup of the current source, `.env`, PM2 process definition
   and database. Verify the database dump is readable before proceeding. Record
   counts and the latest attendance date for comparison.
4. Copy the reviewed release archive, matching manifest and real roster file to
   the server. Verify the archive SHA256 against the manifest. Keep roster files
   and backups outside public web paths, readable only by the deployment user.
5. Stop only `lsl-bot`; leave other applications and PostgreSQL running. Extract
   the release into its serving directory, preserving the existing `.env`.
6. From `/var/www/lsl-bot`, run:

   ```sh
   npm ci --omit=dev --ignore-scripts
   npm run db:migrate -- --apply
   npm run roster:import -- /protected/path/school.json
   npm run roster:import -- /protected/path/school.json --apply
   npm run roster:check
   ```

   The migration only adds new tables and indexes. It never rewrites legacy names
   or attendance. It is safe to rerun. The import is transactional and updates
   class totals to the active official roster size.
7. Set `STUDENT_ATTENDANCE_ENABLED=true` in the existing `.env`, keep `WEBHOOK_URL`
   empty, and keep the existing token/database/port values. Restart only `lsl-bot`
   with PM2; save the PM2 process state when confirmed healthy.
8. Verify `/health` returns HTTP 200, `db: ok`, version
   `student-attendance-1.2.0`, and `studentAttendanceEnabled: true`. Verify PM2 is
   stable, all official roster counts match, Telegram has no foreign webhook,
   and existing historical class records are unchanged.
9. Open `/start` privately as an approved admin and check both weekly buttons.
   During school hours, verify a real teacher's first report, ambiguous-name
   selection, a missing-name reply and a subsequent `keldi`; confirm database
   state and resulting reports. Do not seed fictitious attendance into production.
   Confirm Saturday delivery from actual Telegram and persisted delivery state.

## Rollback

Stop only `lsl-bot`, restore the backed-up application and lockfile, install its
production dependencies and restore the previous feature-flag configuration, then
restart and check health/polling. Keep all added tables and audit history; they do
not interfere with the old application. Do not restore an old database dump over
newly collected attendance. If roster-derived class totals need reverting, restore
only the recorded previous class totals after reviewing any attendance collected
since activation. A rollback returns to class totals; it cannot provide individual
tracking while the feature is disabled.
