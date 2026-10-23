import { pool, getTodayDate } from './database.js';
import { weekRange, matchStudent, normalizeName } from './studentMatching.js';
import { tashkentClock, missedMinutes } from './attendanceTime.js';

export async function classRosterReport(className) {
    const { rows } = await pool.query(`SELECT full_name FROM roster_students
        WHERE class_name=$1 AND active ORDER BY full_name,id`, [className]);
    return `📋 ${className} — ${rows.length} o‘quvchi\n\n` +
        (rows.length ? rows.map((s, i) => `${i + 1}. ${s.full_name}`).join('\n') : 'Ro‘yxat hali kiritilmagan.');
}

export function messageParts(text) {
    // Split on lines, so a report cannot exceed Telegram's message limit.
    let part = '';
    const parts = [];
    for (const line of text.split('\n')) {
        if (part.length + line.length + 1 > 3800) {
            if (part) parts.push(part.trimEnd());
            part = '';
        }
        // Roster names are bounded on import; still handle arbitrary long lines safely.
        for (let offset = 0; offset < line.length; offset += 3700) {
            const chunk = line.slice(offset, offset + 3700);
            if (part.length + chunk.length + 1 > 3800) {
                parts.push(part.trimEnd()); part = '';
            }
            part += chunk + '\n';
        }
        if (!line) part += '\n';
    }
    if (part.trim()) parts.push(part.trimEnd());
    return parts;
}

export async function sendLongMessage(telegram, chatId, text) {
    for (const part of messageParts(text)) await telegram.sendMessage(chatId, part);
}

export async function weeklyStudentReport(kind, { start, end } = weekRange(getTodayDate()), details = false) {
    if (!['absent', 'late'].includes(kind)) throw new Error('Invalid report kind');
    const condition = kind === 'late' ? 'a.arrived_late' : "a.status='absent'";
    const { rows } = await pool.query(`SELECT s.id,s.full_name,
        string_agg(DISTINCT a.class_name, ', ' ORDER BY a.class_name) AS class_name,count(*)::int AS days,
        coalesce(sum(a.late_minutes) FILTER (WHERE a.arrived_late),0)::int AS late_minutes,
        count(*) FILTER (WHERE a.arrived_late AND a.late_minutes IS NULL)::int AS unknown_times,
        jsonb_agg(jsonb_build_object('date',a.date::text,'missing_intervals',a.missing_intervals,'timing_complete',a.timing_complete)) AS timing_rows,
        array_agg(a.date::text ORDER BY a.date) AS dates
        FROM student_attendance a JOIN roster_students s ON s.id=a.student_id
        WHERE a.date BETWEEN $1 AND $2 AND a.status_confirmed AND ${condition}
        AND extract(isodow FROM a.date)<>7 AND NOT EXISTS (SELECT 1 FROM days_off d WHERE d.date=a.date)
        GROUP BY s.id,s.full_name ORDER BY days DESC,s.full_name,s.id LIMIT 10`, [start, end]);
    const title = kind === 'late' ? 'Haftalik kech qolganlar' : 'Haftalik kelmaganlar';
    return `${title} — TOP 10\n${start} — ${end}\n\n` + (rows.length
        ? rows.map((r, i) => `${i + 1}. ${r.full_name} (${r.class_name}) — ${r.days} kun` +
            (kind === 'late' ? `, ${r.late_minutes} daqiqa${r.unknown_times ? ` (+${r.unknown_times} kun vaqti noma’lum)` : ''}` : '') +
            `; yo‘qotilgan ${r.timing_rows.reduce((sum, row) => sum + (missedMinutes(row) || 0), 0)} daqiqa` +
            (r.timing_rows.some(row => !row.timing_complete) ? ' (vaqtlar to‘liq emas)' : '') +
            `${details ? '\n   ' + r.dates.join(', ') : ''}`).join('\n')
        : 'Bu davrda qayd etilgan holatlar yo‘q.') +
        '\n\nFaqat o‘quvchi bo‘yicha tasdiqlangan davomat hisoblanadi. Topshirilmagan kunlar hisoblanmaydi.';
}

export async function sendWeeklyStudentReport(bot, chatId) {
    const range = weekRange(getTodayDate());
    const text = await weeklyStudentReport('absent', range) + '\n\n' + await weeklyStudentReport('late', range);
    // Include timing totals without exceeding Telegram's per-message limit.
    const claimed = await pool.query(`INSERT INTO weekly_student_deliveries (week_start,chat_id)
        VALUES ($1,$2) ON CONFLICT (week_start,chat_id) DO UPDATE SET claimed_at=now()
        WHERE weekly_student_deliveries.state='sending'
        AND weekly_student_deliveries.claimed_at < now() - interval '15 minutes'
        RETURNING week_start`, [range.start, chatId]);
    if (!claimed.rowCount) return false;
    try {
        await sendLongMessage(bot.telegram, chatId, text);
        await pool.query("UPDATE weekly_student_deliveries SET state='sent',sent_at=now() WHERE week_start=$1 AND chat_id=$2", [range.start, chatId]);
        return true;
    } catch (error) {
        await pool.query('DELETE FROM weekly_student_deliveries WHERE week_start=$1 AND chat_id=$2', [range.start, chatId]);
        throw error;
    }
}

