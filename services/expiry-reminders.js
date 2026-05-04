const cron = require('node-cron');
const ShopOrder = require('../models/ShopOrder');
const ShopSettings = require('../models/ShopSettings');
const { sendEmail } = require('../services/email');
const { sendDiscordDM, sendDiscordDMByUsername } = require('../services/discordBot');

// Run every day at 09:00 AM
const schedule = '0 9 * * *';

async function checkAndSendReminders() {
  console.log('🔔 Running expiry reminder check...');
  try {
    const now = new Date();
    const settings = await ShopSettings.getSettings();

    // Find all paid orders with a generated key and not expired
    const orders = await ShopOrder.find({
      status: 'paid',
      generatedKey: { $ne: null },
      expiryDate: { $gte: now }   // not expired
    }).lean();

    for (const order of orders) {
      const expiry = new Date(order.expiryDate);
      const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Only send reminders for 3 days or 1 day before expiry
      if ((diffDays === 3 || diffDays === 1) && !order.remindersSent.includes(diffDays)) {
        // Prepare common data
        const shopName = settings.siteName || 'Key Shop';
        const shopUrl = process.env.SHOP_URL || 'https://shop.anthrax.qzz.io';
        const expiryDateStr = expiry.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

        // ----- Email -----
        if (order.email) {
          try {
            await sendEmail(order.email, `⏳ Your license expires in ${diffDays} day(s)`, {
              shopName,
              subject: `⏳ Your license expires in ${diffDays} day(s)`,
              key: order.generatedKey,
              expiryDate: expiryDateStr,
              maxDevices: order.keyDetails.maxDevices,
              note: order.keyDetails.note,
              amount: order.amount,
              couponCode: order.couponCode,
              discountAmount: order.discountAmount,
              shopUrl,
              orderId: order._id.toString()
            });
            console.log(`📧 Reminder email sent to ${order.email} (${diffDays}d)`);
          } catch (err) {
            console.error(`❌ Email reminder failed for ${order.email}:`, err.message);
          }
        }

        // ----- Discord DM -----
        if (order.discordId) {
          try {
            await sendDiscordDM(order.discordId, order.generatedKey, order.keyDetails.expiryDate, order._id);
            console.log(`🤖 Discord DM reminder sent to ${order.discordId}`);
          } catch (err) {
            console.error(`❌ Discord DM reminder failed:`, err.message);
          }
        } else if (order.discordUsername) {
          try {
            await sendDiscordDMByUsername(order.discordUsername, order.generatedKey, order.keyDetails.expiryDate, order._id);
            console.log(`🤖 Discord DM reminder sent to ${order.discordUsername}`);
          } catch (err) {
            console.error(`❌ Discord DM reminder failed:`, err.message);
          }
        }

        // Mark this reminder as sent in the database
        await ShopOrder.findByIdAndUpdate(order._id, {
          $push: { remindersSent: diffDays }
        });
      }
    }
  } catch (err) {
    console.error('❌ Reminder cron error:', err);
  }
}

// Optional: run immediately on startup for testing (comment out in production)
// checkAndSendReminders();

module.exports = {
  start: () => {
    cron.schedule(schedule, checkAndSendReminders);
    console.log(`⏰ Expiry reminder cron scheduled: ${schedule}`);
  }
};
