import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import { isEntryPoint } from './entrypoint.js';
import { config } from './config.js';
import { isWithinActiveHours, getTashkentTime, getTodayDate, isDayOff, pool } from './database.js';
import { updateAttendanceMessage } from './attendance.js';
import { processLateUpdate } from './lateUpdates.js';
import { initScheduler } from './scheduler.js';
import { isGroupAuthorized, isUserAuthorized, requestUserAccess, approveUser, rejectUser, ensureAuthorized } from './permissions.js';
import { isOwner, cleanTodayData, generateDailyReport, generateWeeklyReport, generateMonthlyReport } from './admin.js';
import { handleDayOffCommand, toggleDayOffToday } from './dayoff.js';
import { handleStudentMessage, handleStudentCallback, verifyStudentSetup } from './studentAttendance.js';
import { weeklyStudentReport, studentHistory, handleStudentHistory, sendLongMessage, classRosterReport } from './studentReports.js';
import { weekRange } from './studentMatching.js';

export const bot = new Telegraf(config.botToken);
export const app = express();

function studentReportButtons() {
    if (!config.studentAttendanceEnabled) return [];
    return [
        [Markup.button.callback('📋 Haftalik kelmaganlar', 'students_absent_current')],
        [Markup.button.callback('⏰ Haftalik kech qolganlar', 'students_late_current')],
        [Markup.button.callback('👤 O‘quvchi tarixi', 'students_history_help')],
        [Markup.button.callback('📋 Sinf ro‘yxati', 'students_roster_help')]
    ];
}

async function canReadStudentReports(ctx) {
    // Individual histories are available privately to the owner/approved users.
    return ctx.chat?.type === 'private' && (isOwner(ctx.from.id) || await isUserAuthorized(ctx.from.id));
}

