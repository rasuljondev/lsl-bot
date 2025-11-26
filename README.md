# Telegram Attendance Bot

A Telegram bot for tracking daily student attendance at LSL School. The bot parses attendance messages from teachers, tracks daily statistics, sends reminders, and generates summaries.

## Features

- 📝 Parse attendance messages in format: `<ClassName> <presentCount>/<totalCount> <Student1> <Student2> ...`
- ⏰ Active during school hours (08:15 - 13:00 Asia/Tashkent time)
- 🔔 Automatic reminders for missing classes (09:30, 09:45, 10:00)
- 📊 Daily summary at 09:15 with totals and absent students
- ✅ Late updates: Handle "keldi" (came) and "ketdi" (left) messages until 13:00
- 💾 Store all data in Supabase PostgreSQL database
- 🌍 Timezone-aware scheduling (Asia/Tashkent)

## Tech Stack

- **Framework**: Telegraf (Node.js)
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Render (Webhook mode)
- **Scheduling**: node-cron

## Setup

### Prerequisites

- Node.js 18+ installed
- Supabase account and project
- Telegram bot token from @BotFather
- Render account (for deployment)

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/rasuljondev/lsl-bot.git
   cd lsl-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your credentials:
   - `BOT_TOKEN`: Your Telegram bot token
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_KEY`: Your Supabase anon key
   - `WEBHOOK_URL`: Leave empty for local development

4. Set up database:
   - Go to Supabase SQL Editor
   - Run the SQL script from `sql/schema.sql`
   - Update `total_students` values in `classes` table

5. Run the bot:
   ```bash
   npm start
   ```
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

### Deployment

See [Render.md](./Render.md) for detailed deployment instructions.

## Usage

### Attendance Message Format

Teachers send messages in this format:
```
9A 30/27 Ali Olimov Bobur Salamov Bek Oripov
```

Where:
- `9A` = Class name
- `30` = Present count
- `27` = Total students in class
- `Ali Olimov Bobur Salamov Bek Oripov` = List of present students (optional)

### Late Updates

After 09:15, teachers can send:
```
9A Jobirxon keldi    # Student came
9A Jobirxon ketdi    # Student left
```

## Fixed Classes

The bot supports 18 fixed classes:
- 1A, 1B
- 2A, 2B
- 3A
- 4A
- 5A, 5B
- 6A, 6B
- 7A
- 8A, 8B
- 9A, 9B
- 10A, 10B
- 11A

## Schedule

- **Active Hours**: 13:00 - 16:00 (Asia/Tashkent)
- **Reminders**: 14:30, 14:45, 15:00
- **Daily Summary**: 14:15
- **End of Day**: 16:00

## Database Schema

### Tables

- `classes`: Stores class information and total student counts
- `attendance_logs`: Stores daily attendance records

See `sql/schema.sql` for full schema.

## Project Structure

```
lsl-bot/
├── src/
│   ├── bot.js           # Main bot initialization
│   ├── attendance.js    # Attendance parsing & storage
│   ├── reminders.js     # Reminder logic
│   ├── summary.js       # Daily summary generation
│   ├── lateUpdates.js   # Late update handling
│   ├── scheduler.js     # Cron job setup
│   ├── database.js      # Database operations
│   └── config.js        # Configuration
├── sql/
│   └── schema.sql       # Database schema
├── Render.md            # Deployment guide
├── .env.example         # Environment template
├── package.json         # Dependencies
└── README.md            # This file
```

## Environment Variables

- `BOT_TOKEN`: Telegram bot token
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase anon key
- `WEBHOOK_URL`: Webhook URL for Render (optional for local dev)
- `PORT`: Server port (default: 3000)

## License

ISC

