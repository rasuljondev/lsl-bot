import { Markup } from 'telegraf';
import { config } from './config.js';
import { pool } from './database.js';
import { isOwner } from './admin.js';
import { addStudent, removeStudent, renameStudent, RosterEditError } from './rosterEdits.js';

// Button flow (private chat only): menu -> class -> add / remove / rename.
// Callback data: rx:menu | rx:{c,a,d,e}:<class> | rx:{dp,dy,ep}:<studentId>
const STATE_TTL_MS = 15 * 60 * 1000;
const BUTTON_TEXT_LIMIT = 60;
const pendingInput = new Map(); // userId -> { action: 'add'|'rename', className, studentId, at }

const button = (text, data) => Markup.button.callback(text, data);

/** Only the owner and the single configured editor may change the student list. */
export function canEditRoster(userId) {
    if (!config.studentAttendanceEnabled) return false;
    return isOwner(userId) || (config.rosterEditorId !== null && userId === config.rosterEditorId);
}

export function rosterEditButtons(userId) {
    return canEditRoster(userId) ? [[button('📝 Ro‘yxatni tahrirlash', 'rx:menu')]] : [];
}

async function activeStudents(className) {
    const { rows } = await pool.query(`SELECT id, full_name FROM roster_students
        WHERE class_name=$1 AND active ORDER BY full_name, id`, [className]);
    return rows;
}

async function findStudent(id) {
    if (!Number.isSafeInteger(id)) return null;
    return (await pool.query('SELECT id, full_name, class_name, active FROM roster_students WHERE id=$1', [id])).rows[0] || null;
}

function cancelKeyboard(className) {
    return Markup.inlineKeyboard([[button('❌ Bekor qilish', `rx:c:${className}`)]]);
}

async function showClassPicker(ctx) {
    await ctx.reply('📝 Qaysi sinf ro‘yxatini ko‘rasiz?', Markup.inlineKeyboard(
        config.classes.map(name => button(name, `rx:c:${name}`)), { columns: 4 }));
}

async function showClass(ctx, className, notice = '') {
    const students = await activeStudents(className);
    const list = students.length ? students.map((s, i) => `${i + 1}. ${s.full_name}`).join('\n') : 'Ro‘yxat bo‘sh.';
    await ctx.reply(`${notice ? `${notice}\n\n` : ''}📋 ${className} — ${students.length} o‘quvchi\n\n${list}`,
        Markup.inlineKeyboard([
            [button('➕ Qo‘shish', `rx:a:${className}`), button('➖ Chiqarish', `rx:d:${className}`)],
            [button('✏️ Ismni tahrirlash', `rx:e:${className}`), button('⬅️ Sinflar', 'rx:menu')]
        ]));
}

async function showStudentPicker(ctx, className, kind) {
    const students = await activeStudents(className);
    const title = kind === 'dp'
        ? `➖ ${className}: qaysi o‘quvchini ro‘yxatdan chiqarasiz?`
        : `✏️ ${className}: qaysi o‘quvchining ismini tahrirlaysiz?`;
    await ctx.reply(title, Markup.inlineKeyboard([
        ...students.map(s => [button(s.full_name.slice(0, BUTTON_TEXT_LIMIT), `rx:${kind}:${s.id}`)]),
        [button('⬅️ Orqaga', `rx:c:${className}`)]
    ]));
}

async function replyError(ctx, error) {
    if (error instanceof RosterEditError) {
        await ctx.reply(`⚠️ ${error.message}`);
        return;
    }
    console.error('Roster edit failed:', error);
    await ctx.reply('Xatolik yuz berdi. O‘zgarish saqlanmadi, qayta urinib ko‘ring.');
}

