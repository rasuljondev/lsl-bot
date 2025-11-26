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
    try {
        console.log('Message received:', ctx.message.text, 'from chat:', ctx.chat.id);
        
        // Store chat ID from first message
        if (!chatId) {
            chatId = ctx.chat.id;
            console.log(`Chat ID set to: ${chatId}`);
            // Initialize scheduler now that we have chat ID
            initScheduler(bot, chatId);
        }
        
        const messageText = ctx.message.text;
        
        if (!messageText) {
            console.log('Message has no text, ignoring');
            return;
        }
        
        // Check if within active hours (08:00 - 16:00)
        if (!isWithinActiveHours()) {
            const time = getTashkentTime();
            const { start, end } = config.activeHours;
            
            console.log(`Outside active hours. Current time: ${time.hour}:${time.minute}, Active: ${start.hour}:${start.minute} - ${end.hour}:${end.minute}`);
            
            // Check if it's exactly end of day time
            if (time.hour === end.hour && time.minute === end.minute) {
                // End of day message will be sent by scheduler
                return;
            }
            
            // Ignore messages outside active hours
            return;
        }
        
        console.log('Processing message within active hours');
    
        // Try to parse as attendance message first
        // Check if it's an update (existing record) or new submission
        const attendanceProcessed = await updateAttendanceMessage(messageText, ctx.chat.id, bot);
        if (attendanceProcessed) {
            console.log('Attendance message processed successfully');
            return;
        }
        
        // Try to parse as late update (keldi/ketdi)
        // Only process after summary time (09:15) and until 16:00
        const time = getTashkentTime();
        const summaryHour = config.summaryTime.hour;
        const summaryMinute = config.summaryTime.minute;
        const endHour = config.endOfDayTime.hour;
        
        const afterSummary = (time.hour > summaryHour) || (time.hour === summaryHour && time.minute >= summaryMinute);
        const beforeEndOfDay = time.hour < endHour;
        
        if (afterSummary && beforeEndOfDay) {
            console.log('Checking for late update...');
            const lateUpdateProcessed = await processLateUpdate(messageText, ctx.chat.id, bot);
            if (lateUpdateProcessed) {
                console.log('Late update processed successfully');
                return;
            }
        }
        
        // If message doesn't match any pattern, ignore it
        console.log('Message did not match any pattern, ignoring');
    } catch (error) {
        console.error('Error processing message:', error);
    }
});

// Webhook endpoint for Render
app.post(`/webhook/${config.botToken}`, async (req, res) => {
    try {
        console.log('Webhook received:', JSON.stringify(req.body, null, 2));
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error handling webhook update:', error);
        res.status(200).send('OK'); // Still return 200 to Telegram
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start server
// Bind to 0.0.0.0 so Render can detect the port
const PORT = config.port || process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
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

