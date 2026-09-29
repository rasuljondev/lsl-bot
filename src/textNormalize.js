// Uzbek/Russian keyboards can silently produce Cyrillic letters that are
// visually identical to Latin ones (e.g. Cyrillic 'А' U+0410 vs Latin 'A').
// A teacher typing a class name like "0A" can end up sending "0А" without
// noticing, which then fails to match [A-Z0-9] and gets silently dropped.
const CYRILLIC_TO_LATIN = {
    'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
    'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
    'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm',
    'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'х': 'x'
};

/**
 * Replace Cyrillic look-alike characters with their Latin equivalents in the
 * leading whitespace-delimited token of a line (where class names live).
 * Leaves the rest of the line untouched so real Cyrillic text (student
 * names, chat) is never mangled.
 */
export function normalizeLeadingToken(line) {
    return line.replace(/^\S+/, (token) =>
        [...token].map((ch) => CYRILLIC_TO_LATIN[ch] || ch).join('')
    );
}
