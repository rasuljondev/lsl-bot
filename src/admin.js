import { config } from './config.js';
import { query, getTodayDate } from './database.js';
import { transaction, lockClass } from './studentAttendance.js';

/**
 * Check if user is owner
 */
export function isOwner(userId) {
    return userId === config.ownerUserId;
}

/**
 * Clean today's attendance data
 */
export async function cleanTodayData(actorId = config.ownerUserId) {
    const date = getTodayDate();

    try {
        if (config.studentAttendanceEnabled) {
            await transaction(async db => {
                for (const name of [...config.classes].sort()) await lockClass(db, name, date);
                await db.query(`INSERT INTO attendance_events
                    (student_id,date,class_name,old_status,new_status,actor_id,chat_id)
                    SELECT student_id,date,class_name,status,NULL,$2,$3 FROM student_attendance WHERE date=$1`,
                [date, actorId, config.allowedGroupId]);
                await db.query('DELETE FROM student_attendance WHERE date=$1', [date]);
                await db.query("UPDATE attendance_pending SET state='cancelled' WHERE date=$1 AND state='open'", [date]);
                await db.query('DELETE FROM attendance_logs WHERE date=$1', [date]);
            });
        } else await query('DELETE FROM attendance_logs WHERE date = $1', [date]);
        return { success: true, message: 'Today\'s data cleaned successfully' };
    } catch (error) {
        console.error('Error cleaning today data:', error);
        return { success: false, message: 'Failed to clean data' };
    }
}

/**
 * Generate daily report
 */
export async function generateDailyReport(date = null) {
    const reportDate = date || getTodayDate();

    let records;
    try {
        records = await query(
            'SELECT * FROM attendance_logs WHERE date = $1',
            [reportDate]
        );
    } catch (error) {
        console.error('Error generating daily report:', error);
        return { success: false, message: 'Failed to generate report' };
    }

    // Map submitted records by class for quick lookup
    const recordsMap = new Map((records || []).map(r => [r.class_name, r]));

    let totalStudents = 0;
    let totalPresent = 0;
    const lines = [];

    // Always list every class in the fixed config order
    for (const className of config.classes) {
        const record = recordsMap.get(className);
        if (record) {
            lines.push(`${className}: ${record.total_students}/${record.present_count}`);
            totalStudents += record.total_students || 0;
            totalPresent += record.present_count || 0;
        } else {
            lines.push(`${className}: Topshirmadi`);
        }
    }

    const missing = config.classes.filter(className => !recordsMap.has(className));
    const totalAbsent = totalStudents - totalPresent;

    let report = `📊 Kunlik hisobot (${reportDate})\n\n`;
    report += lines.join('\n');
    report += `\n\nJami: ${totalStudents}/${totalPresent}`;

    if (totalAbsent > 0) {
        report += `\nKelmaganlar: ${totalAbsent}`;
    }

    if (missing.length > 0) {
        report += `\n\n📋 Topshirmagan sinflar: ${missing.join(', ')}`;
    } else {
        report += `\n\n✅ Barcha sinflar davomat yubordi.`;
    }

    return { success: true, report };
}

/**
 * Generate weekly report
 */
export async function generateWeeklyReport(startDate, endDate) {
    let records;
    try {
        records = await query(
            `SELECT * FROM attendance_logs
             WHERE date >= $1 AND date <= $2
             ORDER BY date ASC`,
            [startDate, endDate]
        );
    } catch (error) {
        console.error('Error generating weekly report:', error);
        return { success: false, message: 'Failed to generate report' };
    }

    // Group by date and calculate averages
    const dateMap = new Map();

    records.forEach(record => {
        const key = record.date instanceof Date
            ? record.date.toISOString().split('T')[0]
            : String(record.date);
        if (!dateMap.has(key)) {
            dateMap.set(key, { total: 0, present: 0, count: 0 });
        }
        const day = dateMap.get(key);
        day.total += record.total_students;
        day.present += record.present_count;
        day.count += 1;
    });

    let report = `📊 Haftalik hisobot (${startDate} - ${endDate})\n\n`;

    let totalDays = 0;
    let totalStudents = 0;
    let totalPresent = 0;

    dateMap.forEach((day, date) => {
        // Format: total/present
        const dayAbsent = day.total - day.present;
        report += `${date}: ${day.total}/${day.present}`;
        if (dayAbsent > 0) {
            report += ` (Kelmaganlar: ${dayAbsent})`;
        }
        report += `\n`;
        totalDays += 1;
        totalStudents += day.total;
        totalPresent += day.present;
    });

    if (totalDays > 0) {
        const avgPresent = Math.round(totalPresent / totalDays);
        const avgTotal = Math.round(totalStudents / totalDays);
        const totalAbsent = totalStudents - totalPresent;
        report += `\nO'rtacha: ${avgTotal}/${avgPresent}`;
        report += `\nJami: ${totalStudents}/${totalPresent}`;
        if (totalAbsent > 0) {
            report += `\nKelmaganlar: ${totalAbsent}`;
        }
    }

    return { success: true, report };
}

/**
 * Generate monthly report
 */
export async function generateMonthlyReport(month, year) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    // Get last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const result = await generateWeeklyReport(startDate, endDate);

    // Update title for monthly report
    if (result.success) {
        result.report = result.report.replace('📊 Haftalik hisobot', '📊 Oylik hisobot');
    }

    return result;
}
