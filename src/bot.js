import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import { config } from './config.js';
import { isWithinActiveHours, getTashkentTime } from './database.js';
import { updateAttendanceMessage } from './attendance.js';
import { processLateUpdate } from './lateUpdates.js';
import { initScheduler } from './scheduler.js';
import { isGroupAuthorized, isUserAuthorized, requestUserAccess, approveUser, rejectUser } from './permissions.js';
import { isOwner, cleanTodayData, generateDailyReport, generateWeeklyReport, generateMonthlyReport } from './admin.js';

const bot = new Telegraf(config.botToken);
const app = express();

// Middleware to parse JSON
app.use(express.json());

// Store chat ID (will be set from first message)
let chatId = null;

// Handle /start command (works anytime, not restricted by active hours)
bot.command('start', async (ctx) => {
    try {
        const chatType = ctx.chat.type;
        const chatIdReceived = ctx.chat.id;
        const userId = ctx.from.id;
        
        console.log('='.repeat(50));
        console.log('/start command received:');
        console.log(`  Chat Type: ${chatType}`);
        console.log(`  Chat ID: ${chatIdReceived}`);
        console.log(`  Expected Group ID: ${config.allowedGroupId}`);
        console.log(`  User ID: ${userId}`);
        console.log(`  Is Owner: ${isOwner(userId)}`);
        console.log('='.repeat(50));
        
        // Check if it's a group - allow /start in groups for debugging
        if (chatType === 'group' || chatType === 'supergroup') {
            console.log('⚠️ /start received in group - showing group info');
            const match = chatIdReceived === config.allowedGroupId;
            await ctx.reply(
                `📊 Group Info:\n` +
                `Chat ID: ${chatIdReceived}\n` +
                `Expected: ${config.allowedGroupId}\n` +
                `Match: ${match ? '✅' : '❌'}`
            );
            
            if (match) {
                const groupInstructions = `👋 Assalomu alaykum, o'qituvchilar!\n\n` +
                    `🕗 Bot faqat 08:00 - 16:00 orasida ma'lumot qabul qiladi.\n` +
                    `📝 Format:\n` +
                    `<Sinf> <jami>/<kelgan>\n` +
                    `<O'quvchi 1>\n` +
                    `<O'quvchi 2>\n...\n` +
                    `Misol:\n6A 21/18\nAli Karimov\nBobur Qodirov\n\n` +
                    `✅ Yangi ma'lumot yuborilsa, eski ma'lumot avtomatik yangilanadi.\n` +
                    `⏰ 09:15 da umumiy hisobot yuboriladi.`;
                await ctx.reply(groupInstructions);
            } else {
                await ctx.reply('❌ Bu guruh ID si ruxsat etilmagan.');
            }
            return;
        }
        
        const isOwnerUser = isOwner(userId);
        
        console.log(`/start - User ID: ${userId}, Is Owner: ${isOwnerUser}, Chat Type: ${ctx.chat.type}, Chat ID: ${ctx.chat.id}`);
        
        // Owner/admin gets special greeting with admin buttons
        if (isOwnerUser) {
            // Auto-approve owner if not already authorized
            const isAuthorized = await isUserAuthorized(userId);
            console.log(`Owner authorization check: ${isAuthorized}`);
            if (!isAuthorized) {
                // Auto-approve owner
                console.log('Auto-approving owner...');
                await approveUser(userId, userId);
            }
            
            const adminMessage = `👋 Assalomu alaykum! LSL Davomad Bot - Admin Panel

🔐 Siz botning egasiz va barcha admin funksiyalarga ega ekansiz.

📋 Bot maktab davomadini avtomatik yig'ish va hisoblash uchun yaratilgan.

⏰ Faol vaqt: 08:00 - 16:00 (Toshkent vaqti)

🔧 Admin funksiyalar:`;

            const adminKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🗑️ Bugungi ma\'lumotlarni tozalash', 'admin_cleandata')],
                [Markup.button.callback('📊 Kunlik hisobot', 'admin_report_daily')],
                [Markup.button.callback('📈 Haftalik hisobot', 'admin_report_weekly')],
                [Markup.button.callback('📉 Oylik hisobot', 'admin_report_monthly')]
            ]);
            
            await ctx.reply(adminMessage, adminKeyboard);
            console.log('/start command response sent successfully (admin)');
            return;
        }
        
        // Regular users
        const isAuthorized = await isUserAuthorized(userId);
        console.log(`Regular user authorization check: ${isAuthorized}`);
        
        const welcomeMessage = `👋 Assalomu alaykum! LSL Davomad Botiga xush kelibsiz!

📋 Bot maktab davomadini avtomatik yig'ish va hisoblash uchun yaratilgan.

⏰ Faol vaqt: 08:00 - 16:00 (Toshkent vaqti)

✅ Ruxsat olgan foydalanuvchilar barcha yangilanishlarni avtomatik olasiz.`;

        if (isAuthorized) {
            await ctx.reply(welcomeMessage + '\n\n✅ Sizga ruxsat berilgan.');
        } else {
            // Show "Get Permission" button
            const keyboard = Markup.inlineKeyboard([
                Markup.button.callback('🔐 Ruxsat olish', 'request_permission')
            ]);
            
            await ctx.reply(welcomeMessage + '\n\n⚠️ Botdan foydalanish uchun ruxsat olishingiz kerak.', keyboard);
        }
        
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

