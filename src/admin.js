import { config } from './config.js';
import { supabase, getTodayDate } from './database.js';

/**
 * Check if user is owner
 */
export function isOwner(userId) {
    return userId === config.ownerUserId;
}

/**
 * Clean today's attendance data
 */
export async function cleanTodayData() {
    const date = getTodayDate();
    
    const { error } = await supabase
        .from('attendance_logs')
        .delete()
        .eq('date', date);
    
    if (error) {
        console.error('Error cleaning today data:', error);
        return { success: false, message: 'Failed to clean data' };
    }
    
    return { success: true, message: 'Today\'s data cleaned successfully' };
}

/**
 * Generate daily report
 */
export async function generateDailyReport(date = null) {
    const reportDate = date || getTodayDate();
    
    const { data: records, error } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq('date', reportDate);
    
    if (error) {
        console.error('Error generating daily report:', error);
        return { success: false, message: 'Failed to generate report' };
    }
    
    // Calculate totals for this specific date
    let totalStudents = 0;
    let totalPresent = 0;
    
    if (records && records.length > 0) {
        records.forEach(record => {
            totalStudents += record.total_students || 0;
            totalPresent += record.present_count || 0;
        });
    }
    
    let report = `📊 Kunlik hisobot (${reportDate})\n\n`;
    
    if (records && records.length > 0) {
        // Sort by class name to maintain order
        const sortedRecords = records.sort((a, b) => {
            const classOrder = config.classes.indexOf(a.class_name) - config.classes.indexOf(b.class_name);
            return classOrder !== -1 ? classOrder : a.class_name.localeCompare(b.class_name);
        });
        
        sortedRecords.forEach(record => {
            // Format: total/present
            report += `${record.class_name}: ${record.total_students}/${record.present_count}\n`;
        });
    } else {
        report += 'Hech qanday ma\'lumot topilmadi.\n';
    }
    
    const totalAbsent = totalStudents - totalPresent;
    report += `\nJami: ${totalStudents}/${totalPresent}`;
    
    if (totalAbsent > 0) {
        report += `\nKelmaganlar: ${totalAbsent}`;
    }
    
    return { success: true, report };
}

/**
 * Generate weekly report
 */
export async function generateWeeklyReport(startDate, endDate) {
    const { data: records, error } = await supabase
        .from('attendance_logs')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });
    
    if (error) {
        console.error('Error generating weekly report:', error);
        return { success: false, message: 'Failed to generate report' };
    }
    
    // Group by date and calculate averages
    const dateMap = new Map();
    
    records.forEach(record => {
        if (!dateMap.has(record.date)) {
            dateMap.set(record.date, { total: 0, present: 0, count: 0 });
        }
        const day = dateMap.get(record.date);
        day.total += record.total_students;
        day.present += record.present_count;
        day.count += 1;
    });
    
    let report = `📊 Haftalik hisobot (${startDate} - ${endDate})\n\n`;
    
    let totalDays = 0;
    let totalStudents = 0;
    let totalPresent = 0;
    
    dateMap.forEach((day, date) => {
        // Format: total/present
        const dayAbsent = day.total - day.present;
        report += `${date}: ${day.total}/${day.present}`;
        if (dayAbsent > 0) {
            report += ` (Kelmaganlar: ${dayAbsent})`;
        }
        report += `\n`;
        totalDays += 1;
        totalStudents += day.total;
        totalPresent += day.present;
    });
    
    if (totalDays > 0) {
        const avgPresent = Math.round(totalPresent / totalDays);
        const avgTotal = Math.round(totalStudents / totalDays);
        const totalAbsent = totalStudents - totalPresent;
        report += `\nO'rtacha: ${avgTotal}/${avgPresent}`;
        report += `\nJami: ${totalStudents}/${totalPresent}`;
        if (totalAbsent > 0) {
            report += `\nKelmaganlar: ${totalAbsent}`;
        }
    }
    
    return { success: true, report };
}

/**
 * Generate monthly report
 */
export async function generateMonthlyReport(month, year) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    // Get last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    const result = await generateWeeklyReport(startDate, endDate);
    
    // Update title for monthly report
    if (result.success) {
        result.report = result.report.replace('📊 Haftalik hisobot', '📊 Oylik hisobot');
    }
    
    return result;
}

