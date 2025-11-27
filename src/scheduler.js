import cron from 'node-cron';
import { sendReminder } from './reminders.js';
import { sendDailySummary } from './summary.js';
import { config } from './config.js';

let botInstance = null;
let chatId = null;
let initialized = false;

/**
 * Initialize scheduler with bot instance and chat ID
 */
export function initScheduler(bot, targetChatId) {
    // Prevent multiple initializations
    if (initialized) {
        return;
    }
    
    botInstance = bot;
    chatId = targetChatId;
    initialized = true;
    
    // Schedule reminders at 09:30, 09:45, 10:00 (Asia/Tashkent time)
    config.reminderTimes.forEach(({ hour, minute }) => {
        const cronExpression = `${minute} ${hour} * * *`;
        cron.schedule(cronExpression, async () => {
            console.log(`Reminder scheduled at ${hour}:${minute}`);
            await sendReminder(chatId, botInstance);
        }, {
            timezone: config.timezone
        });
    });
    
    // Schedule daily summaries at multiple times: 09:15, 10:10, 11:05, 12:00
    config.summaryTimes.forEach(({ hour, minute }) => {
        const summaryCron = `${minute} ${hour} * * *`;
        cron.schedule(summaryCron, async () => {
            console.log(`Daily summary scheduled at ${hour}:${minute}`);
            await sendDailySummary(chatId, botInstance);
        }, {
            timezone: config.timezone
        });
    });
    
    // Schedule end of day message at 13:00
    const endOfDayCron = `${config.endOfDayTime.minute} ${config.endOfDayTime.hour} * * *`;
    cron.schedule(endOfDayCron, async () => {
        console.log(`End of day message scheduled at ${config.endOfDayTime.hour}:${config.endOfDayTime.minute}`);
        await botInstance.telegram.sendMessage(chatId, 'Bot kunlik faoliyatini yakunladi');
    }, {
        timezone: config.timezone
    });
    
    console.log('Scheduler initialized with Asia/Tashkent timezone');
}

