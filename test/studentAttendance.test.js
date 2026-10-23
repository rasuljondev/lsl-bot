import test, { before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Telegram } from 'telegraf';

// Never use a real bot token or DATABASE_URL in tests.
process.env.BOT_TOKEN = 'test-only-token';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test_never_connect';
process.env.STUDENT_ATTENDANCE_ENABLED = 'true';
const { pool, getTodayDate } = await import('../src/database.js');
const { config } = await import('../src/config.js');
const { handleStudentMessage, handleStudentCallback, transaction, verifyStudentSetup } = await import('../src/studentAttendance.js');
const { importRoster } = await import('../src/rosterImport.js');
const { weeklyStudentReport, studentHistory, sendWeeklyStudentReport, sendLongMessage, classRosterReport } = await import('../src/studentReports.js');
const { cleanTodayData } = await import('../src/admin.js');
const { bot, app, start } = await import('../src/bot.js');
let db, messageId = 100;
const date = '2026-10-17';
const groups = [{ className: '6A', students: [
    { id: 's1', fullName: 'Ali Karimov' }, { id: 's2', fullName: 'Ali Rahimov' }, { id: 's3', fullName: 'Bobur Oripov' }
] }];
const run = async (sql, params = []) => {
    const result = await db.query(sql, params);
    // Match pg's configured DATE parser and its rowCount behavior.
    const rows = result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, result.fields.some(f => f.name === key && f.dataTypeID === 1082) && value instanceof Date
            ? value.toISOString().slice(0, 10) : value])));
    return { rows, rowCount: rows.length || result.affectedRows || 0 };
};

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-17T04:00:00Z').getTime() });
    db = new PGlite();
    pool.query = run;
    pool.connect = async () => ({ query: run, release() {} });
    await db.exec(await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
    const migration = await fs.readFile(new URL('../sql/migrations/002_student_attendance.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // additive migration is safe to rerun
    const minutesMigration = await fs.readFile(new URL('../sql/migrations/003_attendance_minutes.sql', import.meta.url), 'utf8');
    await db.exec(minutesMigration);
    await db.exec(minutesMigration);
    await db.exec(await fs.readFile(new URL('../sql/migrations/004_partial_attendance.sql', import.meta.url), 'utf8'));
    await db.exec(await fs.readFile(new URL('../sql/migrations/004_partial_attendance.sql', import.meta.url), 'utf8'));
    config.activeHours = { start: { hour: 0, minute: 0 }, end: { hour: 23, minute: 59 } };
});
after(async () => { await db.close(); await pool.end(); mock.timers.reset(); });
beforeEach(async () => {
    mock.timers.setTime(new Date('2026-10-17T04:00:00Z').getTime());
    await db.exec(`TRUNCATE student_attendance,attendance_events,attendance_pending,weekly_student_deliveries,
        roster_students,class_rosters,attendance_logs,authorized_users,days_off RESTART IDENTITY CASCADE`);
    await transaction(client => importRoster(client, groups, date));
});

function context(text, actor = 123) {
    const replies = [];
    const ctx = {
        chat: { id: config.allowedGroupId, type: 'supergroup' }, from: { id: actor },
        message: { text, message_id: ++messageId }, replies,
        telegram: { sendMessage: async (chatId, text) => { replies.push({ text }); return { message_id: ++messageId }; } },
        reply: async (text, options) => { const m = { text, options, message_id: ++messageId }; replies.push(m); return m; }
    };
    return ctx;
}
function callback(data, actor = 123) {
    const ctx = context('', actor);
    ctx.callbackQuery = { data, message: { message_id: ctx.message.message_id } };
    delete ctx.message;
    return ctx;
}
async function submit(text) { const ctx = context(text); await handleStudentMessage(ctx); return ctx; }
async function attendance() { return (await run('SELECT * FROM student_attendance ORDER BY student_id')).rows; }
async function openSession() { return (await run("SELECT * FROM attendance_pending WHERE state='open'")).rows[0]; }

test('new rosters never promote old collected names; import is idempotent', async () => {
    await transaction(client => importRoster(client, groups, date));
    assert.equal((await run('SELECT count(*)::int AS n FROM roster_students')).rows[0].n, 3);
    assert.equal((await run("SELECT total_students FROM classes WHERE class_name='6A'")).rows[0].total_students, 3);
    await assert.rejects(verifyStudentSetup, /rosters missing/);
    assert.equal(getTodayDate(), date);
});

test('numbers-only saves counts immediately and reply completes identities', async () => {
    const ctx = await submit('6A 3/2');
    assert.match(ctx.replies[0].text, /1 nafar/);
    assert.equal((await attendance()).length, 0);
    assert.equal((await run('SELECT * FROM attendance_logs')).rows[0].present_count, 2);
    const session = await openSession();
    const reply = context('Orpiov');
    reply.message.reply_to_message = { message_id: Number(session.prompt_id) };
    await handleStudentMessage(reply);
    assert.match(reply.replies[0].text, /Bobur Oripov/);
    assert.deepEqual((await attendance()).map(a => a.status), ['present', 'present', 'absent']);
    assert.equal((await run('SELECT * FROM attendance_logs')).rows[0].present_count, 2);
});

test('ambiguous names accept counts; only the original teacher can clarify identities', async () => {
    await submit('6A 3/2\nAli');
    assert.equal((await attendance()).length, 0);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 2);
    const session = await openSession();
    const stranger = context('Karimov', 999);
    stranger.message.reply_to_message = { message_id: Number(session.prompt_id) };
    await handleStudentMessage(stranger);
    assert.match(stranger.replies[0].text, /Faqat/);
    const reply = context('Karimov');
    reply.message.reply_to_message = { message_id: Number(session.prompt_id) };
    await handleStudentMessage(reply);
    assert.equal((await attendance())[0].status, 'absent');
});

