import { upsertAttendance, getClassTotalStudents, getTodayAttendance } from './database.js';
import { config } from './config.js';

/**
 * Parse attendance message format: <ClassName> <presentCount>/<totalCount> <Student1> <Student2> ...
 * Example: "9A 30/27 Ali Olimov Bobur Salamov Bek Oripov"
 */
export function parseAttendanceMessage(text) {
    // Remove extra spaces and trim
    text = text.trim().replace(/\s+/g, ' ');
    
    // Match pattern: class name, numbers, optional student names
    const pattern = /^([A-Z0-9]+)\s+(\d+)\/(\d+)(?:\s+(.+))?$/i;
    const match = text.match(pattern);
    
    if (!match) {
        return null;
    }
    
    const className = match[1].toUpperCase();
    const presentCount = parseInt(match[2], 10);
    const totalCount = parseInt(match[3], 10);
    const studentNamesText = match[4] || '';
    
    // Parse student names (split by spaces, but handle multi-word names)
    // For now, simple split - can be improved if needed
    const studentNames = studentNamesText
        .trim()
        .split(/\s+/)
        .filter(name => name.length > 0);
    
    return {
        className,
        presentCount,
        totalCount,
        studentNames
    };
}

/**
 * Process attendance message
 */
export async function processAttendanceMessage(text, chatId, bot) {
    const parsed = parseAttendanceMessage(text);
    
    if (!parsed) {
        return false;
    }
    
    // Validate class name
    if (!config.classes.includes(parsed.className)) {
        return false;
    }
    
    // Get total students from database, or use the one from message
    let totalStudents = parsed.totalCount;
    const dbTotal = await getClassTotalStudents(parsed.className);
    if (dbTotal && dbTotal > 0) {
        totalStudents = dbTotal;
    }
    
    // Store/update attendance
    await upsertAttendance(
        parsed.className,
        parsed.presentCount,
        totalStudents,
        parsed.studentNames
    );
    
    // Send confirmation
    await bot.telegram.sendMessage(
        chatId,
        `✅ ${parsed.className} davomad qabul qilindi: ${parsed.presentCount}/${totalStudents}`
    );
    
    return true;
}

/**
 * Update attendance when class sends updated message
 */
export async function updateAttendanceMessage(text, chatId, bot) {
    const parsed = parseAttendanceMessage(text);
    
    if (!parsed) {
        return false;
    }
    
    // Get existing record
    const existing = await getTodayAttendance(parsed.className);
    
    if (existing) {
        // Update existing record
        let totalStudents = parsed.totalCount;
        const dbTotal = await getClassTotalStudents(parsed.className);
        if (dbTotal && dbTotal > 0) {
            totalStudents = dbTotal;
        }
        
        await upsertAttendance(
            parsed.className,
            parsed.presentCount,
            totalStudents,
            parsed.studentNames
        );
        
        // Send update confirmation
        await bot.telegram.sendMessage(
            chatId,
            `✅ ${parsed.className} yangilandi: ${parsed.presentCount}/${totalStudents}`
        );
        
        return true;
    }
    
    // If no existing record, process as new
    return await processAttendanceMessage(text, chatId, bot);
}

