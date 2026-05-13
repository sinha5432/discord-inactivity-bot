const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Initialize SQLite database
const db = new sqlite3.Database('./inactivity.db', (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to SQLite database');
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS user_activity (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER DEFAULT 0,
      guild_id TEXT
    )
  `);
});

// Update user activity when they send a message
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  
  const userId = message.author.id;
  const username = message.author.username;
  const guildId = message.guild?.id;

  db.run(
    `INSERT INTO user_activity (user_id, username, last_activity, guild_id)
     VALUES (?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(user_id) DO UPDATE SET
     last_activity = CURRENT_TIMESTAMP,
     message_count = message_count + 1`,
    [userId, username, guildId],
    (err) => {
      if (err) console.error('Error updating activity:', err.message);
    }
  );
});

// Update activity for voice interactions
client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.member?.id;
  const username = newState.member?.user?.username;
  const guildId = newState.guild?.id;

  if (!userId) return;

  // Update if user joined or switched channels
  if (!oldState.channel && newState.channel) {
    db.run(
      `INSERT INTO user_activity (user_id, username, last_activity, guild_id)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?)
       ON CONFLICT(user_id) DO UPDATE SET
       last_activity = CURRENT_TIMESTAMP`,
      [userId, username, guildId],
      (err) => {
        if (err) console.error('Error updating voice activity:', err.message);
      }
    );
  }
});

// Command to check inactive users
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  // Check for !inactive command
  if (message.content.startsWith('!inactive')) {
    const parts = message.content.split(' ');
    const days = parseInt(parts[1]) || 30;

    if (!message.member?.permissions.has('ManageGuild')) {
      return message.reply('❌ You need ManageGuild permission to use this command.');
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    db.all(
      `SELECT user_id, username, last_activity, message_count
       FROM user_activity
       WHERE guild_id = ? AND last_activity < ?
       ORDER BY last_activity ASC`,
      [message.guild.id, cutoffDate.toISOString()],
      async (err, rows) => {
        if (err) {
          return message.reply('Error fetching data: ' + err.message);
        }

        if (!rows || rows.length === 0) {
          return message.reply(`✅ No inactive users found in the past ${days} days!`);
        }

        // Fetch guild members to verify they're still in the server
        let embed = {
          color: 0xFF6B6B,
          title: `Inactive Users (${days} days)`,
          description: `Found **${rows.length}** inactive user(s)`,
          fields: [],
          timestamp: new Date(),
        };

        // Limit to 25 fields per embed
        const displayRows = rows.slice(0, 25);
        for (const row of displayRows) {
          const lastActivity = new Date(row.last_activity);
          const daysInactive = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
          
          embed.fields.push({
            name: `${row.username} (${row.user_id})`,
            value: `Last active: ${daysInactive} days ago\nMessages: ${row.message_count}`,
            inline: false,
          });
        }

        if (rows.length > 25) {
          embed.footer = { text: `Showing 25 of ${rows.length} inactive users` };
        }

        message.reply({ embeds: [embed] });
      }
    );
  }

  // Command to check activity stats
  if (message.content.startsWith('!stats')) {
    if (!message.member?.permissions.has('ManageGuild')) {
      return message.reply('❌ You need ManageGuild permission to use this command.');
    }

    db.all(
      `SELECT COUNT(*) as total_tracked,
              COUNT(CASE WHEN last_activity > datetime('now', '-30 days') THEN 1 END) as active_30d,
              COUNT(CASE WHEN last_activity > datetime('now', '-7 days') THEN 1 END) as active_7d
       FROM user_activity
       WHERE guild_id = ?`,
      [message.guild.id],
      (err, rows) => {
        if (err) {
          return message.reply('Error fetching stats: ' + err.message);
        }

        const stats = rows[0];
        const embed = {
          color: 0x4CAF50,
          title: 'Activity Statistics',
          fields: [
            { name: 'Total Tracked Users', value: stats.total_tracked.toString(), inline: true },
            { name: 'Active in 7 days', value: stats.active_7d.toString(), inline: true },
            { name: 'Active in 30 days', value: stats.active_30d.toString(), inline: true },
            { name: 'Inactive (30+ days)', value: (stats.total_tracked - stats.active_30d).toString(), inline: true },
          ],
          timestamp: new Date(),
        };

        message.reply({ embeds: [embed] });
      }
    );
  }
});

client.on('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
});

client.on('error', (error) => {
  console.error('Client error:', error);
});

process.on('SIGINT', () => {
  console.log('Closing database and bot...');
  db.close();
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