test('one unknown name keeps the count and other matched absences', async () => {
    await submit('6A 3/1\nKarimov\nUnknown');
    assert.equal((await attendance()).length, 1);
    assert.equal((await attendance())[0].status, 'absent');
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 1);
    const session = await openSession();
    const reply = context('Karimov\nOripov');
    reply.message.reply_to_message = { message_id: Number(session.prompt_id) };
    await handleStudentMessage(reply);
    assert.equal((await attendance()).filter(a => a.status === 'absent').length, 2);
});

test('ambiguous and unknown names leave identities unresolved without guessing present students', async () => {
    const ctx = await submit('6A 3/1\nAli\nUnknown');
    assert.equal(ctx.replies[0].options.reply_markup.force_reply, true);
    assert.ok((await openSession()).prompt_id);
    assert.equal((await attendance()).length, 0);
    const row = (await run('SELECT * FROM attendance_logs')).rows[0];
    assert.equal(row.present_count, 1);
    assert.equal(row.names_complete, false);
    assert.deepEqual(row.unresolved_names, ['Ali', 'Unknown']);
});

test('duplicate names do not double-count and reported class totals survive roster differences', async () => {
    await submit('6A 3/1\nBobur\nOripov');
    assert.equal((await attendance()).length, 1);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 1);
    const mismatch = await submit('6A 4/3\nBobur');
    assert.match(mismatch.replies[0].text, /4\/3/);
    assert.equal((await run('SELECT total_students FROM attendance_logs')).rows[0].total_students, 4);
    await submit('6A 3/1\nBobur');
    assert.equal((await attendance()).filter(r => r.status_confirmed).length, 1);
    const bad = await submit('6A 3/4');
    assert.match(bad.replies[0].text, /tekshirib/);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 1);
});

