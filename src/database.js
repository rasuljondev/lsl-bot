import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// Return DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings instead of JS Date
// objects, matching how the previous Supabase/PostgREST layer behaved.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
});

/**
 * Run a parameterized query and return all rows.
 */
export async function query(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows;
}

/**
 * Run a parameterized query and return the first row (or null).
 */
export async function queryOne(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows[0] || null;
}

/**
 * Get today's date in Asia/Tashkent timezone
 */
export function getTodayDate() {
    const now = new Date();
    const tashkentDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
    const year = tashkentDate.getFullYear();
    const month = String(tashkentDate.getMonth() + 1).padStart(2, '0');
    const day = String(tashkentDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get current time in Asia/Tashkent timezone
 */
export function getTashkentTime() {
    const now = new Date();
    const tashkentTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
    return {
        hour: tashkentTime.getHours(),
        minute: tashkentTime.getMinutes(),
        second: tashkentTime.getSeconds()
    };
}

/**
 * Check if current time is within active hours (08:00 - 16:00)
 */
export function isWithinActiveHours() {
    const time = getTashkentTime();
    const { start, end } = config.activeHours;

    const currentMinutes = time.hour * 60 + time.minute;
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Get class total students from database
 */
export async function getClassTotalStudents(className) {
    try {
        const row = await queryOne(
            'SELECT total_students FROM classes WHERE class_name = $1',
            [className]
        );
        return row ? row.total_students : null;
    } catch (error) {
        console.error('Error getting class total students:', error);
        return null;
    }
}

/**
 * Upsert attendance record
 */
export async function upsertAttendance(className, presentCount, totalStudents, studentNames) {
    const date = getTodayDate();

    try {
        const row = await queryOne(
            `INSERT INTO attendance_logs (class_name, present_count, total_students, student_names, date, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, now())
             ON CONFLICT (class_name, date) DO UPDATE SET
                present_count = EXCLUDED.present_count,
                total_students = EXCLUDED.total_students,
                student_names = EXCLUDED.student_names,
                updated_at = now()
             RETURNING *`,
            [className, presentCount, totalStudents, JSON.stringify(studentNames || []), date]
        );
        return row;
    } catch (error) {
        console.error('Error upserting attendance:', error);
        throw error;
    }
}

/**
 * Get today's attendance for a specific class
 */
export async function getTodayAttendance(className) {
    const date = getTodayDate();

    try {
        return await queryOne(
            'SELECT * FROM attendance_logs WHERE class_name = $1 AND date = $2',
            [className, date]
        );
    } catch (error) {
        console.error('Error getting attendance:', error);
        throw error;
    }
}

/**
 * Get all attendance records for today
 */
export async function getAllTodayAttendance() {
    const date = getTodayDate();

    try {
        return await query(
            'SELECT * FROM attendance_logs WHERE date = $1',
            [date]
        );
    } catch (error) {
        console.error('Error getting all attendance:', error);
        throw error;
    }
}

/**
 * Get classes that haven't submitted attendance today
 */
export async function getMissingClasses() {
    const date = getTodayDate();

    try {
        const rows = await query(
            'SELECT class_name FROM attendance_logs WHERE date = $1',
            [date]
        );
        const submittedClasses = new Set(rows.map(record => record.class_name));
        return config.classes.filter(className => !submittedClasses.has(className));
    } catch (error) {
        console.error('Error getting missing classes:', error);
        throw error;
    }
}

/**
 * Calculate totals from all attendance records
 */
export async function calculateTotals() {
    const records = await getAllTodayAttendance();

    let totalPresent = 0;
    let totalStudents = 0;

    records.forEach(record => {
        totalPresent += record.present_count || 0;
        totalStudents += record.total_students || 0;
    });

    const totalAbsent = totalStudents - totalPresent;

    return {
        totalPresent,
        totalStudents,
        totalAbsent,
        records
    };
}

/**
 * Get daily total for a specific date
 */
export async function getDailyTotal(date) {
    try {
        const row = await queryOne(
            'SELECT total_students FROM daily_totals WHERE date = $1',
            [date]
        );
        return row ? row.total_students : null;
    } catch (error) {
        console.error('Error getting daily total:', error);
        return null;
    }
}

/**
 * Mark a date as a day off. On a day off the bot records no attendance and
 * sends no reminders or summaries.
 */
export async function setDayOff(date, setBy) {
    await pool.query(
        `INSERT INTO days_off (date, set_by)
         VALUES ($1, $2)
         ON CONFLICT (date) DO UPDATE SET set_by = EXCLUDED.set_by`,
        [date, setBy]
    );
}

/**
 * Remove the day-off mark from a date. Returns true if a row was removed.
 */
export async function clearDayOff(date) {
    const result = await pool.query('DELETE FROM days_off WHERE date = $1', [date]);
    return result.rowCount > 0;
}

/**
 * Whether a 'YYYY-MM-DD' date falls on a Sunday.
 */
export function isSunday(date = getTodayDate()) {
    return new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
}

/**
 * Check whether a date (default: today, Tashkent) is a day off.
 * Sundays are always off; other dates are off only if listed in days_off.
 */
export async function isDayOff(date = getTodayDate()) {
    if (isSunday(date)) {
        return true;
    }
    try {
        const row = await queryOne('SELECT 1 FROM days_off WHERE date = $1', [date]);
        return !!row;
    } catch (error) {
        console.error('Error checking day off:', error);
        return false;
    }
}

/**
 * List day-off dates from `fromDate` (inclusive, default today) onward.
 */
export async function getUpcomingDaysOff(fromDate = getTodayDate()) {
    try {
        const rows = await query(
            'SELECT date FROM days_off WHERE date >= $1 ORDER BY date ASC',
            [fromDate]
        );
        return rows.map(r => r.date);
    } catch (error) {
        console.error('Error listing days off:', error);
        return [];
    }
}

/**
 * Update daily total for a specific date
 */
export async function updateDailyTotal(date, total) {
    try {
        const row = await queryOne(
            `INSERT INTO daily_totals (date, total_students, calculated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (date) DO UPDATE SET
                total_students = EXCLUDED.total_students,
                calculated_at = now()
             RETURNING *`,
            [date, total]
        );
        return row;
    } catch (error) {
        console.error('Error updating daily total:', error);
        throw error;
    }
}

/**
 * Get dynamic total for today or calculate from yesterday
 * Today: Use 323 (hardcoded) unless yesterday had a full set of submissions
 */
export async function getDynamicTotal() {
    const today = getTodayDate();
    const todayDate = new Date(today);

    const todayTotal = await getDailyTotal(today);
    if (todayTotal !== null) {
        return todayTotal;
    }

    // First time today - check if we should use yesterday's total
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    try {
        const yesterdayRecords = await query(
            'SELECT class_name, total_students FROM attendance_logs WHERE date = $1',
            [yesterdayStr]
        );

        const submittedClasses = new Set(yesterdayRecords.map(r => r.class_name));
        const allSubmitted = config.classes.every(className => submittedClasses.has(className));

        if (allSubmitted && yesterdayRecords.length > 0) {
            const yesterdayTotal = yesterdayRecords.reduce((sum, record) => sum + (record.total_students || 0), 0);
            if (yesterdayTotal > 0) {
                await updateDailyTotal(today, yesterdayTotal);
                return yesterdayTotal;
            }
        }
    } catch (error) {
        console.error('Error checking yesterday records:', error);
    }

    // Default: use 323 for today
    await updateDailyTotal(today, 323);
    return 323;
}
