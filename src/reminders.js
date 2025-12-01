import { getMissingClasses } from './database.js';
import { config } from './config.js';

/**
 * Send reminder about missing classes
 */
export async function sendReminder(chatId, bot) {
    const missingClasses = await getMissingClasses();
    
    if (missingClasses.length === 0) {
        // All classes have submitted attendance
        return;
    }
    
    const classList = missingClasses.join(', ');
    const message = `⏰ Eslatma: Quyidagi sinflar hali davomat yubormadi:\n${classList}`;
    
    await bot.telegram.sendMessage(chatId, message);
}

