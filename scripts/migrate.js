import fs from 'node:fs/promises';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const migrations = ['002_student_attendance.sql', '003_attendance_minutes.sql', '004_partial_attendance.sql'];
if (!process.argv.includes('--apply')) {
    console.log('Dry run: additive student-attendance migration. Existing attendance and names are preserved.');
    console.log('Run npm run db:migrate -- --apply to apply to DATABASE_URL.');
} else {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try {
        await db.connect();
        for (const file of migrations) {
            await db.query(await fs.readFile(new URL('../sql/migrations/' + file, import.meta.url), 'utf8'));
        }
        console.log('Student-attendance and minute-tracking migrations applied.');
    }
    finally { await db.end(); }
}
