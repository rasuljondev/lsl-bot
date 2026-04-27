import { getTodayAttendance, upsertAttendance } from './database.js';
import { config } from './config.js';
import { notifyOnAttendanceUpdate } from './notifications.js';
import { storeStudentNames } from './students.js';

/**
 * Parse late update message: <ClassName> <StudentName> keldi/ketdi
 * Example: "9A Jobirxon keldi" or "9A Bilolxon Oripov keldi" or "9A Jobirxon ketdi"
 */
export function parseLateUpdate(text) {
    const normalized = text.trim().replace(/\s+/g, ' ');
    console.log('Parsing late update:', normalized);

    const pattern = /^([A-Z0-9]+)\s+(.+)\s+(keldi|ketdi)$/i;
    const match = normalized.match(pattern);

    if (!match) {
        console.log('Late update parse failed for:', normalized);
        console.log('Pattern expected: <ClassName> <StudentName> keldi/ketdi');
        return null;
    }

    const className = match[1].toUpperCase();
    const studentName = match[2].trim().replace(/\s+/g, ' ');
    const action = match[3].toLowerCase();

    console.log('Late update parsed:', { className, studentName, action });

    return { className, studentName, action };
}

/**
 * Process late update.
 * keldi (arrived) = +1, ketdi (left) = -1. Count is adjusted unconditionally
 * and clamped to [0, total]. Name list is kept in sync with case-insensitive
 * matching so duplicates don't pile up, but the count does NOT depend on
 * whether the name was previously in the list.
 */
export async function processLateUpdate(text, chatId, bot) {
    const parsed = parseLateUpdate(text);
    if (!parsed) {
        return false;
    }

    if (!config.classes.includes(parsed.className)) {
        return false;
    }

    const attendance = await getTodayAttendance(parsed.className);
    if (!attendance) {
        return false;
    }

    const totalStudents = attendance.total_students || 0;
    const oldCount = attendance.present_count || 0;
    const existingNames = Array.isArray(attendance.student_names)
        ? attendance.student_names
        : [];

    const newNameKey = parsed.studentName.toLowerCase();
    const existingIndex = existingNames.findIndex(
        (n) => typeof n === 'string' && n.trim().toLowerCase() === newNameKey
    );

    let newCount;
    let updatedNames;

    if (parsed.action === 'keldi') {
        newCount = totalStudents > 0
            ? Math.min(totalStudents, oldCount + 1)
            : oldCount + 1;
        updatedNames = existingIndex === -1
            ? [...existingNames, parsed.studentName]
            : existingNames;
        if (existingIndex === -1) {
            await storeStudentNames(parsed.className, [parsed.studentName]);
        }
    } else {
        newCount = Math.max(0, oldCount - 1);
        updatedNames = existingIndex !== -1
            ? existingNames.filter((_, i) => i !== existingIndex)
            : existingNames;
    }

    await upsertAttendance(
        parsed.className,
        newCount,
        totalStudents,
        updatedNames
    );

    const delta = newCount - oldCount;
    const sign = delta > 0 ? '+1' : delta < 0 ? '-1' : '±0';
    const message = `✅ ${parsed.className}: ${parsed.studentName} ${parsed.action} (${sign}) → ${totalStudents}/${newCount}`;

    await bot.telegram.sendMessage(chatId, message);

    await notifyOnAttendanceUpdate(
        bot,
        parsed.className,
        totalStudents,
        newCount,
        true
    );

    return true;
}
