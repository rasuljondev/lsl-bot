import { normalizeLeadingToken } from './textNormalize.js';

const cyrillic = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
    ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h'
};

export function normalizeName(value) {
    return [...String(value).normalize('NFKC').toLowerCase()]
        .map(c => cyrillic[c] ?? c).join('')
        .replace(/['’‘ʻʼ`ʹ\u02bb\u02bc]/g, '')
        .replace(/[^a-z0-9\s-]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export function distance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    rows[0] = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
                rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
            }
        }
    }
    return rows[a.length][b.length];
}

function variants(student) {
    return [student.full_name, ...(student.aliases || [])].map(normalizeName).filter(Boolean);
}

// Uzbek honorific endings and explicit school variants; never arbitrary prefixes.
const equivalentNames = [
    ['madina', 'madinabonu'],
    ['bobur', 'boburmizo', 'boburmiroz', 'boburmirzo'],
];
function nameBase(name) {
    const base = name.replace(/(?:xon|jon|bek)$/, '');
    return base.length >= 3 ? base : name;
}
function equivalentName(a, b) {
    const first = nameBase(a), second = nameBase(b);
    return first === second || equivalentNames.some(group => group.includes(first) && group.includes(second));
}

export function matchStudent(input, roster) {
    const key = normalizeName(input);
    if (!key) return { kind: 'unknown', candidates: [] };
    // A full exact name takes priority over token/alias matches.
    const full = roster.filter(s => normalizeName(s.full_name) === key);
    const exact = full.length ? full : roster.filter(s => variants(s).some(v =>
        v === key || (!key.includes(' ') && v.split(' ').some(word => equivalentName(word, key)))));
    if (exact.length === 1) return { kind: 'exact', student: exact[0] };
    if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };
    const tokens = key.split(' ');
    if (tokens.length === 2 && tokens.every(token => token.length > 1)) {
        // Require an exact full-name token as an anchor; do not guess two misspelled words.
        const reordered = roster.filter(student => variants(student).some(value => {
            const words = value.split(' ');
            if (words.length !== 2) return false;
            return [0, 1].some(index => words[index] === tokens[0] &&
                equivalentName(words[1 - index], tokens[1])) ||
                [0, 1].some(index => words[index] === tokens[1] &&
                equivalentName(words[1 - index], tokens[0]));
        }));
        if (reordered.length === 1) return { kind: 'name-parts', student: reordered[0] };
        if (reordered.length > 1) return { kind: 'ambiguous', candidates: reordered };
    }
    if (tokens.length === 2 && tokens.some(token => token.length === 1)) {
        const initial = tokens.find(token => token.length === 1);
        const surname = tokens.find(token => token.length > 1);
        const initials = roster.filter(student => variants(student).some(value => {
            const words = value.split(' ');
            return surname && words.includes(surname) && words.some(word => word !== surname && word.startsWith(initial));
        }));
        if (initials.length === 1) return { kind: 'initial', student: initials[0] };
        if (initials.length > 1) return { kind: 'ambiguous', candidates: initials };
        // An unmatched initial must not fall through to fuzzy identity selection.
        return { kind: 'unknown', candidates: [] };
    }
    const maxDistance = key.length >= 8 ? 2 : key.length >= 4 ? 1 : 0;
    const scored = roster.map(student => ({ student, score: Math.min(...variants(student).flatMap(v =>
        (key.includes(' ') ? [v] : [v, ...v.split(' ')]).map(v => distance(key, v)))) }))
        .filter(x => x.score <= maxDistance).sort((a, b) => a.score - b.score || a.student.id - b.student.id);
    if (!scored.length) return { kind: 'unknown', candidates: [] };
    // Only a unique, one-character correction is automatic. Wider matches ask.
    if (scored[0].score === 1 && (scored.length === 1 || scored[1].score >= 3) && key.length >= 5) {
        return { kind: 'corrected', student: scored[0].student };
    }
    return { kind: 'ambiguous', candidates: scored.map(x => x.student) };
}

export function parseStudentMessage(text) {
    const normalized = normalizeLeadingToken(text.trim());
    const header = normalized.match(/^([0-9]{1,2}[AB])\s+([\s\S]+)$/i);
    if (!header) return null;
    const className = header[1].toUpperCase(), rest = header[2].trim();
    if (/^hamma\s+keldi[.!]?$/i.test(rest)) return { className, kind: 'report', names: [], expectedAbsent: 0 };
    const update = rest.match(/^(.+?)\s+(keldi|ketdi)$/i);
    if (update) return { className, kind: update[2].toLowerCase(), names: [update[1].trim()] };
    const counts = rest.match(/^(\d+)\s*\/\s*(\d+)\s*([\s\S]*)$/);
    let namesText;
    let total, present;
    if (counts) {
        total = Number(counts[1]); present = Number(counts[2]); namesText = counts[3] || '';
    } else {
        const absent = rest.match(/^(?:kelmaganlar|kelmagan|yo['’ʻʼ‘]?qlar)\s*:?\s*([\s\S]*)$/i);
        // A class followed directly by names is also an absent-student list.
        namesText = absent ? absent[1] : rest;
    }
    const names = namesText.split(/[\n,;]+/).map(n => n.replace(/^\s*[-•]\s*|^\s*\d+[.)]\s*/g, '')
        .replace(/^kelmaganlar\s*:\s*/i, '').replace(/\s+(?:kelmadi|kasal)[.!]?$/i, '').trim()).filter(Boolean);
    return { className, kind: 'report', names, total, present,
        expectedAbsent: counts ? total - present : undefined };
}

export function nextStatus(current, action) {
    if (action === 'keldi') {
        if (current.status === 'absent') return { status: 'late', arrived_late: true };
        if (current.status === 'left') return { status: current.arrived_late ? 'late' : 'present', arrived_late: current.arrived_late };
        return current;
    }
    if (action === 'ketdi') return current.status === 'absent' ? current
        : { status: 'left', arrived_late: current.arrived_late };
    throw new Error('Unknown attendance action');
}

export function weekRange(today) {
    const date = new Date(`${today}T00:00:00Z`);
    const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
    return { start: date.toISOString().slice(0, 10), end: today };
}
