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

// Handle /start command (works anytime, not restricted by active hours)
bot.command('start', async (ctx) => {
    try {
        console.log('/start command received from chat:', ctx.chat.id);
        
        // Store chat ID from first command
        if (!chatId) {
            chatId = ctx.chat.id;
            console.log(`Chat ID set to: ${chatId}`);
            // Initialize scheduler now that we have chat ID
            initScheduler(bot, chatId);
        }
        
        const welcomeMessage = `👋 Assalomu alaykum! LSL Davomad Botiga xush kelibsiz!

📋 Bot haqida:
Bu bot maktab davomadini avtomatik ravishda yig'ish va hisoblash uchun yaratilgan.

📝 Davomad yuborish formati:
<Sinf nomi> <kelganlar soni>/<jami o'quvchilar soni>
<O'quvchi 1>
<O'quvchi 2>
...

Misol:
6A 21/18

Abubakr Valijanov
Alisher Oripov
Bekzod Qodirov

⏰ Faol vaqt: 08:00 - 16:00 (Toshkent vaqti)

📊 Bot avtomatik ravishda:
• 09:15 da kunlik hisobot yuboradi
• 09:30, 09:45, 10:00 da eslatmalar yuboradi
• 16:00 da kunlik faoliyatni yakunlaydi

✅ Kechikkan o'quvchilar uchun:
<Sinf> <Ism> keldi  - o'quvchi keldi
<Sinf> <Ism> ketdi  - o'quvchi ketdi

Misol: 9A Bobur keldi

Qo'llab-quvvatlash uchun: @rasuljondev`;

        await ctx.reply(welcomeMessage);
        console.log('/start command response sent successfully');
    } catch (error) {
        console.error('Error handling /start command:', error);
        console.error('Error stack:', error.stack);
        try {
            await ctx.reply('Xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.');
        } catch (replyError) {
            console.error('Error sending error message:', replyError);
        }
    }
});

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
        console.log('Webhook received - Update type:', req.body?.update_id, 'Message:', req.body?.message?.text);
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error handling webhook update:', error);
        console.error('Error stack:', error.stack);
        res.status(200).send('OK'); // Still return 200 to Telegram
    }
});

// Test endpoint to verify webhook is accessible
app.get(`/webhook/${config.botToken}`, (req, res) => {
    res.json({ 
        status: 'webhook endpoint active',
        message: 'Telegram will POST updates here',
        webhookUrl: `${config.webhookUrl}/webhook/${config.botToken}`
    });
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
        const webhookUrl = `${config.webhookUrl}/webhook/${config.botToken}`;
        console.log(`Setting webhook to: ${webhookUrl}`);
        
        bot.telegram.setWebhook(webhookUrl)
            .then(() => {
                console.log('Webhook set successfully');
                // Verify webhook info
                return bot.telegram.getWebhookInfo();
            })
            .then((info) => {
                console.log('Webhook info:', JSON.stringify(info, null, 2));
            })
            .catch(err => {
                console.error('Error setting webhook:', err);
                console.error('Error details:', err.response?.data || err.message);
            });
    } else {
        console.log('Webhook URL not provided. Using long-polling mode.');
        // For local development, use long-polling
        bot.launch();
    }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

