import { upsertAttendance, getClassTotalStudents, getTodayAttendance } from './database.js';
import { config } from './config.js';

/**
 * Parse attendance message format: 
 * Single line: <ClassName> <presentCount>/<totalCount> <Student1> <Student2> ...
 * Multi-line: <ClassName> <presentCount>/<totalCount>
 *             <Student1>
 *             <Student2>
 *             ...
 * Example: "9A 30/27 Ali Olimov Bobur Salamov Bek Oripov"
 * Or: "6A 21/18\nAbubakr Valijanov\nAlisher Oripov\nBekzod Qodirov"
 */
export function parseAttendanceMessage(text) {
    // Trim and normalize line breaks
    text = text.trim();
    
    // Split into lines
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
        return null;
    }
    
    // First line should contain class name and numbers
    const firstLine = lines[0];
    const pattern = /^([A-Z0-9]+)\s+(\d+)\/(\d+)(?:\s+(.+))?$/i;
    const match = firstLine.match(pattern);
    
    if (!match) {
        return null;
    }
    
    const className = match[1].toUpperCase();
    // Format is: <class> <total>/<present>
    const totalCount = parseInt(match[2], 10);
    const presentCount = parseInt(match[3], 10);
    
    // Collect student names
    let studentNames = [];
    
    // If there are names on the first line (single-line format)
    if (match[4]) {
        studentNames = match[4]
            .trim()
            .split(/\s+/)
            .filter(name => name.length > 0);
    }
    
    // If there are additional lines (multi-line format), add those names
    // Skip first line as it's already processed
    for (let i = 1; i < lines.length; i++) {
        const name = lines[i].trim();
        if (name.length > 0) {
            studentNames.push(name);
        }
    }
    
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
        `✅ ${parsed.className} davomad qabul qilindi: ${totalStudents}/${parsed.presentCount}`
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
            `✅ ${parsed.className} yangilandi: ${totalStudents}/${parsed.presentCount}`
        );
        
        return true;
    }
    
    // If no existing record, process as new
    return await processAttendanceMessage(text, chatId, bot);
}