// Middleware to parse JSON
app.use(express.json());

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
                if (config.studentAttendanceEnabled) {
                    await ctx.reply('👤 Rasmiy ro‘yxat bo‘yicha davomat:\n' +
                        '6A kelmaganlar:\nAli Karimov\nBobur Oripov\n\n' +
                        'Yoki: 6A 21/19 va ikki kelmagan o‘quvchining ismi.\n' +
                        'Hamma kelgan bo‘lsa: 6A hamma keldi\n' +
                        'Kechroq kelganda: 6A Ali keldi\n' +
                        'Erta ketganda: 6A Ali ketdi\n' +
                        'Bir xil ism uchrasa, bot tanlash uchun tugmalar beradi.');
                }
            } else {
                await ctx.reply('❌ Bu guruh ID si ruxsat etilmagan.');
            }
            return;
        }
        
        const isOwnerUser = isOwner(userId);
        
        console.log(`/start - User ID: ${userId}, Is Owner: ${isOwnerUser}, Chat Type: ${ctx.chat.type}, Chat ID: ${ctx.chat.id}`);
        
        // Owner/admin gets special greeting with admin buttons
        if (isOwnerUser) {
            // Make sure the owner is always in the authorized list so they
            // receive the automatic "new data" reports in DM.
            const username = ctx.from.username || ctx.from.first_name || 'owner';
            await ensureAuthorized(userId, username, ctx.chat.id, userId);
            
            const adminMessage = `👋 Assalomu alaykum! LSL Davomat Bot - Admin Panel

🔐 Siz botning egasiz va barcha admin funksiyalarga ega ekansiz.

📋 Bot maktab davomatini avtomatik yig'ish va hisoblash uchun yaratilgan.

⏰ Faol vaqt: 08:00 - 16:00 (Toshkent vaqti)

🔧 Admin funksiyalar:`;

            const adminKeyboard = Markup.inlineKeyboard([
                ...studentReportButtons(),
                [Markup.button.callback('📴 Bugun dam olish kuni (yoqish/o\'chirish)', 'admin_dayoff_toggle')],
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
        
        const welcomeMessage = `👋 Assalomu alaykum! LSL Davomat Botiga xush kelibsiz!

📋 Bot maktab davomatini avtomatik yig'ish va hisoblash uchun yaratilgan.

⏰ Faol vaqt: 08:00 - 16:00 (Toshkent vaqti)

✅ Ruxsat olgan foydalanuvchilar barcha yangilanishlarni avtomatik olasiz.`;

        if (isAuthorized) {
            // Show report buttons for authorized users
            const userKeyboard = Markup.inlineKeyboard([
                ...studentReportButtons(),
                [Markup.button.callback('📊 Kunlik hisobot', 'user_report_daily')],
                [Markup.button.callback('📈 Haftalik hisobot', 'user_report_weekly')],
                [Markup.button.callback('📉 Oylik hisobot', 'user_report_monthly')]
            ]);
            
            await ctx.reply(welcomeMessage + '\n\n✅ Sizga ruxsat berilgan.', userKeyboard);
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

        if (config.studentAttendanceEnabled && data.startsWith('st:')) {
            // Sessions also verify chat, original submitter, date, roster and expiry.
            await handleStudentCallback(ctx);
            return;
        }
        if (config.studentAttendanceEnabled && (data.startsWith('students_') || data.startsWith('sh:'))) {
            if (!await canReadStudentReports(ctx)) {
                await ctx.reply('Bu hisobot faqat ruxsat berilgan foydalanuvchilarga botning shaxsiy chatida ochiladi.');
                return;
            }
            const history = data.match(/^sh:(\d+)$/);
            if (data === 'students_roster_help') {
                const counts = (await pool.query('SELECT count(*)::int AS students FROM roster_students WHERE active')).rows[0];
                await ctx.reply(`Sinfni tanlang. Jami: ${counts.students} o‘quvchi.`, Markup.inlineKeyboard(
                    config.classes.map(name => Markup.button.callback(name, `students_roster_${name}`)), { columns: 4 }));
                return;
            }
            const roster = data.match(/^students_roster_(\d{1,2}[AB])$/);
            if (roster && config.classes.includes(roster[1])) {
                await sendLongMessage(ctx.telegram, ctx.chat.id, await classRosterReport(roster[1]));
                return;
            }
            if (data === 'students_history_help') {
                await ctx.reply('O‘quvchi tarixini ko‘rish uchun yuboring:\n/oquvchi 6A Ali Karimov\n\nSinf va ism yoki familiya yetarli. Oxirgi 90 kun ko‘rsatiladi.');
                return;
            }
            if (history) {
                await sendLongMessage(ctx.telegram, ctx.chat.id, await studentHistory(Number(history[1])));
                return;
            }
            const report = data.match(/^students_(absent|late)_(current|previous)$/);
            if (!report) return;
            let range = weekRange(getTodayDate());
            if (report[2] === 'previous') {
                const end = new Date(`${range.start}T00:00:00Z`);
                end.setUTCDate(end.getUTCDate() - 1);
                range = weekRange(end.toISOString().slice(0, 10));
            }
            await sendLongMessage(ctx.telegram, ctx.chat.id, await weeklyStudentReport(report[1], range, true));
            await ctx.reply('Boshqa davr:', Markup.inlineKeyboard([
                [Markup.button.callback('Shu hafta', `students_${report[1]}_current`),
                    Markup.button.callback('O‘tgan hafta', `students_${report[1]}_previous`)]
            ]));
            return;
        }
        
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
        if (data === 'admin_dayoff_toggle') {
            await toggleDayOffToday(ctx, bot);
        }

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
        
        // User report buttons (accessible to authorized users)
        if (data === 'user_report_daily') {
            const isAuthorized = await isUserAuthorized(userId);
            if (!isAuthorized) {
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
        
        if (data === 'user_report_weekly') {
            const isAuthorized = await isUserAuthorized(userId);
            if (!isAuthorized) {
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
        
        if (data === 'user_report_monthly') {
            const isAuthorized = await isUserAuthorized(userId);
            if (!isAuthorized) {
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

bot.command('dayoff', (ctx) => handleDayOffCommand(ctx, bot));

bot.command('oquvchi', async ctx => {
    if (!config.studentAttendanceEnabled || !await canReadStudentReports(ctx)) return;
    try { await handleStudentHistory(ctx); }
    catch (error) { console.error('Student history failed:', error.message); await ctx.reply('Hisobotni olishda xatolik. Qayta urinib ko‘ring.'); }
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

        // Skip all attendance recording on a day off (owner set via /dayoff)
        if (await isDayOff()) {
            console.log('Day off - not recording attendance / late updates');
            return;
        }

        if (config.studentAttendanceEnabled) {
            await handleStudentMessage(ctx);
            return;
        }

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
app.get('/health', async (req, res) => {
    let db = 'unknown';
    try {
        await pool.query('SELECT 1');
        db = 'ok';
    } catch (error) {
        db = 'error';
    }
    res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'error', db,
        time: new Date().toISOString(), version: 'student-attendance-1.2.1', studentAttendanceEnabled: config.studentAttendanceEnabled,
        schoolDay: { start: '08:30', end: '16:00', timezone: config.timezone } });
});

const WEBHOOK_WATCHDOG_INTERVAL_MS = 2 * 60 * 1000;

/**
 * In polling mode no webhook should ever be registered. If another deployment
 * calls setWebhook it silently terminates our polling loop, so watch for that
 * and recover.
 */
function startWebhookWatchdog() {
    setInterval(async () => {
        try {
            const info = await bot.telegram.getWebhookInfo();
            if (info.url) {
                console.error(`Foreign webhook detected (${info.url}) - removing and restarting`);
                await bot.telegram.deleteWebhook();
                process.exit(1);
            }
        } catch (err) {
            console.error('Webhook watchdog check failed:', err.message);
        }
    }, WEBHOOK_WATCHDOG_INTERVAL_MS);
}

// Start server
const PORT = config.port || process.env.PORT || 3000;
const HOST = '0.0.0.0';

export async function start() {
    if (config.studentAttendanceEnabled) await verifyStudentSetup();
    const server = app.listen(PORT, HOST, async () => {
        console.log(`Server running on ${HOST}:${PORT}`);
        console.log(`Webhook URL: /webhook/${config.botToken}`);

        // Verify database connectivity on startup (non-fatal, just log)
        try {
            await pool.query('SELECT 1');
            console.log('PostgreSQL connection OK');
        } catch (err) {
            console.error('PostgreSQL connection FAILED at startup:', err.message);
        }

        // Arm the cron jobs immediately. Waiting for a group message meant that
        // after any restart the reminders and summaries silently never fired.
        initScheduler(bot, config.allowedGroupId);
    
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
            console.log('WEBHOOK_URL not set. Starting in long-polling mode.');
            // launch() removes any existing webhook, then starts getUpdates polling
            bot.launch()
                .then(() => console.log('Long-polling loop ended'))
                .catch((err) => {
                    // A foreign setWebhook call kills polling with a 409. Exiting lets
                    // pm2 restart us into a clean polling loop instead of staying
                    // "online" but deaf to every message.
                    console.error('Long-polling failed, exiting for restart:', err.message);
                    process.exit(1);
                });

            startWebhookWatchdog();
        }
    });

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    return server;
}

if (isEntryPoint(import.meta.url)) {
    start().catch(error => {
        console.error('Bot startup failed:', error.message);
        process.exit(1);
    });
}

