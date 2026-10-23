import { randomUUID } from 'node:crypto';
import { pool, getTodayDate, isDayOff, isWithinActiveHours } from './database.js';
import { config } from './config.js';
import { matchStudent, parseStudentMessage, nextStatus } from './studentMatching.js';
import { notifyOnAttendanceUpdate } from './notifications.js';
import { messageParts } from './studentReports.js';
import { arrivalTiming, messageInstant, withTiming, missedMinutes, schoolWindow } from './attendanceTime.js';

export async function transaction(work) {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const result = await work(db);
        await db.query('COMMIT');
        return result;
    } catch (error) {
        await db.query('ROLLBACK');
        throw error;
    } finally { db.release(); }
}

export async function lockClass(db, className, date) {
    // All roster imports, attendance writes and corrections use the same lock.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`roster:${className}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`attendance:${className}:${date}`]);
}

async function rosterFor(db, className) {
    const { rows } = await db.query(`SELECT s.*, r.version FROM roster_students s
        JOIN class_rosters r USING (class_name) WHERE s.class_name=$1 AND s.active ORDER BY s.id`, [className]);
    return rows;
}

async function audit(db, session, id, before, after) {
    await db.query(`INSERT INTO attendance_events
        (student_id,date,class_name,old_status,new_status,actor_id,chat_id,message_id,occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, session.date, session.class_name, before, after, session.actor_id, session.chat_id, session.message_id, session.payload.eventAt || null]);
}

async function setStatus(db, session, student, old, next) {
    const arrival = next.first_arrival_at !== undefined ? next.first_arrival_at : old?.first_arrival_at || null;
    const departure = next.last_departure_at !== undefined ? next.last_departure_at : old?.last_departure_at || null;
    const minutes = next.late_minutes !== undefined ? next.late_minutes : old?.late_minutes ?? null;
    const intervals = next.missing_intervals ?? old?.missing_intervals ?? [];
    const complete = next.timing_complete ?? old?.timing_complete ?? false;
    const movement = next.last_movement_at ?? old?.last_movement_at ?? null;
    const iso = value => value ? new Date(value).toISOString() : null;
    if (old?.status_confirmed !== false && old?.status === next.status && old?.arrived_late === next.arrived_late &&
        iso(old.first_arrival_at) === iso(arrival) && iso(old.last_departure_at) === iso(departure) &&
        old.late_minutes === minutes && old.timing_complete === complete &&
        JSON.stringify(old.missing_intervals) === JSON.stringify(intervals) && iso(old.last_movement_at) === iso(movement)) return;
    await db.query(`INSERT INTO student_attendance
        (student_id,date,class_name,status,arrived_late,first_arrival_at,last_departure_at,late_minutes,missing_intervals,timing_complete,last_movement_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT (student_id,date) DO UPDATE SET
        class_name=EXCLUDED.class_name,status=EXCLUDED.status,arrived_late=EXCLUDED.arrived_late,
        first_arrival_at=EXCLUDED.first_arrival_at,last_departure_at=EXCLUDED.last_departure_at,
        late_minutes=EXCLUDED.late_minutes,missing_intervals=EXCLUDED.missing_intervals,status_confirmed=true,
        timing_complete=EXCLUDED.timing_complete,last_movement_at=EXCLUDED.last_movement_at,updated_at=now()`,
    [student.id, session.date, session.class_name, next.status, next.arrived_late, arrival, departure, minutes, JSON.stringify(intervals), complete, movement]);
    await audit(db, session, student.id, old?.status || null, next.status);
}

async function applySession(db, session, roster) {
    const p = session.payload;
    const ids = p.selected;
    if (new Set(ids).size !== ids.length) return { text: '❌ Bir o‘quvchi ikki marta ko‘rsatilgan. To‘liq davomatni qayta yuboring.', cancel: true };
    const { rows: current } = await db.query('SELECT * FROM student_attendance WHERE class_name=$1 AND date=$2', [session.class_name, session.date]);
    const previous = new Map(current.map(r => [r.student_id, r]));
    if (p.eventAt && current.some(row => (p.kind === 'report' || ids.includes(row.student_id)) &&
        row.last_movement_at && Date.parse(row.last_movement_at) > Date.parse(p.eventAt))) {
        return { text: 'Bu xabar oxirgi keldi/ketdi xabaridan oldin yuborilgan. Davomatni yangi xabarda qayta yuboring.', cancel: true };
    }
    let timingText = '';
    if (p.kind === 'report') {
        for (const student of roster) {
            const old = previous.get(student.id);
            // A repeated class submission must not erase an already recorded late arrival.
            const absent = ids.includes(student.id);
            let next = absent ? { status: 'absent', arrived_late: false }
                : { status: old?.arrived_late ? 'late' : 'present', arrived_late: !!old?.arrived_late };
            const action = absent ? 'absent' : old && ['absent', 'left'].includes(old.status) ? 'keldi' : 'report';
            next = withTiming(old, next, action, p.eventAt || new Date(), session.date);
            await setStatus(db, session, student, old, next);
        }
    } else {
        const student = roster.find(s => s.id === ids[0]), old = previous.get(student.id);
        if (!old || old.status_confirmed === false) return { text: 'Bu o‘quvchining oldingi holati aniqlanmagan. Sinfning jami/kelgan soni bilan yangi davomat yuboring.', cancel: true };
        const next = withTiming(old, nextStatus(old, p.kind), p.kind, p.eventAt || session.created_at || new Date(), session.date);
        if (p.kind === 'keldi' && old.status === 'absent') {
            const timing = arrivalTiming(next.first_arrival_at);
            timingText = `\nKelgan vaqt: ${timing.time} (Toshkent)\nKechikish: ${timing.lateMinutes} daqiqa (08:30 dan)`;
        } else if (p.kind === 'ketdi' && ['present', 'late'].includes(old.status)) {
            timingText = `\nKetgan vaqt: ${arrivalTiming(next.last_departure_at).time} (Toshkent)`;
        } else if (p.kind === 'keldi' && old.status === 'left') {
            timingText = `\nQaytgan vaqt: ${arrivalTiming(p.eventAt || new Date()).time} (Toshkent)`;
        } else {
            timingText = '\nTakroriy xabar vaqt va hisobni o‘zgartirmaydi.';
        }
        const recorded = { ...next, date: session.date };
        const missing = missedMinutes(recorded);
        timingText += `\nHozirgacha yo‘qotilgan vaqt: ${missing === null ? 'noma’lum' : missing + ' daqiqa'}${!next.timing_complete ? ' (oldingi vaqtlar to‘liq emas)' : ''}`;
        if (next.status === 'left') timingText += `\n16:00 gacha qaytmasa: ${missedMinutes(recorded, new Date(schoolWindow(session.date).end))} daqiqa`;
        await setStatus(db, session, student, old, next);
    }
    const { rows: totals } = await db.query(`SELECT
        count(*) FILTER (WHERE status IN ('present','late'))::int AS present,
        count(*) FILTER (WHERE status='absent')::int AS absent,
        count(*) FILTER (WHERE arrived_late)::int AS late
        FROM student_attendance a JOIN roster_students s ON s.id=a.student_id
        WHERE a.class_name=$1 AND a.date=$2 AND a.status_confirmed AND s.active AND s.class_name=$1`, [session.class_name, session.date]);
    const { rows: absentRows } = await db.query(`SELECT s.full_name FROM student_attendance a
        JOIN roster_students s ON s.id=a.student_id WHERE a.class_name=$1 AND a.date=$2
        AND a.status='absent' AND a.status_confirmed AND s.active AND s.class_name=$1 ORDER BY s.full_name`, [session.class_name, session.date]);
    const t = totals[0];
    const aggregate = (await db.query('SELECT * FROM attendance_logs WHERE class_name=$1 AND date=$2', [session.class_name, session.date])).rows[0];
    if (aggregate?.source_event_at && Date.parse(aggregate.source_event_at) > Date.parse(p.eventAt)) {
        throw new Error('Bu xabar eng oxirgi davomatdan oldin yuborilgan. Yangi xabar yuboring.');
    }
    if (aggregate && p.kind !== 'report') {
        const old = previous.get(ids[0]);
        const now = (await db.query('SELECT status FROM student_attendance WHERE student_id=$1 AND date=$2', [ids[0], session.date])).rows[0];
        const counted = status => ['present', 'late'].includes(status) ? 1 : 0;
        t.present = aggregate.present_count + counted(now.status) - counted(old.status);
        if (t.present < 0 || t.present > aggregate.total_students) throw new Error('Sinf sonlarini yangi davomatda aniqlashtiring.');
    }
    await db.query(`INSERT INTO attendance_logs (class_name,date,present_count,total_students,student_names,updated_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,now()) ON CONFLICT (class_name,date) DO UPDATE SET
        present_count=EXCLUDED.present_count,total_students=EXCLUDED.total_students,
        student_names=EXCLUDED.student_names,updated_at=now()`,
    [session.class_name, session.date, t.present, aggregate?.total_students ?? roster.length, JSON.stringify([...(absentRows.map(s => s.full_name)), ...(aggregate?.unresolved_names || [])])]);
    await db.query('UPDATE attendance_logs SET source_event_at=$3,source_message_id=$4 WHERE class_name=$1 AND date=$2', [session.class_name, session.date, p.eventAt, session.message_id]);
    await db.query("UPDATE attendance_pending SET state='done' WHERE id=$1", [session.id]);
    const names = ids.map(id => roster.find(s => s.id === id).full_name);
    return { text: `✅ ${session.class_name}: ${aggregate?.total_students ?? roster.length}/${t.present}\n` +
        (p.kind === 'report' ? `Kelmaganlar: ${absentRows.map(s => s.full_name).join(', ') || 'yo‘q'}` : `${names[0]} ${p.kind}`) +
        timingText + `\nKech qolganlar: ${t.late}`,
    notify: { className: session.class_name, total: aggregate?.total_students ?? roster.length, present: t.present } };
}

export async function acceptClassReport(db, session, roster) {
    const p = session.payload;
    const aggregate = (await db.query('SELECT * FROM attendance_logs WHERE class_name=$1 AND date=$2', [session.class_name, session.date])).rows[0];
    const { rows: current } = await db.query('SELECT * FROM student_attendance WHERE class_name=$1 AND date=$2', [session.class_name, session.date]);
    if ((aggregate?.source_event_at && (Date.parse(aggregate.source_event_at) > Date.parse(p.eventAt) ||
        (Date.parse(aggregate.source_event_at) === Date.parse(p.eventAt) && Number(aggregate.source_message_id) > Number(session.message_id)))) ||
        current.some(row => row.last_movement_at && Date.parse(row.last_movement_at) > Date.parse(p.eventAt))) {
        return { text: 'Bu xabar eng oxirgi davomatdan oldin yuborilgan. Yangi davomat saqlanib qoldi.', cancel: true };
    }
    const selected = new Map(), unresolved = [];
    for (const name of p.names) {
        const match = matchStudent(name, roster);
        if (match.student) selected.set(match.student.id, match.student);
        else unresolved.push(name);
    }
    const total = p.total ?? roster.length;
    const absent = p.present !== undefined ? total - p.present : selected.size + new Set(unresolved).size;
    const present = total - absent;
    if (!Number.isInteger(total) || total < 1 || total > 60 || present < 0 || present > total) {
        return { text: '❌ Jami/kelgan sonlari noto‘g‘ri. Davomatni qayta yuboring.', cancel: true };
    }
    // If the named absences contradict the explicit total, do not guess which name is wrong.
    if (selected.size > absent) {
        unresolved.push(...p.names);
        selected.clear();
    }
    const complete = total === roster.length && !unresolved.length && selected.size === absent;
    const previous = new Map(current.map(row => [row.student_id, row]));
    if (!complete) {
        for (const row of current) {
            if (!selected.has(row.student_id) && row.status_confirmed) await audit(db, session, row.student_id, row.status, null);
        }
        await db.query('UPDATE student_attendance SET status_confirmed=false WHERE class_name=$1 AND date=$2 AND NOT (student_id=ANY($3::int[]))',
            [session.class_name, session.date, [...selected.keys()]]);
    }
    for (const student of roster) {
        const isAbsent = selected.has(student.id);
        if (!complete && !isAbsent) continue;
        const old = previous.get(student.id);
        const next = isAbsent ? { status: 'absent', arrived_late: false }
            : { status: old?.arrived_late ? 'late' : 'present', arrived_late: !!old?.arrived_late };
        const action = isAbsent ? 'absent' : old && ['absent', 'left'].includes(old.status) ? 'keldi' : 'report';
        await setStatus(db, session, student, old, withTiming(old, next, action, p.eventAt, session.date));
    }
    const unknown = [...new Set(unresolved)];
    const names = [...selected.values()].map(student => student.full_name).concat(unknown);
    await audit(db, session, null, aggregate ? `${aggregate.total_students}/${aggregate.present_count}` : null,
        `${total}/${present}${complete ? '' : ' (ismlar to‘liq emas)'}`);
    await db.query(`INSERT INTO attendance_logs (class_name,date,present_count,total_students,student_names,names_complete,unresolved_names,source_event_at,source_message_id,updated_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,now()) ON CONFLICT (class_name,date) DO UPDATE SET
        present_count=EXCLUDED.present_count,total_students=EXCLUDED.total_students,student_names=EXCLUDED.student_names,
        names_complete=EXCLUDED.names_complete,unresolved_names=EXCLUDED.unresolved_names,source_event_at=EXCLUDED.source_event_at,
        source_message_id=EXCLUDED.source_message_id,updated_at=now()`,
        [session.class_name, session.date, present, total, JSON.stringify(names), complete, JSON.stringify(unknown), p.eventAt, session.message_id]);
    p.selected = [...selected.keys()];
    p.unresolvedNames = unknown;
    p.acceptedPresent = present;
    p.namesComplete = complete;
    p.awaitingNames = !complete;
    await savePayload(db, session);
    await db.query('UPDATE attendance_pending SET state=$2 WHERE id=$1', [session.id, complete ? 'done' : 'open']);
    const missing = Math.max(0, absent - selected.size - unknown.length);
    return { text: `✅ ${session.class_name}: ${total}/${present} — davomat saqlandi.\n` +
        `Kelmaganlar: ${names.join(', ') || (absent ? 'ismlar hali berilmagan' : 'yo‘q')}` +
        (complete ? '' : `\n⚠️ Ismlar to‘liq aniqlanmagan.${unknown.length ? '\nTopilmagan/noaniq: ' + unknown.join(', ') : ''}` +
            (missing ? `\nYana ${missing} nafar o‘quvchining ismi kutilmoqda.` : '') +
            (total !== roster.length ? `\nRasmiy ro‘yxat: ${roster.length}; yuborilgan jami: ${total}.` : '') +
            '\nSonlar va topilgan o‘quvchilar qabul qilindi. Ismlarni keyin to‘g‘rilashingiz mumkin.'),
        forceReply: !complete,
        notify: { className: session.class_name, total, present } };
}

async function advance(db, session, roster) {
    if (session.payload.kind === 'report') {
        const result = await acceptClassReport(db, session, roster);
        if (result.cancel) await db.query("UPDATE attendance_pending SET state='cancelled' WHERE id=$1", [session.id]);
        return result;
    }
    const p = session.payload;
    if (p.expectedAbsent !== undefined && p.expectedAbsent !== p.names.length) {
        p.awaitingNames = true;
        await savePayload(db, session);
        return { text: `${session.class_name}: ${p.expectedAbsent} nafar kelmagan o‘quvchining ismini yuboring.\n` +
            `Hozir ${p.names.length} ta ism berilgan. Shu xabarga javob bering: har bir ism alohida qatorda.\nDavomat hali saqlanmadi.`, forceReply: true };
    }
    p.awaitingNames = false;
    while (p.selected.length < p.names.length) {
        const index = p.selected.length;
        const match = matchStudent(p.names[index], roster);
        if (match.student) {
            p.selected.push(match.student.id);
            continue;
        }
        p.candidates = match.candidates.map(s => s.id);
        await savePayload(db, session);
        if (!p.candidates.length) {
            p.awaitingNames = true;
            await savePayload(db, session);
            return { text: `❓ ${session.class_name}: “${p.names[index].slice(0, 120)}” topilmadi.\n` +
                'Shu xabarga javoban ismlarning to‘liq ro‘yxatini qayta yuboring (har biri alohida qatorda). Davomat hali saqlanmadi.', forceReply: true };
        }
        return { text: `❓ ${session.class_name}: “${p.names[index].slice(0, 120)}” — qaysi o‘quvchi?`,
            keyboard: match.candidates.map(s => [{ text: `${s.full_name} (#${s.id})`.slice(0, 60), callback_data: `st:${session.id}:${index}:${s.id}` }]) };
    }
    const result = await applySession(db, session, roster);
    if (result.cancel) await db.query("UPDATE attendance_pending SET state='cancelled' WHERE id=$1", [session.id]);
    return result;
}

async function savePayload(db, session) {
    await db.query('UPDATE attendance_pending SET payload=$2::jsonb WHERE id=$1', [session.id, JSON.stringify(session.payload)]);
}

async function deliver(ctx, result) {
    if (!result) return;
    const options = result.keyboard ? { reply_markup: { inline_keyboard: result.keyboard } }
        : result.forceReply ? { reply_markup: { force_reply: true, selective: true }, reply_parameters: { message_id: result.sourceMessageId || ctx.message?.message_id || ctx.callbackQuery.message.message_id } } : {};
    let message;
    for (const part of messageParts(result.text)) message = await ctx.reply(part, options);
    if (result.sessionId && result.forceReply) {
        await pool.query('UPDATE attendance_pending SET prompt_id=$2 WHERE id=$1', [result.sessionId, message.message_id]);
    }
    if (result.notify) {
        const n = result.notify;
        await notifyOnAttendanceUpdate(ctx.bot || { telegram: ctx.telegram }, n.className, n.total, n.present, true);
    }
}

export async function handleStudentMessage(ctx) {
    if (!isWithinActiveHours() || await isDayOff()) return false;
    const parsed = parseStudentMessage(ctx.message.text || '');
    if (!parsed) return handleNamesReply(ctx);
    if (!config.classes.includes(parsed.className)) { await ctx.reply('❌ Bunday sinf yo‘q.'); return true; }
    if (parsed.names.length > 60 || parsed.names.some(n => n.length > 150)) {
        await ctx.reply('❌ Ismlar ro‘yxati juda uzun. Har bir o‘quvchini alohida qatorda yuboring.'); return true;
    }
    const date = getTodayDate();
    let eventAt;
    try { eventAt = messageInstant(ctx.message, date); }
    catch (error) { await ctx.reply(error.message); return true; }
    const result = await transaction(async db => {
        await lockClass(db, parsed.className, date);
        const roster = await rosterFor(db, parsed.className);
        if (!roster.length) return { text: `⚠️ ${parsed.className} uchun rasmiy o‘quvchilar ro‘yxati hali kiritilmagan.` };
        if (parsed.total !== undefined && (!Number.isInteger(parsed.total) || parsed.total < 1 || parsed.total > 60 || parsed.present < 0 || parsed.present > parsed.total)) {
            return { text: `❌ ${parsed.className} ro‘yxatida ${roster.length} o‘quvchi bor. Jami/kelgan sonlarini tekshirib qayta yuboring.` };
        }
        if (parsed.kind === 'report' && parsed.expectedAbsent === undefined && !parsed.names.length) {
            return { text: 'Kelmaganlarning ismlarini yozing yoki “hamma keldi” deb yuboring.' };
        }
        if (parsed.kind !== 'report') {
            const recorded = await db.query('SELECT student_id FROM student_attendance WHERE class_name=$1 AND date=$2', [parsed.className, date]);
            if (!recorded.rowCount) return { text: 'Avval shu sinfning to‘liq davomatini yuboring.' };
        }
        const latest = (await db.query('SELECT source_event_at FROM attendance_logs WHERE class_name=$1 AND date=$2', [parsed.className, date])).rows[0];
        if (latest?.source_event_at && Date.parse(latest.source_event_at) > Date.parse(eventAt)) {
            return { text: 'Bu xabar eng oxirgi davomatdan oldin yuborilgan. Yangi davomat saqlanib qoldi.' };
        }
        const duplicate = await db.query('SELECT id FROM attendance_pending WHERE chat_id=$1 AND message_id=$2', [ctx.chat.id, ctx.message.message_id]);
        if (duplicate.rowCount) return null;
        await db.query("UPDATE attendance_pending SET state='cancelled' WHERE class_name=$1 AND date=$2 AND state='open'", [parsed.className, date]);
        const session = { id: randomUUID(), class_name: parsed.className, date, actor_id: ctx.from.id,
            chat_id: ctx.chat.id, message_id: ctx.message.message_id, payload: { ...parsed, eventAt, selected: [] } };
        await db.query(`INSERT INTO attendance_pending (id,class_name,date,actor_id,chat_id,message_id,roster_version,payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [session.id, session.class_name, date, session.actor_id, session.chat_id, session.message_id, roster[0].version, JSON.stringify(session.payload)]);
        return { ...(await advance(db, session, roster)), sessionId: session.id, sourceMessageId: session.message_id };
    });
    await deliver(ctx, result);
    return true;
}

export async function verifyStudentSetup() {
    // Fail before polling starts if feature activation is incomplete.
    await pool.query('SELECT id FROM attendance_pending LIMIT 0');
    await pool.query('SELECT status_confirmed FROM student_attendance LIMIT 0');
    await pool.query('SELECT names_complete FROM attendance_logs LIMIT 0');
    await pool.query('SELECT student_id FROM student_attendance LIMIT 0');
    await pool.query('SELECT first_arrival_at,last_departure_at,late_minutes,missing_intervals,timing_complete,last_movement_at FROM student_attendance LIMIT 0');
    await pool.query('SELECT week_start FROM weekly_student_deliveries LIMIT 0');
    const { rows } = await pool.query(`SELECT r.class_name,count(s.id)::int AS students,c.total_students
        FROM class_rosters r JOIN classes c USING (class_name)
        LEFT JOIN roster_students s ON s.class_name=r.class_name AND s.active
        GROUP BY r.class_name,c.total_students`);
    const missing = config.classes.filter(name => !rows.some(r => r.class_name === name && r.students > 0 && r.students === r.total_students));
    if (missing.length) throw new Error(`Official rosters missing or inconsistent: ${missing.join(', ')}`);
}

async function resume(ctx, id, change) {
    if (!isWithinActiveHours() || await isDayOff()) return { text: 'Davomat faqat o‘quv kunlari 08:00–16:00 oralig‘ida qabul qilinadi.' };
    return transaction(async db => {
        const initial = (await db.query('SELECT * FROM attendance_pending WHERE id=$1', [id])).rows[0];
        if (!initial) return { text: 'Bu so‘rov topilmadi.' };
        await lockClass(db, initial.class_name, initial.date);
        const session = (await db.query('SELECT * FROM attendance_pending WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (String(session.chat_id) !== String(ctx.chat.id) ||
            (String(session.actor_id) !== String(ctx.from.id) && ctx.from.id !== config.ownerUserId)) {
            return { text: 'Faqat davomatni yuborgan foydalanuvchi yoki bot egasi javob bera oladi.' };
        }
        if (session.state !== 'open' || session.date !== getTodayDate() || new Date(session.expires_at) <= new Date()) {
            return { text: 'Bu so‘rov eskirgan. Davomatni qayta yuboring.' };
        }
        const roster = await rosterFor(db, session.class_name);
        if (!roster.length || roster[0].version !== session.roster_version) return { text: 'Sinf ro‘yxati o‘zgargan. Davomatni qayta yuboring.' };
        const error = change(session);
        if (error) return { text: error };
        return { ...(await advance(db, session, roster)), sessionId: session.id, sourceMessageId: session.message_id };
    });
}

export async function handleStudentCallback(ctx) {
    const match = ctx.callbackQuery.data.match(/^st:([0-9a-f-]{36}):(\d+):(\d+)$/);
    if (!match) return;
    const result = await resume(ctx, match[1], session => {
        const p = session.payload, index = Number(match[2]), id = Number(match[3]);
        if (index !== p.selected.length || !p.candidates?.includes(id)) return 'Bu tanlov eskirgan. Oxirgi savolga javob bering.';
        p.selected.push(id);
        p.candidates = [];
    });
    await deliver(ctx, result);
}

async function handleNamesReply(ctx) {
    const prompt = ctx.message.reply_to_message?.message_id;
    if (!prompt) return false;
    const { rows } = await pool.query("SELECT id FROM attendance_pending WHERE chat_id=$1 AND prompt_id=$2 AND state='open'", [ctx.chat.id, prompt]);
    if (!rows.length) return false;
    const result = await resume(ctx, rows[0].id, session => {
        if (!session.payload.awaitingNames) return 'Ism tanlash uchun tugmalardan foydalaning.';
        const names = parseStudentMessage(`${session.class_name} kelmaganlar:\n${ctx.message.text}`).names;
        if (!names.length && session.payload.expectedAbsent !== 0) return 'Iltimos, o‘quvchilarning ismlarini yuboring.';
        if (names.length > 60 || names.some(n => n.length > 150)) return 'Ismlar ro‘yxati juda uzun.';
        if (session.payload.kind !== 'report' && names.length !== 1) return 'Bitta o‘quvchining ismini yuboring.';
        session.payload.names = names;
        session.payload.selected = [];
        session.payload.candidates = [];
    });
    await deliver(ctx, result);
    return true;
}