test('late arrival removes absence, duplicate arrivals/departures do not change counts', async () => {
    await submit('6A 3/2\nOripov');
    await submit('6A Bobur keldi');
    await submit('6A Bobur keldi');
    let a = await attendance();
    assert.equal(a[2].status, 'late');
    assert.equal(a[2].arrived_late, true);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 3);
    assert.match(await weeklyStudentReport('absent'), /holatlar yo‘q/);
    assert.match(await weeklyStudentReport('late'), /Bobur Oripov.*1 kun/);
    await submit('6A Bobur ketdi');
    await submit('6A Bobur ketdi');
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 2);
    await submit('6A Bobur keldi');
    assert.equal((await attendance())[2].status, 'late');
    await submit('6A hamma keldi');
    assert.equal((await attendance())[2].arrived_late, true);
    assert.match(await studentHistory(3), /Kech qolgan: 1 kun/);
    assert.match(await studentHistory(3), /Kelmagan: 0 kun/);
});

test('stored minutes use original arrival time even when name clarification is delayed', async () => {
    mock.timers.setTime(Date.parse('2026-10-17T03:30:00Z'));
    await submit('6A kelmaganlar: Karimov');
    mock.timers.setTime(Date.parse('2026-10-17T04:00:00Z'));
    const arrived = context('6A Ali keldi');
    arrived.message.date = Date.parse('2026-10-17T03:45:00Z') / 1000;
    await handleStudentMessage(arrived);
    const data = arrived.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data;
    mock.timers.setTime(new Date('2026-10-17T04:10:00Z').getTime());
    const clarified = callback(data);
    await handleStudentCallback(clarified);
    const row = (await attendance())[0];
    assert.equal(row.late_minutes, 15);
    assert.equal(new Date(row.first_arrival_at).toISOString(), '2026-10-17T03:45:00.000Z');
    assert.match(clarified.replies[0].text, /08:45/);
    assert.match(clarified.replies[0].text, /15 daqiqa/);
    assert.match(await weeklyStudentReport('late'), /15 daqiqa/);
});

test('departure and return preserve late minutes and aggregate only the missed interval', async () => {
    mock.timers.setTime(Date.parse('2026-10-17T03:30:00Z'));
    await submit('6A kelmaganlar: Oripov');
    mock.timers.setTime(Date.parse('2026-10-17T04:00:00Z'));
    const arrival = context('6A Bobur keldi');
    arrival.message.date = Date.parse('2026-10-17T03:45:00Z') / 1000;
    await handleStudentMessage(arrival);
    await submit('6A Bobur keldi');
    assert.equal((await attendance())[2].late_minutes, 15);
    mock.timers.setTime(Date.parse('2026-10-17T09:00:00Z'));
    const departure = await submit('6A Bobur ketdi');
    assert.match(departure.replies[0].text, /16:00 gacha qaytmasa: 135 daqiqa/);
    await submit('6A Bobur ketdi');
    assert.equal((await attendance())[2].missing_intervals.length, 2);
    mock.timers.setTime(Date.parse('2026-10-17T09:20:00Z'));
    await submit('6A Bobur keldi');
    const row = (await attendance())[2];
    assert.equal(row.late_minutes, 15);
    assert.equal(row.status, 'late');
    assert.equal(row.missing_intervals.length, 2);
    assert.ok(row.missing_intervals.every(i => i.end));
    assert.match(await studentHistory(3), /Jami yo‘qotilgan vaqt: 35 daqiqa/);
    assert.match(await weeklyStudentReport('late'), /yo‘qotilgan 35 daqiqa/);
});

test('updated class report closes an absent student interval as a late arrival', async () => {
    await submit('6A kelmaganlar: Oripov');
    await submit('6A hamma keldi');
    const row = (await attendance())[2];
    assert.equal(row.status, 'late');
    assert.equal(row.late_minutes, 30);
    assert.ok(row.missing_intervals[0].end);
});

test('an older movement cannot overwrite a more recent departure', async () => {
    await submit('6A hamma keldi');
    await submit('6A Bobur ketdi');
    const stale = context('6A Bobur keldi');
    stale.message.date = Date.parse('2026-10-17T03:50:00Z') / 1000;
    await handleStudentMessage(stale);
    assert.match(stale.replies[0].text, /oldin yuborilgan/);
    assert.equal((await attendance())[2].status, 'left');
});