// Handle callback queries (button clicks)
bot.on('callback_query', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const data = ctx.callbackQuery.data;
        const userId = ctx.from.id;
        
        // Request permission button
        if (data === 'request_permission') {
            const username = ctx.from.username || ctx.from.first_name || 'Unknown';
            const result = await requestUserAccess(userId, username, ctx.chat.id);
            
            if (result.success) {
                // Send request to owner
                const requestMessage = `🔔 Yangi ruxsat so'rovi\n\n` +
                    `Foydalanuvchi: ${username}\n` +
                    `ID: ${userId}\n` +
                    `Chat ID: ${ctx.chat.id}`;
                
                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Qabul qilish', `approve_${userId}`)],
                    [Markup.button.callback('❌ Rad etish', `reject_${userId}`)]
                ]);
                
                await bot.telegram.sendMessage(config.ownerUserId, requestMessage, keyboard);
                await ctx.reply('✅ Ruxsat so\'rovi yuborildi. Tez orada javob olasiz.');
            } else {
                await ctx.reply(result.message === 'Request already pending' 
                    ? '⏳ Ruxsat so\'rovi allaqachon yuborilgan. Kuting...'
                    : '❌ Xatolik yuz berdi. Qayta urinib ko\'ring.');
            }
        }
        
        // Approve user
        if (data.startsWith('approve_')) {
            if (!isOwner(userId)) {
                await ctx.reply('❌ Sizda bu amalni bajarish uchun ruxsat yo\'q.');
                return;
            }
            
            const targetUserId = parseInt(data.replace('approve_', ''));
            const result = await approveUser(targetUserId, userId);
            
            if (result.success) {
                await ctx.reply(`✅ Foydalanuvchi ruxsat berildi.`);
                await bot.telegram.sendMessage(result.chatId, 
                    '✅ Ruxsat berildi! Endi siz barcha yangilanishlarni avtomatik olasiz.');
            } else {
                await ctx.reply(`❌ ${result.message}`);
            }
        }
        
        // Reject user
        if (data.startsWith('reject_')) {
            if (!isOwner(userId)) {
                await ctx.reply('❌ Sizda bu amalni bajarish uchun ruxsat yo\'q.');
                return;
            }
            
            const targetUserId = parseInt(data.replace('reject_', ''));
            const result = await rejectUser(targetUserId, userId);
            
            if (result.success) {
                await ctx.reply(`❌ Foydalanuvchi rad etildi.`);
                await bot.telegram.sendMessage(result.chatId, 
                    '❌ Sizning ruxsat so\'rovingiz rad etildi.');
            } else {
                await ctx.reply(`❌ ${result.message}`);
            }
        }
        
        // Admin actions via buttons
        if (data === 'admin_cleandata') {
            if (!isOwner(userId)) {
                await ctx.reply('❌ Sizda bu amalni bajarish uchun ruxsat yo\'q.');
                return;
            }
            
            const result = await cleanTodayData();
            await ctx.reply(result.success ? '✅ Bugungi ma\'lumotlar tozalandi.' : `❌ ${result.message}`);
        }
        
        if (data === 'admin_report_daily') {
            if (!isOwner(userId)) {
                await ctx.reply('❌ Sizda bu amalni bajarish uchun ruxsat yo\'q.');
                return;
            }
            
            const result = await generateDailyReport();
            if (result.success) {
                await ctx.reply(result.report);
            } else {
                await ctx.reply(`❌ ${result.message}`);
            }
        }
        
        if (data === 'admin_report_weekly') {
            if (!isOwner(userId)) {
                await ctx.reply('❌ Sizda bu amalni bajarish uchun ruxsat yo\'q.');
                return;
            }
            
            const today = new Date();
            const weekAgo = new Date(today);
            weekAgo.setDate(today.getDate() - 7);
            const result = await generateWeeklyReport(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
            if (result.success) {
                await ctx.reply(result.report);
            } else {
                await ctx.reply(`❌ ${result.message}`);
            }
        }
        
        if (data === 'admin_report_monthly') {
            if (!isOwner(userId)) {
                await ctx.reply('❌ Sizda bu amalni bajarish uchun ruxsat yo\'q.');
                return;
            }
            
            const today = new Date();
            const result = await generateMonthlyReport(today.getMonth() + 1, today.getFullYear());
            if (result.success) {
                await ctx.reply(result.report);
            } else {
                await ctx.reply(`❌ ${result.message}`);
            }
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
    }
});

