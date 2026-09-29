import { config } from './config.js';
import {
    getTodayDate,
    setDayOff,
    clearDayOff,
    isDayOff,
    isSunday,
    getUpcomingDaysOff
} from './database.js';
import { isOwner } from './admin.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function announceToGroup(bot, text) {
    try {
        await bot.telegram.sendMessage(config.allowedGroupId, text);
    } catch (error) {
        console.error('Day-off group announcement failed:', error);
    }
}

async function markDayOff(bot, date, setBy) {
    await setDayOff(date, setBy);
    const isToday = date === getTodayDate();
    await announceToGroup(
        bot,
        `📴 ${date} — dam olish kuni.\n` +
        `${isToday ? 'Bugun' : "O'sha kuni"} davomat yuborish shart emas — ` +
        `bot eslatma va hisobot yubormaydi.`
    );
}

async function unmarkDayOff(bot, date) {
    const removed = await clearDayOff(date);
    if (removed) {
        await announceToGroup(
            bot,
            `✅ ${date} — dam olish kuni bekor qilindi. Bot davomat qabul qiladi.`
        );
    }
    return removed;
}

/**
 * Handle the /dayoff command (owner only).
 *   /dayoff                  -> mark today as a day off
 *   /dayoff YYYY-MM-DD       -> mark that date
 *   /dayoff off [YYYY-MM-DD] -> cancel today / that date
 *   /dayoff list             -> list upcoming days off
 */
export async function handleDayOffCommand(ctx, bot) {
    if (!isOwner(ctx.from.id)) {
        return;
    }

    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    const sub = (parts[0] || '').toLowerCase();

    if (sub === 'list') {
        const dates = await getUpcomingDaysOff();
        const body = dates.length
            ? `📴 Qo'shimcha dam olish kunlari:\n${dates.join('\n')}`
            : "📴 Qo'shimcha dam olish kunlari yo'q.";
        await ctx.reply(`${body}\n\nℹ️ Yakshanba kunlari doim avtomatik dam olish kuni.`);
        return;
    }

    if (sub === 'off' || sub === 'bekor' || sub === 'cancel') {
        const date = parts[1] && DATE_RE.test(parts[1]) ? parts[1] : getTodayDate();
        if (isSunday(date)) {
            await ctx.reply(`ℹ️ ${date} — yakshanba. Yakshanba har doim dam olish kuni, buni bekor qilib bo'lmaydi.`);
            return;
        }
        const removed = await unmarkDayOff(bot, date);
        await ctx.reply(
            removed
                ? `✅ ${date} — dam olish kuni bekor qilindi.`
                : `ℹ️ ${date} dam olish kuni sifatida belgilanmagan edi.`
        );
        return;
    }

    let date = getTodayDate();
    if (sub) {
        if (!DATE_RE.test(sub)) {
            await ctx.reply(
                '❌ Format: /dayoff [YYYY-MM-DD] | /dayoff off [YYYY-MM-DD] | /dayoff list'
            );
            return;
        }
        date = sub;
    }

    if (isSunday(date)) {
        await ctx.reply(`ℹ️ ${date} — yakshanba, allaqachon avtomatik dam olish kuni.`);
        return;
    }

    await markDayOff(bot, date, ctx.from.id);
    await ctx.reply(
        `📴 ${date} — dam olish kuni sifatida belgilandi.\n` +
        'Bu kuni bot davomat qabul qilmaydi va eslatma/hisobot yubormaydi.'
    );
}

/**
 * Toggle today's day-off state (used by the admin panel button).
 */
export async function toggleDayOffToday(ctx, bot) {
    if (!isOwner(ctx.from.id)) {
        await ctx.reply("❌ Sizda bu amalni bajarish uchun ruxsat yo'q.");
        return;
    }

    const today = getTodayDate();
    if (isSunday(today)) {
        await ctx.reply(`ℹ️ Bugun (${today}) yakshanba — avtomatik dam olish kuni. Buni o'zgartirib bo'lmaydi.`);
        return;
    }
    if (await isDayOff(today)) {
        await unmarkDayOff(bot, today);
        await ctx.reply(`✅ ${today} — dam olish kuni bekor qilindi. Bot bugun normal ishlaydi.`);
    } else {
        await markDayOff(bot, today, ctx.from.id);
        await ctx.reply(`📴 ${today} — dam olish kuni. Bot bugun davomat qabul qilmaydi.`);
    }
}