test('new submissions invalidate older clarification replies; redelivery is ignored', async () => {
    await submit('6A 3/2\nAli');
    const session = await openSession();
    const newer = await submit('6A hamma keldi');
    const oldReply = context('Karimov');
    oldReply.message.reply_to_message = { message_id: Number(session.prompt_id) };
    assert.equal(await handleStudentMessage(oldReply), false);
    assert.equal((await attendance()).filter(a => a.status === 'absent').length, 0);
    const events = (await run('SELECT * FROM attendance_events')).rowCount;
    await handleStudentMessage(newer);
    assert.equal((await run('SELECT * FROM attendance_events')).rowCount, events);
});

test('unknown roster, arrival before daily report and day-off recording are rejected', async () => {
    assert.match((await submit('6B hamma keldi')).replies[0].text, /hali kiritilmagan/);
    assert.match((await submit('6A Bobur keldi')).replies[0].text, /Avval/);
    await run('INSERT INTO days_off(date) VALUES ($1)', [date]);
    await submit('6A hamma keldi');
    assert.equal((await attendance()).length, 0);
});

test('expired and cross-chat clarification cannot change accepted attendance', async () => {
    await submit('6A 3/2\nAli');
    const session = await openSession();
    const wrongChat = context('Karimov');
    wrongChat.message.reply_to_message = { message_id: Number(session.prompt_id) };
    wrongChat.chat.id = 12345;
    await handleStudentMessage(wrongChat);
    assert.equal((await attendance()).length, 0);
    await run("UPDATE attendance_pending SET expires_at='2000-01-01'");
    const expired = context('Karimov');
    expired.message.reply_to_message = { message_id: Number(session.prompt_id) };
    await handleStudentMessage(expired);
    assert.equal((await attendance()).length, 0);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 2);
});

test('weekly reports exclude holidays and Sundays and have stable rankings', async () => {
    await submit('6A kelmaganlar: Oripov');
    await run(`INSERT INTO student_attendance(student_id,date,class_name,status,arrived_late) VALUES
        (3,'2026-10-12','6A','absent',false),(3,'2026-10-13','6A','absent',false),
        (1,'2026-10-11','6A','absent',false)`);
    await run("INSERT INTO days_off(date) VALUES ('2026-10-13')");
    const report = await weeklyStudentReport('absent', { start: '2026-10-11', end: date }, true);
    assert.match(report, /Bobur Oripov.*2 kun/);
    assert.doesNotMatch(report, /Ali Karimov/);
    assert.doesNotMatch(report, /2026-10-13/);
});

test('weekly delivery is durable, deduplicated and retried after a failure', async () => {
    let sent = 0;
    const bot = { telegram: { sendMessage: async () => { sent++; } } };
    assert.equal(await sendWeeklyStudentReport(bot, -1), true);
    assert.equal(await sendWeeklyStudentReport(bot, -1), false);
    assert.equal(sent, 1);
    await assert.rejects(sendWeeklyStudentReport({ telegram: { sendMessage: async () => { throw new Error('network'); } } }, -2));
    assert.equal(await sendWeeklyStudentReport(bot, -2), true);
});

test('clean today clears individual and class records, cancels pending, keeps audit trail', async () => {
    await submit('6A kelmaganlar: Oripov');
    await submit('6A 3/2\nAli');
    assert.equal((await cleanTodayData()).success, true);
    assert.equal((await attendance()).length, 0);
    assert.equal((await run('SELECT * FROM attendance_logs')).rowCount, 0);
    assert.equal(await openSession(), undefined);
    assert.equal((await run('SELECT * FROM attendance_events WHERE new_status IS NULL')).rowCount, 6);
});

