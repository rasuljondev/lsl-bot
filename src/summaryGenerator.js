import { getAllTodayAttendance, getDynamicTotal } from './database.js';
import { config } from './config.js';
import { getTodayDate } from './database.js';
import { getClassStudents } from './students.js';

/**
 * Generate full summary with all classes in order
 * Format: All classes in fixed order with their attendance numbers and absent student names
 */
export async function generateFullSummary() {
    const records = await getAllTodayAttendance();
    const dynamicTotal = await getDynamicTotal();
    
    // Create a map of class_name -> record for quick lookup
    const recordsMap = new Map();
    records.forEach(record => {
        recordsMap.set(record.class_name, record);
    });
    
    // Build summary with classes in fixed order
    let summaryLines = [];
    let totalPresent = 0;
    let totalStudents = 0;
    
    // Fixed order: 1A, 1B, 2A, 2B, 3A, 4A, 5A, 5B, 6A, 6B, 7A, 8A, 8B, 9A, 9B, 10A, 10B, 11A
    for (const className of config.classes) {
        const record = recordsMap.get(className);
        if (record) {
            // Format: total/present
            summaryLines.push(`${className}: ${record.total_students}/${record.present_count}`);
            totalPresent += record.present_count || 0;
            totalStudents += record.total_students || 0;
        } else {
            summaryLines.push(`${className}: Topshirmadi`);
        }
    }
    
    const todayFormatted = getTodayDate();
    const totalAbsent = totalStudents - totalPresent;
    
    let summary = `📊 Kunlik hisobot yangilandi (${todayFormatted})\n\n`;
    summary += summaryLines.join('\n');
    summary += `\n\nJami: ${totalStudents}/${totalPresent}`;
    
    if (totalAbsent > 0) {
        summary += `\nKelmaganlar: ${totalAbsent}`;
    }
    
    return summary;
}

