# Individual student attendance (1.2.1)

The 381-student roster is deployed; release 1.2.1 accepts class totals independently of incomplete names.
Absence reasons are not included.

The approved workbook source is `To'lov umumiysi`: 381 students across 22 classes.
Only surnames and given names are imported. The owner supplied the given-name
spellings `Muhammadaziz` and `Boburmiroz`; alternative spellings remain aliases.
Private approved-user `/start` includes `Sinf ro‘yxati`, allowing each class roster
to be reviewed before reporting missing students or spelling corrections.

## Teacher workflow

Names below are examples. Use the actual class and student names after roster import.

```text
6A kelmaganlar:
Ali Karimov
Bobur Oripov
```

When every name resolves uniquely and the roster/counts agree, these students
are absent and the other active roster students are present. A class without a completed submission has no individual attendance
for that day. Missing submissions never create absences automatically.
The `kelmaganlar:` label is optional: `6A` followed by names on separate lines
also works.

The existing total/present format also works:

```text
6A 21/19
Ali Karimov
Bobur Oripov
```

Both names are ABSENT students. Numeric total/present values are saved immediately,
even if a name is missing, misspelled, ambiguous, or the total differs from the
current roster. The bot flags roster differences for later review. Names belong
on separate lines, or may be separated by commas or semicolons. Spaces alone do
not separate full names.

Every uniquely matched absence is accepted independently. `Nosirov I` or
`Nosirov J` matches surname plus given-name initial only when unique in that
class. Given-name-first entries such as `Madina Akramova` can match a unique
`Akramova Madinabonu`: one complete token must match exactly and the other must
be exact or an explicitly listed equivalent. Known equivalents are Madina/Madinabonu,
Bobur/Boburmizo/Boburmiroz/Boburmirzo, and the verified 9B variants
Mansur/Mansurjon and Ilyos/Ilyosbek. Prefix similarity alone is never sufficient;
Muhammad and Muhammadali are different names. Multiple matching students remain ambiguous.
Wrong/ambiguous names are retained as unresolved and do not block other
students or class totals. Reply to the bot's clarification prompt with the full
corrected list, or send a new class report later. A count-only report is already
saved while names are pending.

When identities are incomplete, unmatched students are not automatically marked
present or absent. Existing individual rows are preserved but marked unconfirmed
and excluded from individual statistics until clarified. Class totals remain in
summaries. Matched keldi/ketdi updates adjust the accepted class count only from a
confirmed prior student status; otherwise send a new numeric class report.

```text
6A hamma keldi
6A Ali keldi
6A Ali ketdi
```

- `hamma keldi` submits a complete class report with no currently absent students.
- `keldi` changes a previously absent student to late after 08:30 Tashkent, or
  present if arriving by 08:30. Minutes use the original Telegram message time,
  including when clarification happens later. Initial present reports do not
  imply a late arrival solely because the teacher submitted the report late.
- Repeated `keldi` or `ketdi` messages do not increment/decrement attendance twice.
- `ketdi` marks a present student as having left early. A student who has not
  arrived cannot be marked as leaving. Returning from an early departure restores
  the previous present/late state.
- Early departures are distinct from full-day absence. Their state appears in
  individual history; they do not enter the top-10 full-day absence list.
- A late arrival is counted once per day and is no longer counted absent. If that
  student leaves early later, the late flag remains.
- Repeating a full class report preserves recorded late arrivals for students
  who are not listed absent. Removing a previously absent student from a full
  report records their arrival at that report's message time. Listing a student absent explicitly corrects their
  state to absent. Corrections and clearing today's data retain an audit trail.

The existing authorized group/private-user permissions and 08:00–16:00 Tashkent
window apply. Sundays and explicitly configured days off do not accept attendance.

## Missing minutes (08:30–16:00)