test('roster changes preserve history, block mid-day imports, invalidate pending versions', async () => {
    await submit('6A hamma keldi');
    await assert.rejects(transaction(client => importRoster(client, groups, date)), /already have/);
    await transaction(client => importRoster(client, [{ className: '6A', students: groups[0].students.slice(0, 2) }], '2026-10-19'));
    assert.equal((await attendance()).length, 3);
    assert.equal((await run('SELECT * FROM roster_students WHERE active')).rowCount, 2);
});

test('long reports are split into Telegram-sized messages', async () => {
    const chunks = [];
    await sendLongMessage({ sendMessage: async (_, text) => { chunks.push(text); } }, 1, Array(200).fill('x'.repeat(100)).join('\n'));
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(c => c.length <= 3800));
});

test('SQL failures roll back all individual writes and leave previous attendance intact', async () => {
    await submit('6A hamma keldi');
    const original = pool.connect;
    pool.connect = async () => ({ release() {}, query: async (sql, params) => {
        if (sql.includes('INSERT INTO attendance_events')) throw new Error('simulated audit write failure');
        return run(sql, params);
    } });
    try { await assert.rejects(submit('6A kelmaganlar: Oripov'), /audit write failure/); }
    finally { pool.connect = original; }
    assert.equal((await attendance()).filter(a => a.status === 'present').length, 3);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 3);
});

test('a crashed weekly delivery is reclaimed after its lease', async () => {
    await run(`INSERT INTO weekly_student_deliveries(week_start,chat_id,claimed_at)
        VALUES ('2026-10-12',-1,now()-interval '30 minutes')`);
    let sent = 0;
    await sendWeeklyStudentReport({ telegram: { sendMessage: async () => { sent++; } } }, -1);
    assert.equal(sent, 1);
    assert.equal((await run('SELECT state FROM weekly_student_deliveries')).rows[0].state, 'sent');
});

test('startup refuses incomplete rosters before opening a port or polling', async () => {
    await assert.rejects(start, /rosters missing/);
    const classes = config.classes;
    try { config.classes = ['6A']; await verifyStudentSetup(); }
    finally { config.classes = classes; }
});

test('real Telegraf routing processes group attendance and restricts private reports', async () => {
    const api = [];
    const original = Telegram.prototype.callApi;
    Telegram.prototype.callApi = async function(method, data) {
        api.push({ method, data });
        return { message_id: ++messageId, chat: { id: data.chat_id }, text: data.text };
    };
    bot.botInfo = { id: 1000, is_bot: true, first_name: 'Test bot', username: 'test_lsl_bot' };
    const dispatch = async (text, user = 123, chat = config.allowedGroupId) => {
        const message = { message_id: ++messageId, date: 1792209600, from: { id: user, first_name: 'Teacher', is_bot: false },
            chat: { id: chat, type: chat < 0 ? 'supergroup' : 'private' }, text };
        if (text.startsWith('/')) message.entities = [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }];
        await bot.handleUpdate({ update_id: message.message_id, message });
    };
    const quiet = mock.method(console, 'log', () => {});
    try {
        await dispatch('6A kelmaganlar: Oripov');
        assert.equal((await attendance())[2].status, 'absent');
        const before = api.length;
        await dispatch('/oquvchi 6A Bobur', 999, 999);
        assert.equal(api.length, before);
        await dispatch('/start', config.ownerUserId, config.ownerUserId);
        const greeting = api.find(r => r.data.reply_markup?.inline_keyboard?.some(row => row.some(b => b.callback_data === 'students_absent_current')));
        assert.ok(greeting);
        await dispatch('/oquvchi 6A Bobur', config.ownerUserId, config.ownerUserId);
        assert.ok(api.some(r => r.data.text?.includes('Kelmagan: 1 kun')));
        const callbackUpdate = (data, actor) => ({ update_id: ++messageId, callback_query: {
            id: 'test-callback', from: { id: actor, first_name: 'User' }, chat_instance: 'test', data,
            message: { message_id: 20, date: 1792209600, chat: { id: actor, type: 'private' } }
        } });
        await bot.handleUpdate(callbackUpdate('students_absent_current', config.ownerUserId));
        assert.ok(api.some(r => r.data.text?.includes('Haftalik kelmaganlar — TOP 10')));
        await bot.handleUpdate(callbackUpdate('students_late_current', 999));
        assert.ok(api.some(r => r.data.text?.includes('faqat ruxsat berilgan')));
        await bot.handleUpdate(callbackUpdate('students_roster_help', config.ownerUserId));
        assert.ok(api.some(r => r.data.text?.includes('Jami: 3 o‘quvchi')));
        await bot.handleUpdate(callbackUpdate('students_roster_6A', config.ownerUserId));
        assert.ok(api.some(r => r.data.text?.includes('1. Ali Karimov')));
    } finally { Telegram.prototype.callApi = original; quiet.mock.restore(); }
});

