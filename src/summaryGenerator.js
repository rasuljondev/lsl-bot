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
            
            // Add absent student names if available
            const presentNames = record.student_names || [];
            const absentCount = record.total_students - record.present_count;
            
            if (absentCount > 0) {
                // Get all students for this class from database
                const allStudents = await getClassStudents(className);
                
                if (allStudents.length > 0 && presentNames.length > 0) {
                    // Find absent students (students not in present list)
                    const absentStudents = allStudents.filter(name => !presentNames.includes(name));
                    
                    // If we have absent student names, show them
                    if (absentStudents.length > 0 && absentStudents.length <= absentCount) {
                        absentStudents.forEach(name => {
                            summaryLines.push(name);
                        });
                    }
                }
            }
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