async function handleClassAction(ctx, action, className) {
    if (!config.classes.includes(className)) {
        await ctx.reply('Sinf topilmadi.');
        return;
    }
    if (action === 'a') {
        pendingInput.set(ctx.from.id, { action: 'add', className, at: Date.now() });
        await ctx.reply(`➕ ${className} sinfiga qo‘shiladigan o‘quvchining familiya va ismini yozing.\nNamuna: Karimov Ali`,
            cancelKeyboard(className));
        return;
    }
    if (action === 'd' || action === 'e') {
        await showStudentPicker(ctx, className, action === 'd' ? 'dp' : 'ep');
        return;
    }
    pendingInput.delete(ctx.from.id);
    await showClass(ctx, className);
}

async function handleStudentAction(ctx, action, student) {
    if (action === 'dp') {
        await ctx.reply(`${student.full_name} (${student.class_name}) ro‘yxatdan chiqarilsinmi?\nDavomat tarixi saqlanadi.`,
            Markup.inlineKeyboard([[button('✅ Ha, chiqarish', `rx:dy:${student.id}`),
                button('❌ Yo‘q', `rx:c:${student.class_name}`)]]));
        return;
    }
    if (action === 'dy') {
        const removed = await removeStudent({ studentId: student.id, actorId: ctx.from.id });
        await showClass(ctx, removed.class_name, `✅ ${removed.full_name} ro‘yxatdan chiqarildi. Davomat tarixi saqlandi.`);
        return;
    }
    if (action === 'ep') {
        pendingInput.set(ctx.from.id, { action: 'rename', className: student.class_name, studentId: student.id, at: Date.now() });
        await ctx.reply(`✏️ Hozirgi ism: ${student.full_name}\nYangi to‘liq ismni yozing (familiya ism).\nEski yozilishi ham taniladi.`,
            cancelKeyboard(student.class_name));
    }
}

export async function handleRosterCallback(ctx) {
    if (ctx.chat?.type !== 'private' || !canEditRoster(ctx.from.id)) {
        await ctx.reply('Ro‘yxatni faqat tayinlangan admin botning shaxsiy chatida tahrirlay oladi.');
        return;
    }
    const [, action, arg] = ctx.callbackQuery.data.split(':');
    try {
        if (action === 'menu') {
            pendingInput.delete(ctx.from.id);
            await showClassPicker(ctx);
        } else if (['c', 'a', 'd', 'e'].includes(action)) {
            await handleClassAction(ctx, action, arg);
        } else if (['dp', 'dy', 'ep'].includes(action)) {
            const student = await findStudent(Number(arg));
            if (!student?.active) await ctx.reply('O‘quvchi topilmadi yoki allaqachon chiqarilgan.');
            else await handleStudentAction(ctx, action, student);
        }
    } catch (error) {
        await replyError(ctx, error);
    }
}

/** Consume a typed name after "Qo‘shish" / "Ismni tahrirlash". Returns true when handled. */
export async function handleRosterInput(ctx) {
    const userId = ctx.from?.id;
    const state = pendingInput.get(userId);
    if (!state || ctx.chat?.type !== 'private' || !canEditRoster(userId)) return false;
    const text = ctx.message?.text;
    if (Date.now() - state.at > STATE_TTL_MS || text?.startsWith('/')) {
        pendingInput.delete(userId);
        return false;
    }
    if (!text) {
        await ctx.reply('Ismni matn ko‘rinishida yozing.');
        return true;
    }
    try {
        if (state.action === 'add') {
            const added = await addStudent({ className: state.className, name: text, actorId: userId });
            pendingInput.delete(userId);
            const how = added.reactivated ? 'qayta qo‘shildi (avvalgi tarixi bilan)' : 'qo‘shildi';
            await showClass(ctx, added.class_name, `✅ ${added.full_name} ${added.class_name} sinfiga ${how}.`);
        } else {
            const renamed = await renameStudent({ studentId: state.studentId, name: text, actorId: userId });
            pendingInput.delete(userId);
            await showClass(ctx, renamed.class_name, `✅ ${renamed.old_name} → ${renamed.full_name}`);
        }
    } catch (error) {
        // The state is kept, so the admin can simply type a corrected name.
        await replyError(ctx, error);
    }
    return true;
}