test('feature disabled retains legacy attendance processing', async () => {
    const original = Telegram.prototype.callApi;
    const quiet = mock.method(console, 'log', () => {});
    Telegram.prototype.callApi = async () => ({ message_id: 1 });
    config.studentAttendanceEnabled = false;
    bot.botInfo = { id: 1000, is_bot: true, first_name: 'Test', username: 'test_lsl_bot' };
    try {
        await bot.handleUpdate({ update_id: ++messageId, message: {
            message_id: ++messageId, date: 1792209600, from: { id: 123, first_name: 'Teacher' },
            chat: { id: config.allowedGroupId, type: 'supergroup' }, text: '6A 3/2'
        } });
        assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 2);
        assert.equal((await attendance()).length, 0);
    } finally { config.studentAttendanceEnabled = true; Telegram.prototype.callApi = original; quiet.mock.restore(); }
});

test('class roster review lists only active names and includes class count', async () => {
    await run('UPDATE roster_students SET active=false WHERE id=3');
    const report = await classRosterReport('6A');
    assert.match(report, /6A — 2 o‘quvchi/);
    assert.match(report, /Ali Karimov/);
    assert.doesNotMatch(report, /Bobur Oripov/);
});

test('health endpoint reports database failure as unavailable', async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/health`;
    try {
        const healthy = await fetch(url);
        assert.equal(healthy.status, 200);
        assert.equal((await healthy.json()).studentAttendanceEnabled, true);
        pool.query = async () => { throw new Error('offline'); };
        const failed = await fetch(url);
        assert.equal(failed.status, 503);
        assert.equal((await failed.json()).db, 'error');
    } finally { pool.query = run; await new Promise(resolve => server.close(resolve)); }
});

test('partial reports keep aggregate counts through a matched arrival and never guess unknown identities', async () => {
    await submit('6A 3/1\nKarimov\nUnknown');
    await submit('6A Karimov keldi');
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 2);
    assert.equal((await attendance()).filter(row => row.status_confirmed).length, 1);
    const noGuess = await submit('6A Bobur keldi');
    assert.match(noGuess.replies[0].text, /oldingi holati aniqlanmagan/);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 2);
});

test('a new partial report removes stale identities from individual statistics without deleting history', async () => {
    await submit('6A kelmaganlar: Oripov');
    await submit('6A 3/2\nUnknown');
    assert.equal((await attendance()).length, 3);
    assert.ok((await attendance()).every(row => row.status_confirmed === false));
    assert.doesNotMatch(await weeklyStudentReport('absent'), /Bobur Oripov/);
    assert.match(await studentHistory(3), /Davomat qayd etilgan: 0 kun/);
    await submit('6A 3/2\nKarimov');
    assert.ok((await attendance()).every(row => row.status_confirmed));
});

test('stale class reports cannot replace newer accepted counts or cancel their correction session', async () => {
    await submit('6A 3/1\nUnknown');
    const session = await openSession();
    const stale = context('6A hamma keldi');
    stale.message.date = Date.parse('2026-10-17T03:50:00Z') / 1000;
    await handleStudentMessage(stale);
    assert.equal((await run('SELECT present_count FROM attendance_logs')).rows[0].present_count, 1);
    assert.equal((await openSession()).id, session.id);
});
