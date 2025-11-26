import { getAllAuthorizedUsers } from './permissions.js';

/**
 * Send notification to all authorized users
 */
export async function notifyAuthorizedUsers(message) {
    try {
        const authorizedUsers = await getAllAuthorizedUsers();
        
        if (authorizedUsers.length === 0) {
            return;
        }
        
        // Send to all authorized users
        const promises = authorizedUsers.map(user => {
            // Use the bot instance from the calling context
            // This will be passed in when called
            return Promise.resolve(user);
        });
        
        return authorizedUsers;
    } catch (error) {
        console.error('Error notifying authorized users:', error);
        return [];
    }
}

/**
 * Notify authorized users about attendance update
 */
export async function notifyOnAttendanceUpdate(bot, className, total, present, isUpdate = false) {
    try {
        const authorizedUsers = await getAllAuthorizedUsers();
        
        if (authorizedUsers.length === 0) {
            return;
        }
        
        const message = isUpdate 
            ? `✅ ${className} yangilandi: ${total}/${present}`
            : `✅ ${className} davomad qabul qilindi: ${total}/${present}`;
        
        // Send to all authorized users
        for (const user of authorizedUsers) {
            try {
                await bot.telegram.sendMessage(user.chat_id, message);
            } catch (error) {
                console.error(`Error sending notification to user ${user.user_id}:`, error);
            }
        }
    } catch (error) {
        console.error('Error notifying on attendance update:', error);
    }
}

/**
 * Notify authorized users about daily summary
 */
export async function notifyOnDailySummary(bot, summaryData) {
    try {
        const authorizedUsers = await getAllAuthorizedUsers();
        
        if (authorizedUsers.length === 0) {
            return;
        }
        
        // Build summary message
        let message = '';
        
        // Add classes with attendance
        if (summaryData.classes && summaryData.classes.length > 0) {
            summaryData.classes.forEach(classData => {
                message += `${classData.className} ${classData.total}/${classData.present}\n`;
            });
        }
        
        // Add missing classes
        if (summaryData.missing && summaryData.missing.length > 0) {
            summaryData.missing.forEach(className => {
                message += `${className} Topshirmadi\n`;
            });
        }
        
        // Add total
        if (summaryData.totalStudents && summaryData.totalPresent !== undefined) {
            message += `\nTopshirilgan ma'lumotlarga ko'ra Jami ${summaryData.totalStudents}/${summaryData.totalPresent}`;
        }
        
        // Send to all authorized users
        for (const user of authorizedUsers) {
            try {
                await bot.telegram.sendMessage(user.chat_id, message);
            } catch (error) {
                console.error(`Error sending summary to user ${user.user_id}:`, error);
            }
        }
    } catch (error) {
        console.error('Error notifying on daily summary:', error);
    }
}

