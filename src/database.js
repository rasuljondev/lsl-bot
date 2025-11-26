import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseKey);

/**
 * Get today's date in Asia/Tashkent timezone
 */
export function getTodayDate() {
    const now = new Date();
    const tashkentDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
    const year = tashkentDate.getFullYear();
    const month = String(tashkentDate.getMonth() + 1).padStart(2, '0');
    const day = String(tashkentDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get current time in Asia/Tashkent timezone
 */
export function getTashkentTime() {
    const now = new Date();
    const tashkentTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
    return {
        hour: tashkentTime.getHours(),
        minute: tashkentTime.getMinutes(),
        second: tashkentTime.getSeconds()
    };
}

/**
 * Check if current time is within active hours (08:15 - 13:00)
 */
export function isWithinActiveHours() {
    const time = getTashkentTime();
    const { start, end } = config.activeHours;
    
    const currentMinutes = time.hour * 60 + time.minute;
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Get class total students from database
 */
export async function getClassTotalStudents(className) {
    const { data, error } = await supabase
        .from('classes')
        .select('total_students')
        .eq('class_name', className)
        .single();
    
    if (error || !data) {
        // If class not found, return 0 or use present_count as fallback
        return null;
    }
    
    return data.total_students;
}

/**
 * Upsert attendance record
 */
export async function upsertAttendance(className, presentCount, totalStudents, studentNames) {
    const date = getTodayDate();
    
    const { data, error } = await supabase
        .from('attendance_logs')
        .upsert({
            class_name: className,
            present_count: presentCount,
            total_students: totalStudents,
            student_names: studentNames,
            date: date,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'class_name,date'
        })
        .select()
        .single();
    
    if (error) {
        console.error('Error upserting attendance:', error);
        throw error;
    }
    
    return data;
}

/**
 * Get today's attendance for a specific class
 */
export async function getTodayAttendance(className) {
    const date = getTodayDate();
    
    const { data, error } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq('class_name', className)
        .eq('date', date)
        .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        console.error('Error getting attendance:', error);
        throw error;
    }
    
    return data;
}

/**
 * Get all attendance records for today
 */
export async function getAllTodayAttendance() {
    const date = getTodayDate();
    
    const { data, error } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq('date', date);
    
    if (error) {
        console.error('Error getting all attendance:', error);
        throw error;
    }
    
    return data || [];
}

/**
 * Get classes that haven't submitted attendance today
 */
export async function getMissingClasses() {
    const date = getTodayDate();
    
    const { data, error } = await supabase
        .from('attendance_logs')
        .select('class_name')
        .eq('date', date);
    
    if (error) {
        console.error('Error getting missing classes:', error);
        throw error;
    }
    
    const submittedClasses = new Set((data || []).map(record => record.class_name));
    const missingClasses = config.classes.filter(className => !submittedClasses.has(className));
    
    return missingClasses;
}

/**
 * Calculate totals from all attendance records
 */
export async function calculateTotals() {
    const records = await getAllTodayAttendance();
    
    let totalPresent = 0;
    let totalStudents = 0;
    
    records.forEach(record => {
        totalPresent += record.present_count || 0;
        totalStudents += record.total_students || 0;
    });
    
    const totalAbsent = totalStudents - totalPresent;
    
    return {
        totalPresent,
        totalStudents,
        totalAbsent,
        records
    };
}

