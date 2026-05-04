const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// GuildMembers intent is required to search for users across guilds
const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => console.log(`🤖 Bot logged in as ${client.user.tag}`));
client.login(process.env.DISCORD_BOT_TOKEN).catch(err => console.error('Bot login error:', err));

/**
 * Send professional key delivery embed.
 */
module.exports.sendDiscordDM = async (discordId, key, expiryDate, orderId) => {
  try {
    const user = await client.users.fetch(discordId);
    if (!user) return console.error('User not found');

    const shopName = process.env.SHOP_NAME || 'Key Shop';
    const shopUrl = process.env.SHOP_URL || 'http://localhost:5000';
    const supportServer = process.env.DISCORD_SUPPORT_SERVER || 'https://discord.gg/2fyTyCPZJP';

    const embed = new EmbedBuilder()
      .setColor('#ef1f1f')
      .setTitle(`🎉 License Key Activated`)
      .setDescription(`Thank you for purchasing from **${shopName}**! Here are your key details:`)
      .addFields(
        { name: '🔑 License Key', value: `\`${key}\`` },
        { name: '📅 Expires On', value: new Date(expiryDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) },
        { name: '🔗 Quick Actions', value: `[Renew Key](${shopUrl}/shop/renew/${orderId}) | [Support Server](${supportServer})` },
        { name: '🧾 Invoice', value: `[Download Invoice](${shopUrl}/shop/invoice/${orderId})` }
      )
      .setTimestamp();

    const logoUrl = process.env.SHOP_LOGO_URL;
    if (logoUrl && logoUrl.trim().length > 0) {
      embed.setFooter({ text: `${shopName} · Automated Delivery`, iconURL: logoUrl });
    } else {
      embed.setFooter({ text: `${shopName} · Automated Delivery` });
    }

    await user.send({ embeds: [embed] });
    console.log(`✅ Embed sent to ${discordId}`);
  } catch (err) {
    console.error(`❌ Failed to send DM to ${discordId}:`, err.message);
    console.error('Full error:', err);
  }
};

/**
 * Send DM by username (same embed).
 */
module.exports.sendDiscordDMByUsername = async (username, key, expiryDate, orderId) => {
  try {
    const user = client.users.cache.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      console.log(`❌ User ${username} not found in cache.`);
      return;
    }
    await module.exports.sendDiscordDM(user.id, key, expiryDate, orderId);
  } catch (err) {
    console.error(`❌ Failed DM to ${username}:`, err.message);
  }
};

/**
 * Send a professional welcome DM after login.
 */
module.exports.sendWelcomeDM = async (discordId, username) => {
  try {
    const user = await client.users.fetch(discordId);
    if (!user) return console.error('User not found for welcome DM');

    const shopName = process.env.SHOP_NAME || 'Key Shop';
    const shopUrl = process.env.SHOP_URL || 'http://localhost:5000';
    const supportServer = process.env.DISCORD_SUPPORT_SERVER || 'https://discord.gg/2fyTyCPZJP';

    const embed = new EmbedBuilder()
      .setColor('#ef1f1f')
      .setTitle(`👋 Welcome to ${shopName}, ${username || 'User'}!`)
      .setDescription(`You're now logged in and ready to purchase license keys.`)
      .addFields(
        { name: '🛒 Buy a Key', value: `[Click here to purchase](${shopUrl}/shop/purchase)` },
        { name: '📜 My Orders', value: `[View your orders](${shopUrl}/shop/orders)` },
        { name: '🆘 Support', value: supportServer }
      )
      .setFooter({ text: `${shopName} · Automated System` })
      .setTimestamp();

    await user.send({ embeds: [embed] });
    console.log(`✅ Welcome DM sent to ${discordId}`);
  } catch (err) {
    console.error(`❌ Failed to send welcome DM to ${discordId}:`, err.message);
  }
};

/**
 * Send professional purchase log to a Discord channel (admin log).
 */
