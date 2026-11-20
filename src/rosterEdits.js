import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getTodayDate } from './database.js';
import { transaction, lockClass } from './studentAttendance.js';
import { normalizeName } from './studentMatching.js';

const MAX_NAME_LENGTH = 100;
const MAX_ALIASES = 10;

/** A user-facing validation problem; its message is safe to show in Telegram. */
export class RosterEditError extends Error {}

function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Validate typed input and return the display form, e.g. "karimov  ali" -> "Karimov Ali". */
export function cleanStudentName(input) {
    const name = String(input ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > MAX_NAME_LENGTH) {
        throw new RosterEditError(`Ism 1–${MAX_NAME_LENGTH} belgidan iborat bo‘lishi kerak.`);
    }
    if (/\d/.test(name)) throw new RosterEditError('Ismda raqam bo‘lmasligi kerak.');
    if (normalizeName(name).split(' ').filter(Boolean).length < 2) {
        throw new RosterEditError('Familiya va ismni to‘liq yozing. Namuna: Karimov Ali');
    }
    return name.split(' ').map(capitalize).join(' ');
}

async function activeInClass(db, className) {
    const { rows } = await db.query(
        'SELECT id, full_name FROM roster_students WHERE class_name=$1 AND active ORDER BY id', [className]);
    return rows;
}

function assertNameFree(rows, fullName, exceptId = null) {
    const key = normalizeName(fullName);
    const clash = rows.find(s => s.id !== exceptId && normalizeName(s.full_name) === key);
    if (clash) throw new RosterEditError(`${clash.full_name} bu sinfda allaqachon bor.`);
}

// Bumping the version makes any open name-clarification ask the teacher to resend,
// and the class total must always equal the active roster (checked at startup).
async function touchRoster(db, className) {
    await db.query('UPDATE class_rosters SET version=version+1, updated_at=now() WHERE class_name=$1', [className]);
    await db.query(`UPDATE classes SET total_students=(SELECT count(*) FROM roster_students
        WHERE class_name=$1 AND active) WHERE class_name=$1`, [className]);
}

async function logChange(db, { actorId, className, studentId, action, oldName = null, newName = null }) {
    await db.query(`INSERT INTO roster_changes (actor_id, class_name, student_id, action, old_name, new_name)
        VALUES ($1, $2, $3, $4, $5, $6)`, [actorId, className, studentId, action, oldName, newName]);
}

async function lockedStudent(db, studentId) {
    const found = (await db.query('SELECT class_name FROM roster_students WHERE id=$1', [studentId])).rows[0];
    if (!found) throw new RosterEditError('O‘quvchi topilmadi.');
    await lockClass(db, found.class_name, getTodayDate());
    const student = (await db.query('SELECT * FROM roster_students WHERE id=$1', [studentId])).rows[0];
    if (!student.active) throw new RosterEditError('Bu o‘quvchi allaqachon ro‘yxatdan chiqarilgan.');
    return student;
}

/** Add a student; a previously removed student with the same name is restored with their history. */
export async function addStudent({ className, name, actorId }) {
    if (!config.classes.includes(className)) throw new RosterEditError('Sinf topilmadi.');
    const fullName = cleanStudentName(name);
    return transaction(async db => {
        await lockClass(db, className, getTodayDate());
        assertNameFree(await activeInClass(db, className), fullName);
        await db.query('INSERT INTO class_rosters (class_name) VALUES ($1) ON CONFLICT DO NOTHING', [className]);
        const { rows: inactive } = await db.query(
            'SELECT id, full_name FROM roster_students WHERE class_name=$1 AND NOT active ORDER BY id DESC', [className]);
        const previous = inactive.find(s => normalizeName(s.full_name) === normalizeName(fullName));
        let studentId;
        if (previous) {
            await db.query('UPDATE roster_students SET active=true, full_name=$2 WHERE id=$1', [previous.id, fullName]);
            studentId = previous.id;
        } else {
            const externalId = `bot-${randomUUID().replace(/-/g, '')}`;
            studentId = (await db.query(`INSERT INTO roster_students (external_id, class_name, full_name, aliases)
                VALUES ($1, $2, $3, '[]'::jsonb) RETURNING id`, [externalId, className, fullName])).rows[0].id;
        }
        await touchRoster(db, className);
        await logChange(db, { actorId, className, studentId, action: previous ? 'reactivate' : 'add', newName: fullName });
        return { id: studentId, full_name: fullName, class_name: className, reactivated: Boolean(previous) };
    });
}

/** Mark a student inactive; attendance history is kept. */
export async function removeStudent({ studentId, actorId }) {
    return transaction(async db => {
        const student = await lockedStudent(db, studentId);
        if ((await activeInClass(db, student.class_name)).length <= 1) {
            throw new RosterEditError('Sinfdagi oxirgi o‘quvchini chiqarib bo‘lmaydi.');
        }
        await db.query('UPDATE roster_students SET active=false WHERE id=$1', [student.id]);
        await touchRoster(db, student.class_name);
        await logChange(db, { actorId, className: student.class_name, studentId: student.id,
            action: 'remove', oldName: student.full_name });
        return { id: student.id, full_name: student.full_name, class_name: student.class_name };
    });
}

/** Rename a student; the old spelling stays as an alias so teachers can still type it. */
export async function renameStudent({ studentId, name, actorId }) {
    const fullName = cleanStudentName(name);
    return transaction(async db => {
        const student = await lockedStudent(db, studentId);
        assertNameFree(await activeInClass(db, student.class_name), fullName, student.id);
        const newKey = normalizeName(fullName);
        const aliases = [...new Set([...(student.aliases || []), student.full_name])]
            .filter(alias => normalizeName(alias) !== newKey)
            .slice(-MAX_ALIASES);
        await db.query('UPDATE roster_students SET full_name=$2, aliases=$3::jsonb WHERE id=$1',
            [student.id, fullName, JSON.stringify(aliases)]);
        await touchRoster(db, student.class_name);
        await logChange(db, { actorId, className: student.class_name, studentId: student.id,
            action: 'rename', oldName: student.full_name, newName: fullName });
        return { id: student.id, full_name: fullName, old_name: student.full_name, class_name: student.class_name };
    });
}
