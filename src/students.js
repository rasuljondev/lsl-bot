import { query } from './database.js';

/**
 * Store student names for a class (deduplicated by UNIQUE(class_name, student_name))
 */
export async function storeStudentNames(className, studentNames) {
    if (!studentNames || studentNames.length === 0) {
        return;
    }

    for (const rawName of studentNames) {
        const name = String(rawName).trim();
        if (!name) {
            continue;
        }

        try {
            await query(
                `INSERT INTO students (class_name, student_name, source)
                 VALUES ($1, $2, 'attendance_message')
                 ON CONFLICT (class_name, student_name) DO NOTHING`,
                [className, name]
            );
        } catch (error) {
            console.error(`Error storing student ${name} for ${className}:`, error);
        }
    }
}

/**
 * Get all students for a class
 */
export async function getClassStudents(className) {
    try {
        const rows = await query(
            'SELECT student_name FROM students WHERE class_name = $1 ORDER BY student_name ASC',
            [className]
        );
        return rows.map(row => row.student_name);
    } catch (error) {
        console.error('Error getting class students:', error);
        return [];
    }
}
