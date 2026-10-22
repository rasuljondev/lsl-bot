import { normalizeName } from './studentMatching.js';

export function validateRoster(data, allowedClasses) {
    if (!Array.isArray(data) || !data.length) throw new Error('Roster must be a nonempty array');
    const classes = new Set(), ids = new Set();
    for (const group of data) {
        if (!allowedClasses.includes(group.className) || classes.has(group.className)) throw new Error(`Invalid or duplicate class: ${group.className}`);
        classes.add(group.className);
        if (!Array.isArray(group.students) || !group.students.length || group.students.length > 60) throw new Error(`Class ${group.className} must have 1–60 students`);
        for (const s of group.students) {
            if (typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || ids.has(s.id)) throw new Error(`Invalid or duplicate student ID: ${s.id}`);
            ids.add(s.id);
            if (typeof s.fullName !== 'string' || s.fullName.trim().length > 100 || normalizeName(s.fullName).split(' ').length < 2) throw new Error(`Full name required for ${s.id}`);
            if (s.aliases !== undefined && (!Array.isArray(s.aliases) || s.aliases.length > 10 || s.aliases.some(a => typeof a !== 'string' || !normalizeName(a) || a.length > 100))) throw new Error(`Invalid aliases for ${s.id}`);
        }
    }
    return data;
}

// This is an explicit complete roster replacement for each supplied class.
// Students omitted from that class become inactive; their history stays intact.
export async function importRoster(db, data, today) {
    const classes = data.map(g => g.className).sort();
    for (const name of classes) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`roster:${name}`]);
    const incoming = new Map(data.flatMap(g => g.students.map(s => [s.id, g.className])));
    for (const [externalId, className] of incoming) {
        const old = (await db.query('SELECT class_name FROM roster_students WHERE external_id=$1', [externalId])).rows[0];
        if (old && old.class_name !== className && !classes.includes(old.class_name)) {
            throw new Error(`Transfer ${externalId}: include both old class ${old.class_name} and new class ${className}`);
        }
    }
    // Avoid changing the population underneath an existing individual daily report.
    const recorded = await db.query('SELECT 1 FROM student_attendance WHERE date=$1 AND class_name=ANY($2::text[]) LIMIT 1', [today, classes]);
    if (recorded.rowCount) throw new Error('These classes already have individual attendance today. Import on a day without individual attendance.');
    for (const group of data) {
        await db.query(`INSERT INTO class_rosters (class_name) VALUES ($1)
            ON CONFLICT (class_name) DO UPDATE SET version=class_rosters.version+1,updated_at=now()`, [group.className]);
    }
    // Deactivate first, then upsert all supplied students, so transfers are order-independent.
    await db.query('UPDATE roster_students SET active=false WHERE class_name=ANY($1::text[])', [classes]);
    for (const group of data) {
        for (const s of group.students) {
            await db.query(`INSERT INTO roster_students (external_id,class_name,full_name,aliases) VALUES ($1,$2,$3,$4::jsonb)
                ON CONFLICT (external_id) DO UPDATE SET class_name=EXCLUDED.class_name,
                full_name=EXCLUDED.full_name,aliases=EXCLUDED.aliases,active=true`,
            [s.id, group.className, s.fullName.trim(), JSON.stringify(s.aliases || [])]);
        }
        await db.query('UPDATE classes SET total_students=$2 WHERE class_name=$1', [group.className, group.students.length]);
        await db.query("UPDATE attendance_pending SET state='cancelled' WHERE class_name=$1 AND state='open'", [group.className]);
    }
}
