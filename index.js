const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
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

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('inactive')
    .setDescription('Show users inactive for the specified number of days')
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('Number of days (default: 30)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show activity statistics for your server'),
  new SlashCommandBuilder()
    .setName('all-users')
    .setDescription('[DEBUG] Show all tracked users in database'),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);

  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map(cmd => cmd.toJSON()),
    });
    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error('Error registering commands:', error);
  }

  // Scan all guilds for message history
  console.log('\n🔍 Scanning server message history...');
  for (const guild of client.guilds.cache.values()) {
    console.log(`\n📍 Processing guild: ${guild.name} (${guild.id})`);
    
    const channels = await guild.channels.fetch();
    let totalMessages = 0;

    for (const channel of channels.values()) {
      // Only process text channels
      if (channel.type !== 0) continue;
      
      // Check if bot has permission to read messages
      if (!channel.permissionsFor(client.user).has('ViewChannel')) continue;
      if (!channel.permissionsFor(client.user).has('ReadMessageHistory')) continue;

      try {
        console.log(`  📄 Scanning #${channel.name}...`);
        let lastMessageId = null;
        let batchCount = 0;

        // Fetch messages in batches (100 at a time, up to 1000 messages per channel)
        while (batchCount < 10) {
          const options = { limit: 100 };
          if (lastMessageId) options.before = lastMessageId;

          const messages = await channel.messages.fetch(options);
          if (messages.size === 0) break;

          for (const message of messages.values()) {
            if (message.author.bot) continue;

            const userId = message.author.id;
            const username = message.author.username;
            const guildId = guild.id;
            const messageTime = message.createdTimestamp;

            db.run(
              `INSERT INTO user_activity (user_id, username, last_activity, guild_id, message_count)
               VALUES (?, ?, datetime(?, 'unixepoch'), ?, 1)
               ON CONFLICT(user_id) DO UPDATE SET
               last_activity = MAX(last_activity, datetime(?, 'unixepoch')),
               message_count = message_count + 1`,
              [userId, username, Math.floor(messageTime / 1000), guildId, Math.floor(messageTime / 1000)],
              (err) => {
                if (err) console.error('Error updating activity:', err.message);
              }
            );

            totalMessages++;
          }

          lastMessageId = messages.last().id;
          batchCount++;
        }

        console.log(`    ✓ Found ${totalMessages} messages in #${channel.name}`);
      } catch (error) {
        console.log(`    ✗ Could not scan #${channel.name}: ${error.message}`);
      }
    }

    console.log(`\n  Total messages scanned in ${guild.name}: ${totalMessages}`);
  }

  // Print all tracked users after scanning
  console.log('\n📊 === All Users Found in Server ===');
  setTimeout(() => {
    db.all(
      `SELECT user_id, username, last_activity, message_count FROM user_activity ORDER BY last_activity DESC`,
      (err, rows) => {
        if (err) {
          console.error('Error fetching users:', err.message);
        } else if (!rows || rows.length === 0) {
          console.log('No users found');
        } else {
          console.log(`Total users found: ${rows.length}\n`);
          rows.forEach((row, index) => {
            const lastActivity = new Date(row.last_activity);
            const daysInactive = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
            console.log(`${index + 1}. ${row.username} (ID: ${row.user_id})`);
            console.log(`   Last active: ${lastActivity.toLocaleString()} (${daysInactive} days ago)`);
            console.log(`   Messages: ${row.message_count}\n`);
          });
        }
        console.log('=================================\n');
      }
    );
  }, 2000);
});

