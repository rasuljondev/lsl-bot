# Render Deployment Guide

This guide will help you deploy the Telegram Attendance Bot to Render's free tier.

## Prerequisites

1. GitHub account
2. Render account (sign up at https://render.com)
3. Supabase account with database created
4. Telegram bot token from @BotFather

## Step 1: Prepare Your Repository

1. Push your code to GitHub (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/rasuljondev/lsl-bot.git
   git push -u origin main
   ```

## Step 2: Set Up Supabase Database

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the SQL script from `sql/schema.sql` to create tables:
   - Copy the contents of `sql/schema.sql`
   - Paste into SQL Editor
   - Click "Run" to execute
4. Update the `total_students` values in the `classes` table with actual student counts

## Step 3: Create Render Web Service

1. Log in to Render dashboard: https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repository:
   - Select "rasuljondev/lsl-bot" repository
   - Click "Connect"
4. Configure the service:
   - **Name**: `lsl-bot` (or any name you prefer)
   - **Region**: Choose closest to your users
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: Leave empty (root of repo)
   - **Runtime**: `Node`
   - **Build Command**: Leave empty (Render auto-detects)
   - **Start Command**: `npm start`
5. Click "Create Web Service"

## Step 4: Configure Environment Variables

In the Render dashboard, go to your service → "Environment" tab and add:

```
BOT_TOKEN=your_telegram_bot_token
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
WEBHOOK_URL=https://your-service-name.onrender.com
PORT=3000
```

**Important**: 
- Replace `your-service-name` with your actual Render service name
- Get Supabase URL and Key from Supabase dashboard → Settings → API
- Get Bot Token from @BotFather on Telegram

## Step 5: Set Up Webhook

1. Wait for your service to deploy (first deployment takes 2-3 minutes)
2. Once deployed, copy your service URL (e.g., `https://lsl-bot.onrender.com`)
3. Update the `WEBHOOK_URL` environment variable in Render with your actual URL
4. Redeploy the service (or it will auto-redeploy when you save env vars)

The bot will automatically set up the webhook when it starts.

## Step 6: Verify Deployment

1. Check Render logs to ensure the service started successfully
2. Send a test message to your Telegram group
3. The bot should respond if the message format matches

## Step 7: Test the Bot

Send a test attendance message in your Telegram group:
```
9A 30/27 Ali Olimov Bobur Salamov
```

The bot should respond:
```
✅ 9A davomad qabul qilindi: 30/27
```

## Troubleshooting

### Bot not responding
- Check Render logs for errors
- Verify environment variables are set correctly
- Ensure webhook URL is correct and accessible
- Check that the bot has permission to read messages in the group

### Database errors
- Verify Supabase credentials are correct
- Check that tables were created successfully
- Ensure RLS (Row Level Security) policies allow access (if enabled)

### Timezone issues
- The bot uses Asia/Tashkent timezone
- Verify cron jobs are scheduled correctly in logs
- Check that reminders and summary are sent at correct times

### Webhook not working
- Verify the webhook URL is accessible: `https://your-service.onrender.com/health`
- Check that the webhook endpoint is receiving updates (check logs)
- Ensure the bot token in webhook URL matches your BOT_TOKEN

## Monitoring

- **Logs**: View real-time logs in Render dashboard
- **Health Check**: Visit `https://your-service.onrender.com/health`
- **Metrics**: Render provides basic metrics in the dashboard

## Free Tier Limitations

- Service spins down after 15 minutes of inactivity
- First request after spin-down may take 30-60 seconds
- 750 hours/month free (enough for 24/7 operation)
- Consider upgrading if you need guaranteed uptime

## Next Steps

1. Add the bot to your Telegram group
2. Make the bot an admin (optional, for pinning messages)
3. Test attendance submission during active hours (08:15 - 13:00)
4. Monitor the first day to ensure reminders and summary work correctly

## Support

If you encounter issues:
1. Check Render service logs
2. Verify all environment variables
3. Test database connection
4. Check Telegram bot permissions

