const clock = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

export function tashkentClock(instant) {
    const parts = Object.fromEntries(clock.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`,
        minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function arrivalTiming(instant) {
    const time = tashkentClock(instant);
    const lateMinutes = Math.max(0, time.minutes - (8 * 60 + 30));
    return { at: new Date(instant).toISOString(), lateMinutes, late: lateMinutes > 0, time: time.time };
}

export function schoolWindow(date) {
    return { start: Date.parse(`${date}T08:30:00+05:00`), end: Date.parse(`${date}T16:00:00+05:00`) };
}

export function withTiming(old, next, action, instant, date) {
    const at = new Date(instant).toISOString(), window = schoolWindow(date);
    const clamp = value => new Date(Math.min(window.end, Math.max(window.start, Date.parse(value)))).toISOString();
    let intervals = (old?.missing_intervals || []).map(i => ({ ...i }));
    let complete = old?.timing_complete || false;
    const result = { ...next };
    if (action === 'absent') {
        // A full-day absence is known from the school start, irrespective of report time.
        if (old?.status !== 'absent' || !intervals.length) {
            intervals = [{ start: new Date(window.start).toISOString(), end: null }];
            complete = true;
        }
        return { ...result, first_arrival_at: null, last_departure_at: null, late_minutes: null,
            missing_intervals: intervals, timing_complete: complete, last_movement_at: old?.last_movement_at || null };
    }
    if (!old) return { ...result, missing_intervals: [], timing_complete: true };
    const arrival = action === 'keldi' && ['absent', 'left'].includes(old.status);
    const departure = action === 'ketdi' && ['present', 'late'].includes(old.status);
    if (!arrival && !departure) return { ...result, missing_intervals: intervals, timing_complete: complete };
    if (old.last_movement_at && Date.parse(at) < Date.parse(old.last_movement_at)) {
        throw new Error('Bu xabar oxirgi keldi/ketdi xabaridan oldin yuborilgan. Yangi xabar yuboring.');
    }
    if (arrival) {
        if (old.status === 'absent') {
            if (!intervals.length) { intervals = [{ start: new Date(window.start).toISOString(), end: null }]; complete = true; }
            const timing = arrivalTiming(at);
            Object.assign(result, { status: timing.late ? 'late' : 'present', arrived_late: timing.late,
                first_arrival_at: at, late_minutes: timing.lateMinutes });
        }
        intervals = intervals.map(i => i.end ? i : { ...i, end: clamp(at) });
    } else {
        if (!intervals.some(i => !i.end)) intervals.push({ start: clamp(at), end: null });
        result.last_departure_at = at;
    }
    return { ...result, missing_intervals: intervals, timing_complete: complete, last_movement_at: at };
}

export function missedMinutes(record, now = new Date()) {
    const intervals = record.missing_intervals || [];
    if (!record.timing_complete && !intervals.length) return null;
    const date = record.date instanceof Date ? record.date.toISOString().slice(0, 10) : record.date;
    const window = schoolWindow(date);
    const cutoff = Math.min(window.end, Math.max(window.start, new Date(now).getTime()));
    const milliseconds = intervals.reduce((sum, i) => {
        const start = Math.max(window.start, Date.parse(i.start));
        const end = Math.min(window.end, cutoff, i.end ? Date.parse(i.end) : cutoff);
        return sum + Math.max(0, end - start);
    }, 0);
    return Math.min(450, Math.floor(milliseconds / 60_000));
}

export function messageInstant(message, date, now = new Date()) {
    const instant = message?.date ? new Date(message.date * 1000) : now;
    if (!Number.isFinite(instant.getTime()) || tashkentClock(instant).date !== date || instant.getTime() > now.getTime() + 60_000) {
        throw new Error('Xabar vaqti bugungi Toshkent sanasiga mos emas. Davomatni yangi xabarda yuboring.');
    }
    return instant.toISOString();
}
