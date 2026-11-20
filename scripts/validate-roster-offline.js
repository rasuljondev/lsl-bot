import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../src/config.js';
import { pool, getTodayDate } from '../src/database.js';
import { validateRoster, importRoster } from '../src/rosterImport.js';
import { verifyStudentSetup } from '../src/studentAttendance.js';
import { matchStudent } from '../src/studentMatching.js';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/validate-roster-offline.js path/to/roster.json');
const data = validateRoster(JSON.parse(await fs.readFile(source, 'utf8')), config.classes);
const db = new PGlite();
const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
};
pool.query = query;
try {
    await db.exec(await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
    await db.exec(await fs.readFile(new URL('../sql/migrations/002_student_attendance.sql', import.meta.url), 'utf8'));
    await db.exec(await fs.readFile(new URL('../sql/migrations/003_attendance_minutes.sql', import.meta.url), 'utf8'));
    await db.exec(await fs.readFile(new URL('../sql/migrations/004_partial_attendance.sql', import.meta.url), 'utf8'));
    await db.exec(await fs.readFile(new URL('../sql/migrations/005_roster_changes.sql', import.meta.url), 'utf8'));
    await db.exec('BEGIN');
    await importRoster({ query }, data, getTodayDate());
    await db.exec('COMMIT');
    await verifyStudentSetup();
    const students = (await query('SELECT * FROM roster_students WHERE active')).rows;
    assert.equal(students.length, data.reduce((sum, g) => sum + g.students.length, 0));
    for (const s of students) {
        const result = matchStudent(s.full_name, students.filter(other => other.class_name === s.class_name));
        assert.equal(result.student?.id, s.id, `Canonical full name is ambiguous in ${s.class_name}`);
    }
    const counts = (await query('SELECT count(*)::int AS classes,sum(total_students)::int AS students FROM classes')).rows[0];
    console.log(JSON.stringify({ validated: true, ...counts, canonicalMatches: students.length, database: 'isolated PostgreSQL; no production access' }));
} finally { await db.close(); await pool.end(); }
