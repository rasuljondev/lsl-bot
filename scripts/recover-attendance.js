import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { pool, getTodayDate } from '../src/database.js';
import { transaction, lockClass, acceptClassReport } from '../src/studentAttendance.js';
import { parseStudentMessage } from '../src/studentMatching.js';
import { tashkentClock } from '../src/attendanceTime.js';

const option = name => process.argv[process.argv.indexOf(name) + 1];
const date = process.argv.includes('--date') ? option('--date') : getTodayDate();
const apply = process.argv.includes('--apply');
if (date !== getTodayDate()) throw new Error('Recovery is limited to today in Asia/Tashkent.');

// Bot API has no chat-history endpoint. Logs can prove numeric counts rejected
// before an attendance_pending row existed; truncated names are never inferred.
const logReports = new Map();
if (process.argv.includes('--logfile')) {
    const lines = (await fs.readFile(option('--logfile'), 'utf8')).split('\n');
    let frame = {};
    for (const line of lines) {
        if (line.includes('Message received:')) frame = {};
        const chat = line.match(/: +Chat ID: (-?\d+)/);
        const actor = line.match(/: +User ID: (\d+)/);
        if (chat) frame.chat = chat[1];
        if (actor) frame.actor = actor[1];
        const message = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d): +Message: (.*)/);
        if (!message || String(frame.chat) !== String(config.allowedGroupId) || !frame.actor) continue;
        const at = new Date(message[1] + 'Z');
        const day = tashkentClock(at).date;
        if (day !== date) continue;
        const counts = message[2].match(/^\s*(\d{1,2}[ABАВ])\s+(\d+)\s*\/\s*(\d+)/i);
        if (!counts) continue;
        const parsed = parseStudentMessage(`${counts[1]} ${counts[2]}/${counts[3]}`);
        if (!parsed || !config.classes.includes(parsed.className) || parsed.total < 1 || parsed.total > 60 || parsed.present > parsed.total) continue;
        logReports.set(parsed.className, { id: randomUUID(), class_name: parsed.className, date,
            chat_id: config.allowedGroupId, actor_id: frame.actor, message_id: null, created_at: at,
            payload: { ...parsed, eventAt: at.toISOString(), sourceEvidence: 'PM2 log: numeric prefix only', selected: [] } });
    }
}

const results = [];
try {
    for (const className of config.classes) {
        const result = await transaction(async db => {
            await lockClass(db, className, date);
            const stored = (await db.query(`SELECT * FROM attendance_pending WHERE class_name=$1 AND date=$2
                AND payload->>'kind'='report' ORDER BY message_id DESC LIMIT 1`, [className, date])).rows[0];
            const logged = logReports.get(className);
            const session = logged && (!stored || new Date(logged.created_at) > new Date(stored.created_at)) ? logged : stored;
            if (!session) return { className, status: 'no captured report' };
            const previous = (await db.query('SELECT * FROM attendance_logs WHERE class_name=$1 AND date=$2', [className, date])).rows[0];
            // Preserve valid later submissions/movements, including pre-migration records.
            if (previous && new Date(previous.source_event_at || previous.updated_at) >= new Date(session.payload.eventAt)) {
                return { className, status: 'already current', total: previous.total_students, present: previous.present_count };
            }
            const roster = (await db.query(`SELECT s.* FROM roster_students s WHERE class_name=$1 AND active ORDER BY id`, [className])).rows;
            await db.query('SAVEPOINT recovery_preview');
            await db.query("UPDATE attendance_pending SET state='cancelled' WHERE class_name=$1 AND date=$2 AND state='open' AND id<>$3", [className, date, session.id]);
            const accepted = await acceptClassReport(db, session, roster);
            const after = (await db.query('SELECT * FROM attendance_logs WHERE class_name=$1 AND date=$2', [className, date])).rows[0];
            if (!apply) await db.query('ROLLBACK TO SAVEPOINT recovery_preview');
            return { className, status: accepted.cancel ? 'preserved newer data' : apply ? 'recovered' : 'would recover',
                total: after?.total_students, present: after?.present_count, namesComplete: after?.names_complete,
                unresolved: after?.unresolved_names, sourceMessageId: session.message_id, sourceTime: session.payload.eventAt,
                evidence: session.payload.sourceEvidence || 'saved Telegram report' };
        });
        results.push(result);
    }
    if (process.argv.includes('--output')) await fs.writeFile(option('--output'), JSON.stringify({ date, apply, results }, null, 2), { mode: 0o600 });
    for (const row of results) console.log(`${row.className}: ${row.total ?? '?'}/${row.present ?? '?'} — ${row.status}${row.namesComplete === false ? ' (names pending)' : ''}`);
} finally { await pool.end(); }
