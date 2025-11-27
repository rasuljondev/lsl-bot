import { supabase } from './database.js';

/**
 * Store student names for a class
 */
export async function storeStudentNames(className, studentNames) {
    if (!studentNames || studentNames.length === 0) {
        return;
    }

    // Insert student names (ignore duplicates due to UNIQUE constraint)
    const inserts = studentNames.map(name => ({
        class_name: className,
        student_name: name.trim(),
        source: 'attendance_message'
    }));

    // Use upsert to handle duplicates gracefully
    for (const student of inserts) {
        const { error } = await supabase
            .from('students')
            .upsert(student, {
                onConflict: 'class_name,student_name',
                ignoreDuplicates: false
            });

        if (error && error.code !== '23505') { // 23505 = unique violation (expected)
            console.error(`Error storing student ${student.student_name} for ${className}:`, error);
        }
    }
}

/**
 * Get all students for a class
 */
export async function getClassStudents(className) {
    const { data, error } = await supabase
        .from('students')
        .select('student_name')
        .eq('class_name', className)
        .order('student_name', { ascending: true });

    if (error) {
        console.error('Error getting class students:', error);
        return [];
    }

    return (data || []).map(row => row.student_name);
}

/**
 * Calculate total students from all stored students in database
 */
export async function getTotalStudentsFromDatabase() {
    const { data, error } = await supabase
        .from('students')
        .select('class_name', { count: 'exact' });

    if (error) {
        console.error('Error calculating total from students:', error);
        return null;
    }

    // Count distinct students per class, then sum
    const { data: classCounts, error: countError } = await supabase
        .from('students')
        .select('class_name')
        .select('student_name', { count: 'exact', head: false });

    // Better approach: count distinct (class_name, student_name) pairs
    const { count, error: distinctError } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true });

    if (distinctError) {
        console.error('Error counting students:', distinctError);
        return null;
    }

    return count || 0;
}

/**
 * Get total students count by summing unique students per class
 */
export async function calculateTotalFromStudents() {
    // Get all classes and count students per class
    const { data: students, error } = await supabase
        .from('students')
        .select('class_name, student_name');

    if (error) {
        console.error('Error getting students for total calculation:', error);
        return null;
    }

    if (!students || students.length === 0) {
        return 0;
    }

    // Count unique students per class
    const classStudentCounts = new Map();
    students.forEach(student => {
        const key = `${student.class_name}_${student.student_name}`;
        if (!classStudentCounts.has(key)) {
            classStudentCounts.set(key, true);
        }
    });

    return classStudentCounts.size;
}

