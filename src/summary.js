import { calculateTotals, getAllTodayAttendance, getDynamicTotal } from './database.js';
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
    
    // Find missing classes (didn't submit)
    const submittedClassNames = new Set(records.map(r => r.class_name));
    const missingClasses = config.classes.filter(className => !submittedClassNames.has(className));
    
    // Use dynamic total
    const dynamicTotal = await getDynamicTotal();
    const totalStudentsForDisplay = dynamicTotal || totals.totalStudents;
    
    // Create ordered summary with all classes
    const recordsMap = new Map();
    records.forEach(record => {
        recordsMap.set(record.class_name, record);
    });
    
    let summaryLines = [];
    let totalPresentCalc = 0;
    let totalStudentsCalc = 0;
    
    // Fixed order: 1A, 1B, 2A, 2B, 3A, 4A, 5A, 5B, 6A, 6B, 7A, 8A, 8B, 9A, 9B, 10A, 10B, 11A
    config.classes.forEach(className => {
        const record = recordsMap.get(className);
        if (record) {
            summaryLines.push(`${className}: ${record.present_count}/${record.total_students}`);
            totalPresentCalc += record.present_count || 0;
            totalStudentsCalc += record.total_students || 0;
        } else {
            summaryLines.push(`${className}: Topshirmadi`);
        }
    });
    
    // Check if all classes submitted
    if (missingClasses.length === 0) {
        // All classes submitted - send completion message with ordered classes
        let completionMessage = `✅ Rahmat! Barcha sinflar davomad yubordi!\n\n` +
            `📊 Bugungi davomad natijalari:\n\n`;
        completionMessage += summaryLines.join('\n');
        completionMessage += `\n\nJami: ${totalStudentsCalc}/${totalPresentCalc}`;
        
        if (absentList.length > 0) {
            completionMessage += `\n\n❌ Kelmaganlar ro'yxati:\n`;
            completionMessage += absentList.join('\n');
        }
        
        completionMessage += `\n\n✅ Barcha sinflar davomad yubordi. Bot bugun ishini yakunladi va ertaga qaytadi.`;
        
        await bot.telegram.sendMessage(chatId, completionMessage);
    } else {
        // Not all classes submitted - send regular summary with ordered classes
        let message = `📊 Bugungi davomad natijalari\n\n`;
        message += summaryLines.join('\n');
        message += `\n\nJami: ${totalStudentsCalc}/${totalPresentCalc}`;
        
        if (absentList.length > 0) {
            message += `\n\n❌ Kelmaganlar ro'yxati:\n`;
            message += absentList.join('\n');
        }
        
        await bot.telegram.sendMessage(chatId, message);
    }
    
    // Build summary for authorized users (different format)
    const submittedClasses = records.map(r => ({
        className: r.class_name,
        total: r.total_students,
        present: r.present_count
    }));
    
    // Send to authorized users (missingClasses already defined above)
    await notifyOnDailySummary(bot, {
        classes: submittedClasses,
        missing: missingClasses,
        totalStudents: totals.totalStudents,
        totalPresent: totals.totalPresent
    });
}