The owner confirmed a school day from 08:30 to 16:00 Tashkent time. A full-day
absence is 450 minutes. Intervals before 08:30 and after 16:00 are excluded.
Both arrival delay and departure/return intervals count toward missing time.
Example: arrival 08:45 is 15 minutes late; leaving 14:00 and returning 14:20
adds 20 missing minutes, for 35 in total. If the student does not return, that
departure interval ends at 16:00.

Today's reports show elapsed missing time as of the report time. A departure
confirmation also shows the projected total if the student does not return by
16:00. Completed historical days use their final school-day cutoff. Seconds
are rounded down to full minutes; late arrivals in the 08:30 minute count as
on time. Duplicate movements never reopen or extend intervals.

Teachers must send movements promptly: typed times are not backdated. First
arrival, latest departure, intervals and actual event times are stored. Out-of-order
messages cannot overwrite later movements. Existing historical time fields remain
unknown; reports label incomplete timing instead of inventing arrival times.
Weekly lists and individual history include late and missing-minute totals.

## Name matching

Matching only searches the student's class. Unique first names, surnames, full
names and imported aliases work. Uzbek apostrophe variants, letter case, whitespace,
and Cyrillic-to-Latin spelling are normalized.

A clear unique one-character typo in a name of at least five characters is corrected
automatically. The confirmation shows the full official names. Shorter names,
wider spelling differences and multiple close matches require a choice. Unknown
names require the full corrected list; no new roster student is created from chat.
Actual alternative spellings can be imported as aliases.

Clarification buttons show names and internal IDs. Only the original teacher or
bot owner may answer, in the same chat. Sessions survive restarts and expire after
two hours or the end of that Tashkent date. A newer submission for the same class
supersedes earlier open questions. A roster change invalidates old questions.

## Reports

The authorized group receives two top-10 lists in one message every Saturday at
16:10 Asia/Tashkent: `Haftalik kelmaganlar` and `Haftalik kech qolganlar`.
The period starts Monday. The report is still sent if Saturday itself is a holiday,
and excludes Sundays and dates marked as days off.

Delivery is tracked in PostgreSQL. Failed sends retry every ten minutes on Saturday
until 23:50; crashed claims become eligible after fifteen minutes. A process crash
between Telegram accepting a message and saving its delivery receipt can produce a
duplicate. There is no automatic catch-up after Saturday.

Owner and existing approved users get both Uzbek report buttons in the bot's
private `/start` panel. Each report includes dates and buttons for the current or
previous calendar week. Student history is also private:

```text
/oquvchi 6A Ali Karimov
```

History shows the last 90 calendar days, including recorded school days, dates of
absence, lateness and early departure. Ambiguous names offer student buttons.
Week rankings aggregate by permanent student ID even after a class transfer.

Older class totals and names collected from chat remain unchanged. They are not
converted into individual records: those names were not an authoritative roster
and cannot prove which student attended on a historical date. Individual reports
only include records made after activation.

## Official roster format

Use `roster.example.json` as the format reference. Keep real files in `rosters/`
(ignored by Git). Each supplied class is its complete replacement roster.

```json
[
  {
    "className": "6A",
    "students": [
      { "id": "lsl-0001", "fullName": "Ali Karimov", "aliases": [] },
      { "id": "lsl-0002", "fullName": "Bobur Oripov", "aliases": ["Bobir"] }
    ]
  }
]
```

IDs are permanent, unique across all classes, and must be reused when correcting
spelling or transferring students. Do not derive them from the student's current
class or array position. The initial IDs can be assigned when the real lists arrive.
Full names are limited to 100 characters; classes support 1–60 active students.

```sh
npm run roster:import -- rosters/school.json
npm run roster:import -- rosters/school.json --apply
```

Without `--apply`, only file structure is validated and no database connection is
opened. Applying requires the migration. Omitted students become inactive without
deleting their history. Transfers must include complete rosters for both old and
new classes. Imports refuse classes that already have individual attendance on the
current day; use a day without individual records for those classes.

`STUDENT_ATTENDANCE_ENABLED=true` requires valid complete rosters for all configured
classes. Otherwise startup fails before opening the HTTP port or polling Telegram.
