import { verifyStudentSetup } from '../src/studentAttendance.js';
import { pool } from '../src/database.js';
try {
    await verifyStudentSetup();
    const { rows } = await pool.query(`SELECT class_name,count(*)::int AS students
        FROM roster_students WHERE active GROUP BY class_name ORDER BY class_name`);
    for (const row of rows) console.log(`${row.class_name}: ${row.students}`);
    console.log('All official rosters are ready for feature activation.');
} finally { await pool.end(); }