module.exports.sendPurchaseLog = async (order) => {
  try {
    const channelId = process.env.DISCORD_LOG_CHANNEL_ID;
    if (!channelId) return console.log('❌ Log channel ID not set');

    const channel = await client.channels.fetch(channelId);
    if (!channel) return console.log('❌ Log channel not found');

    // Shorten license key
    const key = order.generatedKey || 'N/A';
    let shortKey = key;
    if (key.length > 12) {
      shortKey = key.slice(0, 6) + '...' + key.slice(-6);
    }

    let customerField = '';
    if (order.discordId) {
      customerField = `<@${order.discordId}> (${order.discordUsername || order.discordId})`;
    } else if (order.discordUsername) {
      customerField = `@${order.discordUsername}`;
    } else {
      customerField = order.email || 'N/A';
    }

    const created = new Date(order.createdAt);
    const expiry = new Date(order.keyDetails.expiryDate);
    const durationMs = expiry.getTime() - created.getTime();
    const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));

    const embed = new EmbedBuilder()
      .setColor('#ef1f1f')
      .setAuthor({ name: '🛒 New License Purchase', iconURL: 'https://i.ibb.co/3mk27cX8/Picsart-26-04-29-23-00-01-811.png' })
      .setThumbnail('https://i.ibb.co/3mk27cX8/Picsart-26-04-29-23-00-01-811.png')
      .addFields(
        { name: '👤 Customer', value: customerField, inline: true },
        { name: '📧 Email', value: order.email || '—', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '📅 Duration', value: `${durationDays} day(s)`, inline: true },
        { name: '💻 Max Devices', value: `${order.keyDetails.maxDevices}`, inline: true },
        { name: '📝 Note', value: order.keyDetails.note || '—', inline: true },
        { name: '🎟️ Coupon', value: order.couponCode ? `${order.couponCode} (-₹${order.discountAmount})` : 'None', inline: true },
        { name: '💰 Amount Paid', value: `₹${order.amount}`, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🔑 License Key', value: `\`${shortKey}\``, inline: false },
        { name: '⏳ Expires On', value: expiry.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }), inline: true }
      )
      .setFooter({ text: process.env.SHOP_NAME || 'Key Shop' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log(`📋 Purchase log sent to channel ${channelId}`);
  } catch (err) {
    console.error('❌ Failed to send purchase log:', err);
  }
};

/**
 * 🆕 IMPROVED Gift DM – searches all guilds for the recipient
 */
module.exports.sendGiftDiscordDM = async (username, key, expiryDate, orderId, fromName) => {
  try {
    let user = client.users.cache.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
      for (const guild of client.guilds.cache.values()) {
        try {
          await guild.members.fetch();
          const member = guild.members.cache.find(m => m.user.username.toLowerCase() === username.toLowerCase());
          if (member) {
            user = member.user;
            break;
          }
        } catch (err) {
          // skip guild if permission issue
        }
      }
    }

    if (!user) {
      console.log(`❌ User ${username} not found in any mutual guild for gift DM.`);
      return;
    }

    const shopName = process.env.SHOP_NAME || 'Key Shop';
    const shopUrl = process.env.SHOP_URL || 'http://localhost:5000';
    const supportServer = process.env.DISCORD_SUPPORT_SERVER || 'https://discord.gg/2fyTyCPZJP';

    const embed = new EmbedBuilder()
      .setColor('#ef1f1f')
      .setTitle(`🎁 You received a gift from ${fromName}!`)
      .setDescription(`${fromName} gifted you a license key from **${shopName}**.`)
      .addFields(
        { name: '🔑 License Key', value: `\`${key}\`` },
        { name: '📅 Expires On', value: new Date(expiryDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) },
        { name: '🔗 Quick Actions', value: `[Renew Key](${shopUrl}/shop/renew/${orderId}) | [Support Server](${supportServer})` }
      )
      .setTimestamp();

    await user.send({ embeds: [embed] });
    console.log(`✅ Gift DM sent to ${username}`);
  } catch (err) {
    console.error(`❌ Failed to send gift DM to ${username}:`, err.message);
  }
};

/**
 * 🆕 Send new support ticket to a dedicated Discord channel
 */
module.exports.sendTicketLog = async (ticket, user) => {
  try {
    const channelId = process.env.DISCORD_SUPPORT_TICKET_CHANNEL_ID;
    if (!channelId) return console.log('❌ Support ticket channel ID not set');

    const channel = await client.channels.fetch(channelId);
    if (!channel) return console.log('❌ Support channel not found');

    const embed = new EmbedBuilder()
      .setColor('#f59e0b') // amber
      .setTitle('🎫 New Support Ticket')
      .addFields(
        { name: '👤 User', value: user.email || user.username || 'N/A', inline: true },
        { name: '📧 Email', value: ticket.email || 'N/A', inline: true },
        { name: '🎮 Discord', value: ticket.discordUsername || 'N/A', inline: true },
        { name: '📝 Subject', value: ticket.subject, inline: false },
        { name: '💬 Message', value: ticket.message.substring(0, 1024), inline: false }
      )
      .setFooter({ text: `Ticket ID: ${ticket._id}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log(`📋 Ticket log sent to support channel`);
  } catch (err) {
    console.error('❌ Failed to send ticket log:', err);
  }
};