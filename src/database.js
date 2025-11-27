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

/**
 * Get daily total for a specific date
 */
export async function getDailyTotal(date) {
    const { data, error } = await supabase
        .from('daily_totals')
        .select('total_students')
        .eq('date', date)
        .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        console.error('Error getting daily total:', error);
        return null;
    }
    
    return data ? data.total_students : null;
}

/**
 * Update daily total for a specific date
 */
export async function updateDailyTotal(date, total) {
    const { data, error } = await supabase
        .from('daily_totals')
        .upsert({
            date: date,
            total_students: total,
            calculated_at: new Date().toISOString()
        }, {
            onConflict: 'date'
        })
        .select()
        .single();
    
    if (error) {
        console.error('Error updating daily total:', error);
        throw error;
    }
    
    return data;
}

/**
 * Get dynamic total for today or calculate from yesterday
 * Today: Use 323 (hardcoded)
 * Tomorrow+: Use yesterday's total if all classes submitted yesterday
 */
export async function getDynamicTotal() {
    const today = getTodayDate();
    
    // For today, use hardcoded 323
    const todayDate = new Date(today);
    const now = new Date();
    const tashkentDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
    const todayLocal = new Date(tashkentDate.getFullYear(), tashkentDate.getMonth(), tashkentDate.getDate());
    
    // Check if it's the first day (today) - use 323
    // For simplicity, we'll check if daily_totals table is empty or today's entry doesn't exist
    const todayTotal = await getDailyTotal(today);
    
    if (todayTotal !== null) {
        return todayTotal;
    }
    
    // First time today - check if we should use yesterday's total
    // Calculate yesterday's date
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    
    // Check if all classes submitted yesterday
    const { data: yesterdayRecords, error } = await supabase
        .from('attendance_logs')
        .select('class_name')
        .eq('date', yesterdayStr);
    
    if (error) {
        console.error('Error checking yesterday records:', error);
        // Use 323 as default
        await updateDailyTotal(today, 323);
        return 323;
    }
    
    const submittedClasses = new Set((yesterdayRecords || []).map(r => r.class_name));
    const allSubmitted = config.classes.every(className => submittedClasses.has(className));
    
    if (allSubmitted && yesterdayRecords && yesterdayRecords.length > 0) {
        // Calculate total from yesterday's submitted students
        const { data: yesterdayAttendance } = await supabase
            .from('attendance_logs')
            .select('total_students')
            .eq('date', yesterdayStr);
        
        if (yesterdayAttendance && yesterdayAttendance.length > 0) {
            const yesterdayTotal = yesterdayAttendance.reduce((sum, record) => sum + (record.total_students || 0), 0);
            if (yesterdayTotal > 0) {
                await updateDailyTotal(today, yesterdayTotal);
                return yesterdayTotal;
            }
        }
    }
    
    // Default: use 323 for today
    await updateDailyTotal(today, 323);
    return 323;
}

