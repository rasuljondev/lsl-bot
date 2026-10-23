import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, matchStudent, parseStudentMessage, nextStatus, weekRange } from '../src/studentMatching.js';
import { validateRoster } from '../src/rosterImport.js';
import { isEntryPoint } from '../src/entrypoint.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const roster = [
    { id: 1, full_name: 'Ali Karimov', aliases: [] },
    { id: 2, full_name: 'Ali Rahimov', aliases: [] },
    { id: 3, full_name: 'Bobur Oripov', aliases: ['Bobir'] },
    { id: 4, full_name: 'O‘tkir G‘aniyev', aliases: [] }
];

test('startup recognizes both direct Node and PM2 ESM loaders without starting on test imports', () => {
    const entry = path.resolve('src/bot.js');
    const url = pathToFileURL(entry).href;
    assert.equal(isEntryPoint(url, ['node', entry], {}), true);
    assert.equal(isEntryPoint(url, ['node', path.resolve('ProcessContainerFork.js')], { pm_exec_path: entry }), true);
    assert.equal(isEntryPoint(url, ['node', path.resolve('test/studentMatching.test.js')], {}), false);
});

test('Uzbek apostrophes, Cyrillic names and whitespace normalize consistently', () => {
    assert.equal(normalizeName(' Ўткир Ғаниев '), normalizeName('O‘tkir G‘aniеv'));
    assert.equal(normalizeName('GʻANIYEV'), normalizeName("G'aniyev"));
    assert.equal(matchStudent('Бобур', roster).student.id, 3);
});

test('unique first name, surname, full name and explicit alias resolve within class', () => {
    for (const name of ['Bobur', 'Oripov', 'Bobur Oripov', 'Bobir']) {
        assert.equal(matchStudent(name, roster).student.id, 3);
    }
    assert.equal(matchStudent('Ali Karimov', roster).student.id, 1);
    assert.equal(matchStudent('Ali', roster).kind, 'ambiguous');
    assert.equal(matchStudent('Ali', roster).candidates.length, 2);
    assert.equal(matchStudent('Nobody', roster).kind, 'unknown');
});

test('only clear typos auto-correct; close alternatives and short names ask', () => {
    assert.equal(matchStudent('Orpiov', roster).kind, 'corrected');
    assert.equal(matchStudent('Orpiov', roster).student.id, 3);
    assert.notEqual(matchStudent('Al', roster).kind, 'corrected');
    const similar = [...roster, { id: 5, full_name: 'Xobur Salimov' }];
    assert.equal(matchStudent('Lobur', similar).kind, 'ambiguous');
});

test('duplicate full names are ambiguous', () => {
    assert.equal(matchStudent('Ali Karimov', [...roster, { id: 5, full_name: 'Ali Karimov' }]).kind, 'ambiguous');
});

test('surname plus initial uniquely matches within a class and never guesses a shared initial', () => {
    const students = [{ id: 1, full_name: 'Nosirov Jobirxon' }, { id: 2, full_name: 'Nosirov Ibrohim' }];
    assert.equal(matchStudent('Nosirov J', students).student.id, 1);
    assert.equal(matchStudent('Nosirov I.', students).student.id, 2);
    assert.equal(matchStudent('Носиров И', students).student.id, 2);
    assert.equal(matchStudent('Nosirov A', students).kind, 'unknown');
    assert.equal(matchStudent('Nosirov I', [...students, { id: 3, full_name: 'Nosirov Islom' }]).kind, 'ambiguous');
});

test('counts attached to a name and common absence suffixes are parsed', () => {
    assert.equal(parseStudentMessage('1A 21/20Adhamov Horun').present, 20);
    assert.deepEqual(parseStudentMessage('6B 19/18\nKelmaganlar:\nOdilov Saidabdurahmon kelmadi').names, ['Odilov Saidabdurahmon']);
});

test('attendance syntax keeps complete multi-word names together', () => {
    assert.deepEqual(parseStudentMessage('6А 21/18\nAli Karimov\nBobur\nOripov').names, ['Ali Karimov', 'Bobur', 'Oripov']);
    assert.equal(parseStudentMessage('6A 21/18').expectedAbsent, 3);
    assert.equal(parseStudentMessage('6A hamma keldi').kind, 'report');
    assert.equal(parseStudentMessage('6A hamma keldi').expectedAbsent, 0);
    assert.deepEqual(parseStudentMessage('6A kelmaganlar: Ali Karimov, Bobur').names, ['Ali Karimov', 'Bobur']);
    assert.deepEqual(parseStudentMessage('6A\nAli Karimov\nBobur').names, ['Ali Karimov', 'Bobur']);
    assert.deepEqual(parseStudentMessage('6A kelmaganlar:\n1. Ali\n2) Bobur').names, ['Ali', 'Bobur']);
    assert.equal(parseStudentMessage('6A Ali keldi').kind, 'keldi');
    assert.equal(parseStudentMessage('6A Ali ketdi').kind, 'ketdi');
    assert.equal(parseStudentMessage('Salom'), null);
});

test('late and leaving transitions are idempotent', () => {
    const late = nextStatus({ status: 'absent', arrived_late: false }, 'keldi');
    assert.deepEqual(late, { status: 'late', arrived_late: true });
    assert.deepEqual(nextStatus(late, 'keldi'), late);
    const left = nextStatus(late, 'ketdi');
    assert.equal(left.status, 'left');
    assert.deepEqual(nextStatus(left, 'ketdi'), left);
    assert.deepEqual(nextStatus(left, 'keldi'), late);
    assert.equal(nextStatus({ status: 'left', arrived_late: false }, 'keldi').status, 'present');
});

test('calendar week starts Monday, including Sunday and year boundaries', () => {
    assert.deepEqual(weekRange('2026-10-17'), { start: '2026-10-12', end: '2026-10-17' });
    assert.equal(weekRange('2026-10-18').start, '2026-10-12');
    assert.equal(weekRange('2027-01-01').start, '2026-12-28');
});

test('rosters require stable unique IDs and full names', () => {
    const data = [{ className: '6A', students: [{ id: '001', fullName: 'Ali Karimov' }] }];
    assert.equal(validateRoster(data, ['6A']), data);
    assert.throws(() => validateRoster([{ ...data[0], students: [{ id: 'x', fullName: 'Ali' }] }], ['6A']));
    assert.throws(() => validateRoster([data[0], data[0]], ['6A']));
    assert.throws(() => validateRoster(data, ['6B']));
});
