# Discord Inactivity Bot

A Discord bot that tracks user activity and identifies inactive members who haven't interacted in the past 30 days.

## Features

- **Activity Tracking**: Monitors messages and voice channel participation
- **SQLite Database**: Stores user activity data locally
- **Inactive Users Command**: List all users inactive for a specified number of days
- **Activity Statistics**: View overall server activity statistics

## Setup

### 1. Prerequisites
- Node.js 16+
- A Discord bot application

### 2. Create Discord Bot
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Go to "Bot" and click "Add Bot"
4. Copy the token and add it to your `.env` file as `DISCORD_TOKEN`
5. Under "Intents", enable:
   - Server Members Intent
   - Message Content Intent
6. Go to OAuth2 → URL Generator
7. Select scopes: `bot`
8. Select permissions:
   - Send Messages
   - Embed Links
   - Read Message History
9. Copy the generated URL and invite your bot to your server

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment
Create a `.env` file in the root directory:
```
DISCORD_TOKEN=your_bot_token_here
```

### 5. Run the Bot
```bash
node index.js
```

## Commands

### `!inactive [days]`
Shows users who haven't interacted in the specified number of days (default: 30)

**Usage:**
```
!inactive          # Shows users inactive for 30+ days
!inactive 7        # Shows users inactive for 7+ days
!inactive 60       # Shows users inactive for 60+ days
```

**Requirements:** ManageGuild permission

### `!stats`
Displays server activity statistics

**Output:**
- Total tracked users
- Active in last 7 days
- Active in last 30 days
- Completely inactive (30+ days)

**Requirements:** ManageGuild permission

## Activity Tracked

The bot logs activity for:
- **Messages**: Text messages in any channel
- **Voice**: Joining voice channels
- **Reactions**: Message reactions (can be added)

## Database

The bot uses SQLite to store data in `inactivity.db` with the following schema:

```sql
CREATE TABLE user_activity (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  last_activity DATETIME,
  message_count INTEGER,
  guild_id TEXT
)
```

## Example Output

**!inactive command:**
```
Inactive Users (30 days)
Found 5 inactive user(s)

john_doe (123456789)
Last active: 45 days ago
Messages: 12

jane_smith (987654321)
Last active: 35 days ago
Messages: 5
```

**!stats command:**
```
Activity Statistics

Total Tracked Users: 150
Active in 7 days: 120
Active in 30 days: 135
Inactive (30+ days): 15
```

## Notes

- Bot requires permission to send messages and embed links
- Activity data is stored locally in SQLite
- Data persists between bot restarts
- Only users with ManageGuild permission can run commands

## Troubleshooting

**Bot doesn't respond:**
- Ensure `DISCORD_TOKEN` is set correctly in `.env`
- Check bot has MESSAGE_CONTENT intent enabled
- Verify bot has necessary permissions in the server

**Database errors:**
- Ensure write permissions in the bot directory
- Try deleting `inactivity.db` to reset the database

**"You need ManageGuild permission" error:**
- Only server admins can run the commands
