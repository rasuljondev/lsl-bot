import { getTodayAttendance, upsertAttendance, calculateTotals } from './database.js';
import { config } from './config.js';
import { notifyOnAttendanceUpdate } from './notifications.js';
import { storeStudentNames } from './students.js';
import { generateFullSummary } from './summaryGenerator.js';

/**
 * Parse late update message: <ClassName> <StudentName> keldi/ketdi
 * Example: "9A Jobirxon keldi" or "9A Bilolxon Oripov keldi" or "9A Jobirxon ketdi"
 */
export function parseLateUpdate(text) {
    text = text.trim().replace(/\s+/g, ' ');
    console.log('Parsing late update:', text);
    
    // Match pattern: class name, student name (can be multiple words), action (keldi/ketdi)
    // Use greedy match for student name to capture multi-word names
    const pattern = /^([A-Z0-9]+)\s+(.+)\s+(keldi|ketdi)$/i;
    const match = text.match(pattern);
    
    if (!match) {
        console.log('Late update parse failed for:', text);
        console.log('Pattern expected: <ClassName> <StudentName> keldi/ketdi');
        return null;
    }
    
    console.log('Late update pattern matched:', match);
    
    const className = match[1].toUpperCase();
    const studentName = match[2].trim();
    const action = match[3].toLowerCase();
    
    console.log('Late update parsed:', { className, studentName, action });
    
    return {
        className,
        studentName,
        action // 'keldi' or 'ketdi'
    };
}

/**
 * Process late update (keldi/ketdi)
 */
export async function processLateUpdate(text, chatId, bot) {
    const parsed = parseLateUpdate(text);
    
    if (!parsed) {
        return false;
    }
    
    // Validate class name
    if (!config.classes.includes(parsed.className)) {
        return false;
    }
    
    // Get today's attendance for this class
    const attendance = await getTodayAttendance(parsed.className);
    
    if (!attendance) {
        // No attendance record found, ignore
        return false;
    }
    
    let presentCount = attendance.present_count || 0;
    let studentNames = attendance.student_names || [];
    
    // Ensure studentNames is an array
    if (!Array.isArray(studentNames)) {
        studentNames = [];
    }
    
    if (parsed.action === 'keldi') {
        // Student came - add to present list
        if (!studentNames.includes(parsed.studentName)) {
            studentNames.push(parsed.studentName);
            presentCount += 1;
            // Store student name in database
            await storeStudentNames(parsed.className, [parsed.studentName]);
        }
    } else if (parsed.action === 'ketdi') {
        // Student left - remove from present list
        const index = studentNames.indexOf(parsed.studentName);
        if (index > -1) {
            studentNames.splice(index, 1);
            presentCount = Math.max(0, presentCount - 1);
        }
    }
    
    // Update attendance record
    await upsertAttendance(
        parsed.className,
        presentCount,
        attendance.total_students,
        studentNames
    );
    
    // Calculate new totals
    const totals = await calculateTotals();
    
    // Send simple confirmation message to group (no full summary)
    // Format: ✅ 10A yangilandi 15/14: Hojiakbar keldi
    const actionText = parsed.action === 'keldi' ? 'keldi' : 'ketdi';
    const message = `✅ ${parsed.className} yangilandi ${attendance.total_students}/${presentCount}: ${parsed.studentName} ${actionText}`;
    
    await bot.telegram.sendMessage(chatId, message);
    
    // Notify authorized users with full info
    await notifyOnAttendanceUpdate(bot, parsed.className, attendance.total_students, presentCount, true);
    
    return true;
}