export async function studentHistory(studentId, days = 90) {
    const student = (await pool.query('SELECT * FROM roster_students WHERE id=$1', [studentId])).rows[0];
    if (!student) return 'O‘quvchi topilmadi.';
    const end = getTodayDate();
    const startDate = new Date(`${end}T00:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - days + 1);
    const start = startDate.toISOString().slice(0, 10);
    const { rows } = await pool.query(`SELECT a.date::text,a.status,a.arrived_late,a.class_name,
        a.first_arrival_at,a.last_departure_at,a.late_minutes,a.missing_intervals,a.timing_complete
        FROM student_attendance a WHERE student_id=$1 AND status_confirmed AND date BETWEEN $2 AND $3
        AND extract(isodow FROM a.date)<>7 AND NOT EXISTS (SELECT 1 FROM days_off d WHERE d.date=a.date)
        ORDER BY date DESC`, [studentId, start, end]);
    const absent = rows.filter(r => r.status === 'absent'), late = rows.filter(r => r.arrived_late);
    const minutes = late.reduce((sum, r) => sum + (r.late_minutes || 0), 0);
    const unknown = late.filter(r => r.late_minutes === null).length;
    const missing = rows.reduce((sum, row) => sum + (missedMinutes(row) || 0), 0);
    const incomplete = rows.filter(row => !row.timing_complete).length;
    const labels = { absent: 'Kelmagan', late: 'Kech qolgan', present: 'Kelgan', left: 'Erta ketgan' };
    return `👤 ${student.full_name} (${student.class_name})\n${start} — ${end}\n` +
        `Davomat qayd etilgan: ${rows.length} kun\nKelmagan: ${absent.length} kun\nKech qolgan: ${late.length} kun\n` +
        `Jami kechikish: ${minutes} daqiqa${unknown ? ` (+${unknown} kun vaqti noma’lum)` : ''}\n\n` +
        `Jami yo‘qotilgan vaqt: ${missing} daqiqa${incomplete ? ` (${incomplete} kun vaqti to‘liq emas)` : ''}\n\n` +
        (rows.length ? rows.map(r => `${r.date} (${r.class_name}): ${labels[r.status]}${r.status === 'left' && r.arrived_late ? ' / kech qolgan' : ''}` +
            (r.first_arrival_at ? `; keldi ${tashkentClock(r.first_arrival_at).time}, kechikish ${r.late_minutes} daqiqa` : '') +
            (r.last_departure_at ? `; ketdi ${tashkentClock(r.last_departure_at).time}` : '') +
            `; yo‘qotilgan ${missedMinutes(r) === null ? 'noma’lum' : missedMinutes(r) + ' daqiqa'}${!r.timing_complete ? ' (vaqtlar to‘liq emas)' : ''}`).join('\n') : 'Hali individual davomat yo‘q.');
}

export async function handleStudentHistory(ctx) {
    const input = ctx.message.text.replace(/^\/oquvchi(?:@\w+)?\s*/i, '').trim();
    const [className, ...nameParts] = input.split(/\s+/);
    if (!nameParts.length) {
        await ctx.reply('Namuna: /oquvchi 6A Ali Karimov\nOxirgi 90 kunlik ma’lumot ko‘rsatiladi.'); return;
    }
    const { rows } = await pool.query('SELECT * FROM roster_students WHERE class_name=$1 ORDER BY id', [className.toUpperCase()]);
    const result = matchStudent(nameParts.join(' '), rows);
    if (result.student) {
        await sendLongMessage(ctx.telegram, ctx.chat.id, await studentHistory(result.student.id)); return;
    }
    // No fuzzy automatic history disclosure to public chats; caller is already authorized.
    if (result.candidates.length) {
        await ctx.reply('Qaysi o‘quvchi?', { reply_markup: { inline_keyboard: result.candidates.map(s =>
            [{ text: `${s.full_name} (#${s.id})`.slice(0, 60), callback_data: `sh:${s.id}` }]) } });
    } else await ctx.reply(`“${normalizeName(nameParts.join(' '))}” topilmadi. Sinf va to‘liq ismni tekshiring.`);
}
