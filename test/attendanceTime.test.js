import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalTiming, messageInstant, tashkentClock, withTiming, missedMinutes } from '../src/attendanceTime.js';

test('lateness uses 08:30 Tashkent, independent of the server timezone', () => {
    assert.deepEqual(tashkentClock('2026-10-22T03:45:00Z'), { date: '2026-10-22', time: '08:45', minutes: 525 });
    assert.equal(arrivalTiming('2026-10-22T03:29:00Z').lateMinutes, 0);
    assert.equal(arrivalTiming('2026-10-22T03:30:00Z').late, false);
    assert.equal(arrivalTiming('2026-10-22T03:45:00Z').lateMinutes, 15);
    assert.equal(arrivalTiming('2026-10-22T04:00:00Z').lateMinutes, 30);
    assert.equal(arrivalTiming('2026-10-22T03:30:59Z').lateMinutes, 0);
});

test('original Telegram time survives processing delays; old dates and future messages are rejected', () => {
    const now = new Date('2026-10-22T04:00:00Z');
    assert.equal(messageInstant({ date: Date.parse('2026-10-22T03:45:00Z') / 1000 }, '2026-10-22', now), '2026-10-22T03:45:00.000Z');
    assert.throws(() => messageInstant({ date: Date.parse('2026-10-21T03:45:00Z') / 1000 }, '2026-10-22', now));
    assert.throws(() => messageInstant({ date: Date.parse('2026-10-22T05:00:00Z') / 1000 }, '2026-10-22', now));
});

test('full-day absence is bounded to 08:30–16:00 and does not invent historical times', () => {
    const absent = { date: '2026-10-22', ...withTiming(null, { status: 'absent', arrived_late: false }, 'absent', '2026-10-22T04:00:00Z', '2026-10-22') };
    assert.equal(missedMinutes(absent, new Date('2026-10-22T03:00:00Z')), 0);
    assert.equal(missedMinutes(absent, new Date('2026-10-22T04:00:00Z')), 30);
    assert.equal(missedMinutes(absent, new Date('2026-10-22T12:00:00Z')), 450);
    assert.equal(missedMinutes({ date: '2026-10-21', missing_intervals: [], timing_complete: false }), null);
});

test('late arrivals and multiple departure/return intervals accumulate exactly once', () => {
    const date = '2026-10-22';
    let row = { date, ...withTiming(null, { status: 'absent', arrived_late: false }, 'absent', `${date}T03:00:00Z`, date) };
    row = { ...row, ...withTiming(row, { status: 'late', arrived_late: true }, 'keldi', `${date}T03:45:00Z`, date) };
    assert.equal(row.late_minutes, 15);
    row = { ...row, ...withTiming(row, { status: 'left', arrived_late: true }, 'ketdi', `${date}T05:00:00Z`, date) };
    row = { ...row, ...withTiming(row, { status: 'late', arrived_late: true }, 'keldi', `${date}T05:20:00Z`, date) };
    assert.equal(missedMinutes(row, new Date(`${date}T06:00:00Z`)), 35);
    row = { ...row, ...withTiming(row, { status: 'left', arrived_late: true }, 'ketdi', `${date}T09:00:00Z`, date) };
    assert.equal(missedMinutes(row, new Date(`${date}T09:15:00Z`)), 50);
    assert.equal(missedMinutes(row, new Date(`${date}T11:00:00Z`)), 155);
    assert.throws(() => withTiming(row, { status: 'late', arrived_late: true }, 'keldi', `${date}T08:00:00Z`, date));
});

test('arrival before 08:30 is present and has no late minutes', () => {
    const date = '2026-10-22';
    const absent = { status: 'absent', arrived_late: false, missing_intervals: [], timing_complete: false };
    const arrived = { date, ...withTiming(absent, { status: 'late', arrived_late: true }, 'keldi', `${date}T03:20:00Z`, date) };
    assert.equal(arrived.status, 'present');
    assert.equal(arrived.arrived_late, false);
    assert.equal(arrived.late_minutes, 0);
    assert.equal(missedMinutes(arrived, new Date(`${date}T11:00:00Z`)), 0);
});
