import dotenv from 'dotenv';

dotenv.config();

export const config = {
    botToken: process.env.BOT_TOKEN,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    webhookUrl: process.env.WEBHOOK_URL || '',
    port: parseInt(process.env.PORT || '3000', 10),
    timezone: 'Asia/Tashkent',
    
    // Fixed class list
    classes: [
        '1A', '1B',
        '2A', '2B',
        '3A',
        '4A',
        '5A', '5B',
        '6A', '6B',
        '7A',
        '8A', '8B',
        '9A', '9B',
        '10A', '10B',
        '11A'
    ],
    
    // Active hours (Asia/Tashkent time)
    activeHours: {
        start: { hour: 8, minute: 15 },
        end: { hour: 13, minute: 0 }
    },
    
    // Reminder times (after 09:15)
    reminderTimes: [
        { hour: 9, minute: 30 },
        { hour: 9, minute: 45 },
        { hour: 10, minute: 0 }
    ],
    
    // Summary time
    summaryTime: { hour: 9, minute: 15 },
    
    // End of day message time
    endOfDayTime: { hour: 13, minute: 0 }
};

// Validate required environment variables
if (!config.botToken) {
    throw new Error('BOT_TOKEN is required in .env file');
}

if (!config.supabaseUrl) {
    throw new Error('SUPABASE_URL is required in .env file');
}

if (!config.supabaseKey) {
    throw new Error('SUPABASE_KEY is required in .env file');
}

