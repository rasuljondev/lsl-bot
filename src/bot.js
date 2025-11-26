import { Telegraf } from 'telegraf';
import express from 'express';
import { config } from './config.js';
import { isWithinActiveHours, getTashkentTime } from './database.js';
import { updateAttendanceMessage } from './attendance.js';
import { processLateUpdate } from './lateUpdates.js';
import { initScheduler } from './scheduler.js';

const bot = new Telegraf(config.botToken);
const app = express();

// Middleware to parse JSON
app.use(express.json());

// Store chat ID (will be set from first message)
let chatId = null;

// Handle incoming messages
bot.on('message', async (ctx) => {
    // Store chat ID from first message
    if (!chatId) {
        chatId = ctx.chat.id;
        console.log(`Chat ID set to: ${chatId}`);
        // Initialize scheduler now that we have chat ID
        initScheduler(bot, chatId);
    }
    
    const messageText = ctx.message.text;
    
    if (!messageText) {
        return;
    }
    
    // Check if within active hours (13:00 - 16:00)
    if (!isWithinActiveHours()) {
        const time = getTashkentTime();
        const { start, end } = config.activeHours;
        
        // Check if it's exactly end of day time
        if (time.hour === end.hour && time.minute === end.minute) {
            // End of day message will be sent by scheduler
            return;
        }
        
        // Ignore messages outside active hours
        return;
    }
    
    // Try to parse as attendance message first
    // Check if it's an update (existing record) or new submission
    const attendanceProcessed = await updateAttendanceMessage(messageText, ctx.chat.id, bot);
    if (attendanceProcessed) {
        return;
    }
    
    // Try to parse as late update (keldi/ketdi)
    // Only process after summary time (14:15) and until 16:00
    const time = getTashkentTime();
    const summaryHour = config.summaryTime.hour;
    const summaryMinute = config.summaryTime.minute;
    const endHour = config.endOfDayTime.hour;
    
    const afterSummary = (time.hour > summaryHour) || (time.hour === summaryHour && time.minute >= summaryMinute);
    const beforeEndOfDay = time.hour < endHour;
    
    if (afterSummary && beforeEndOfDay) {
        const lateUpdateProcessed = await processLateUpdate(messageText, ctx.chat.id, bot);
        if (lateUpdateProcessed) {
            return;
        }
    }
    
    // If message doesn't match any pattern, ignore it
});

// Webhook endpoint for Render
app.post(`/webhook/${config.botToken}`, (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Webhook URL: /webhook/${config.botToken}`);
    
    // If webhook URL is provided, set it up
    if (config.webhookUrl) {
        bot.telegram.setWebhook(`${config.webhookUrl}/webhook/${config.botToken}`)
            .then(() => console.log('Webhook set successfully'))
            .catch(err => console.error('Error setting webhook:', err));
    } else {
        console.log('Webhook URL not provided. Using long-polling mode.');
        // For local development, use long-polling
        bot.launch();
    }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