// Handle admin commands
bot.command('cleandata', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return;
    }
    
    const result = await cleanTodayData();
    await ctx.reply(result.success ? '✅ Bugungi ma\'lumotlar tozalandi.' : `❌ ${result.message}`);
});

bot.command('report', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return;
    }
    
    const args = ctx.message.text.split(' ');
    const type = args[1] || 'daily';
    
    let result;
    if (type === 'daily') {
        result = await generateDailyReport();
    } else if (type === 'weekly') {
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        result = await generateWeeklyReport(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    } else if (type === 'monthly') {
        const today = new Date();
        result = await generateMonthlyReport(today.getMonth() + 1, today.getFullYear());
    } else {
        await ctx.reply('❌ Noto\'g\'ri format. /report daily|weekly|monthly');
        return;
    }
    
    if (result.success) {
        await ctx.reply(result.report);
    } else {
        await ctx.reply(`❌ ${result.message}`);
    }
});

// Handle incoming messages
bot.on('message', async (ctx) => {
    try {
        const chatType = ctx.chat.type;
        const chatIdReceived = ctx.chat.id;
        const messageText = ctx.message?.text || '';
        const userId = ctx.from?.id;
        const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
        
        console.log('='.repeat(50));
        console.log('Message received:');
        console.log(`  Chat Type: ${chatType}`);
        console.log(`  Chat ID: ${chatIdReceived}`);
        console.log(`  Expected Group ID: ${config.allowedGroupId}`);
        console.log(`  User ID: ${userId}`);
        console.log(`  Username: ${username}`);
        console.log(`  Message: ${messageText.substring(0, 50)}...`);
        console.log('='.repeat(50));
        
        // Check if it's a group - verify authorization
        if (chatType === 'group' || chatType === 'supergroup') {
            console.log(`🔍 Checking group authorization...`);
            console.log(`  Received Group ID: ${chatIdReceived}`);
            console.log(`  Expected Group ID: ${config.allowedGroupId}`);
            console.log(`  Match: ${chatIdReceived === config.allowedGroupId}`);
            
            if (!isGroupAuthorized(chatIdReceived)) {
                console.log(`❌ UNAUTHORIZED GROUP - Ignoring message`);
                console.log(`  Group ID ${chatIdReceived} does not match expected ${config.allowedGroupId}`);
                return;
            }
            
            console.log(`✅ AUTHORIZED GROUP CONFIRMED`);
            
            // Store chat ID from first message (for scheduler)
            if (!chatId) {
                chatId = chatIdReceived;
                console.log(`📌 Chat ID stored for scheduler: ${chatId}`);
                // Initialize scheduler now that we have chat ID
                initScheduler(bot, chatId);
            }
        } else {
            // For private messages, check if user is authorized
            console.log(`🔍 Checking user authorization for private message...`);
            const isAuthorized = await isUserAuthorized(userId);
            console.log(`  User ${userId} authorized: ${isAuthorized}`);
            
            if (!isAuthorized) {
                console.log(`❌ User not authorized - ignoring message`);
                // User not authorized, ignore message (they should use /start)
                return;
            }
        }
        
        if (!messageText) {
            console.log('Message has no text, ignoring');
            return;
        }
        
        // Check if within active hours (08:00 - 16:00) for data recording
        if (!isWithinActiveHours()) {
            const time = getTashkentTime();
            const { start, end } = config.activeHours;
            
            console.log(`Outside active hours. Current time: ${time.hour}:${time.minute}, Active: ${start.hour}:${start.minute} - ${end.hour}:${end.minute}`);
            
            // Check if it's exactly end of day time
            if (time.hour === end.hour && time.minute === end.minute) {
                // End of day message will be sent by scheduler
                return;
            }
            
            // Outside active hours - don't record data, but allow /start and other commands
            // Only ignore attendance/late update messages
            if (messageText.trim().match(/^[A-Z0-9]+\s+\d+\/\d+/i) || 
                messageText.trim().match(/\s+(keldi|ketdi)$/i)) {
                console.log('Attendance/late update message outside active hours - ignoring');
                return;
            }
            
            // Allow other messages (like /start, commands) to pass through
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
        // Process during active hours (08:00 - 16:00)
        console.log('Checking for late update...');
        const lateUpdateProcessed = await processLateUpdate(messageText, ctx.chat.id, bot);
        if (lateUpdateProcessed) {
            console.log('Late update processed successfully');
            return;
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
    const baseUrl = config.webhookUrl ? config.webhookUrl.replace(/\/+$/, '') : 'not set';
    res.json({ 
        status: 'webhook endpoint active',
        message: 'Telegram will POST updates here',
        webhookUrl: `${baseUrl}/webhook/${config.botToken}`,
        note: 'Make sure WEBHOOK_URL environment variable is set correctly'
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
    
    // If webhook URL is provided, set it up (non-blocking with retry)
    if (config.webhookUrl) {
        // Remove trailing slash if present to avoid double slashes
        const baseUrl = config.webhookUrl.replace(/\/+$/, '');
        const webhookUrl = `${baseUrl}/webhook/${config.botToken}`;
        console.log(`Setting webhook to: ${webhookUrl}`);
        
        // Retry function for webhook setup
        const setupWebhook = async (retries = 3, delay = 5000) => {
            for (let i = 0; i < retries; i++) {
                try {
                    await bot.telegram.setWebhook(webhookUrl);
                    console.log('Webhook set successfully');
                    
                    // Verify webhook info
                    const info = await bot.telegram.getWebhookInfo();
                    console.log('Webhook info:', JSON.stringify(info, null, 2));
                    return;
                } catch (err) {
                    console.error(`Webhook setup attempt ${i + 1} failed:`, err.message);
                    if (i < retries - 1) {
                        console.log(`Retrying in ${delay / 1000} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        console.error('Failed to set webhook after', retries, 'attempts');
                        console.error('You can manually set it using:');
                        console.error(`curl -X POST "https://api.telegram.org/bot${config.botToken}/setWebhook?url=${webhookUrl}"`);
                    }
                }
            }
        };
        
        // Set webhook asynchronously (don't block server startup)
        setupWebhook().catch(err => {
            console.error('Webhook setup error:', err);
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

