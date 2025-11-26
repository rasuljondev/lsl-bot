import { calculateTotals, getAllTodayAttendance } from './database.js';
import { notifyOnDailySummary } from './notifications.js';
import { config } from './config.js';

/**
 * Generate and send daily summary at 09:15
 */
export async function sendDailySummary(chatId, bot) {
    const totals = await calculateTotals();
    const records = await getAllTodayAttendance();
    
    // Build absent students list
    let absentList = [];
    
    records.forEach(record => {
        const presentStudents = record.student_names || [];
        const totalStudents = record.total_students || 0;
        const presentCount = record.present_count || 0;
        const absentCount = totalStudents - presentCount;
        
        // If we have student names, we can identify absentees
        // Otherwise, we just show the count
        if (presentStudents.length > 0 && absentCount > 0) {
            // Note: We don't have the full roster, so we can't list absentees by name
            // We'll just show the class and absent count
            absentList.push(`${record.class_name}: ${absentCount} ta o'quvchi kelmadi`);
        } else if (absentCount > 0) {
            absentList.push(`${record.class_name}: ${absentCount} ta o'quvchi kelmadi`);
        }
    });
    
    // Build summary message for group
    let message = `📊 Bugungi davomad natijalari\n\n`;
    message += `Jami: ${totals.totalStudents} ta o'quvchidan ${totals.totalPresent} tasi keldi\n`;
    message += `Qolgan: ${totals.totalAbsent} ta o'quvchi\n`;
    
    if (absentList.length > 0) {
        message += `\n❌ Kelmaganlar ro'yxati:\n`;
        message += absentList.join('\n');
    }
    
    await bot.telegram.sendMessage(chatId, message);
    
    // Build summary for authorized users (different format)
    const submittedClasses = records.map(r => ({
        className: r.class_name,
        total: r.total_students,
        present: r.present_count
    }));
    
    // Find missing classes
    const missingClasses = config.classes.filter(className => 
        !records.some(r => r.class_name === className)
    );
    
    // Send to authorized users
    await notifyOnDailySummary(bot, {
        classes: submittedClasses,
        missing: missingClasses,
        totalStudents: totals.totalStudents,
        totalPresent: totals.totalPresent
    });
}