// Handle slash command interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'inactive') {
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({
        content: '❌ You need ManageGuild permission to use this command.',
        ephemeral: true,
      });
    }

    const days = interaction.options.getInteger('days') || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    await interaction.deferReply();

    db.all(
      `SELECT user_id, username, last_activity, message_count
       FROM user_activity
       WHERE guild_id = ? AND last_activity < ?
       ORDER BY last_activity ASC`,
      [interaction.guildId, cutoffDate.toISOString()],
      async (err, rows) => {
        if (err) {
          return interaction.editReply({
            content: 'Error fetching data: ' + err.message,
          });
        }

        if (!rows || rows.length === 0) {
          return interaction.editReply({
            content: `✅ No inactive users found in the past ${days} days!`,
          });
        }

        let embed = {
          color: 0xFF6B6B,
          title: `Inactive Users (${days} days)`,
          description: `Found **${rows.length}** inactive user(s)`,
          fields: [],
          timestamp: new Date(),
        };

        const displayRows = rows.slice(0, 25);
        for (const row of displayRows) {
          const lastActivity = new Date(row.last_activity);
          const daysInactive = Math.floor(
            (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
          );

          embed.fields.push({
            name: `${row.username} (${row.user_id})`,
            value: `Last active: ${daysInactive} days ago\nMessages: ${row.message_count}`,
            inline: false,
          });
        }

        if (rows.length > 25) {
          embed.footer = { text: `Showing 25 of ${rows.length} inactive users` };
        }

        interaction.editReply({ embeds: [embed] });
      }
    );
  }

  if (commandName === 'stats') {
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({
        content: '❌ You need ManageGuild permission to use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    db.all(
      `SELECT COUNT(*) as total_tracked,
              COUNT(CASE WHEN last_activity > datetime('now', '-30 days') THEN 1 END) as active_30d,
              COUNT(CASE WHEN last_activity > datetime('now', '-7 days') THEN 1 END) as active_7d
       FROM user_activity
       WHERE guild_id = ?`,
      [interaction.guildId],
      (err, rows) => {
        if (err) {
          return interaction.editReply({
            content: 'Error fetching stats: ' + err.message,
          });
        }

        const stats = rows[0];
        const embed = {
          color: 0x4CAF50,
          title: 'Activity Statistics',
          fields: [
            {
              name: 'Total Tracked Users',
              value: stats.total_tracked.toString(),
              inline: true,
            },
            {
              name: 'Active in 7 days',
              value: stats.active_7d.toString(),
              inline: true,
            },
            {
              name: 'Active in 30 days',
              value: stats.active_30d.toString(),
              inline: true,
            },
            {
              name: 'Inactive (30+ days)',
              value: (stats.total_tracked - stats.active_30d).toString(),
              inline: true,
            },
          ],
          timestamp: new Date(),
        };

        interaction.editReply({ embeds: [embed] });
      }
    );
  }

  if (commandName === 'all-users') {
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({
        content: '❌ You need ManageGuild permission to use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    db.all(
      `SELECT user_id, username, last_activity, message_count
       FROM user_activity
       WHERE guild_id = ?
       ORDER BY last_activity DESC`,
      [interaction.guildId],
      (err, rows) => {
        if (err) {
          return interaction.editReply({
            content: 'Error fetching users: ' + err.message,
          });
        }

        if (!rows || rows.length === 0) {
          return interaction.editReply({
            content: '📭 No tracked users in database yet. Users are tracked as they send messages or join voice channels.',
          });
        }

        let embed = {
          color: 0x3498DB,
          title: `All Tracked Users (${rows.length} total)`,
          description: `Guild ID: ${interaction.guildId}`,
          fields: [],
          timestamp: new Date(),
        };

        const displayRows = rows.slice(0, 25);
        for (const row of displayRows) {
          const lastActivity = new Date(row.last_activity);
          const daysInactive = Math.floor(
            (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
          );

          embed.fields.push({
            name: `${row.username} (${row.user_id})`,
            value: `Last active: ${lastActivity.toLocaleString()} (${daysInactive} days ago)\nMessages: ${row.message_count}`,
            inline: false,
          });
        }

        if (rows.length > 25) {
          embed.footer = { text: `Showing 25 of ${rows.length} tracked users` };
        }

        interaction.editReply({ embeds: [embed] });
      }
    );
  }
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
