import fs from 'node:fs/promises';
import { config } from '../src/config.js';
import { getTodayDate, pool } from '../src/database.js';
import { validateRoster, importRoster } from '../src/rosterImport.js';
import { transaction } from '../src/studentAttendance.js';

const path = process.argv[2];
if (!path || path.startsWith('--')) throw new Error('Usage: npm run roster:import -- path/to/roster.json [--apply]');
try {
    const data = validateRoster(JSON.parse(await fs.readFile(path, 'utf8')), config.classes);
    for (const group of data) console.log(`${group.className}: ${group.students.length} students`);
    if (process.argv.includes('--apply')) {
        await transaction(db => importRoster(db, data, getTodayDate()));
        console.log('Official rosters imported. Existing historical records preserved.');
    } else console.log('Validated only. Add --apply to replace the complete roster for each listed class.');
} finally { await pool.end(); }
