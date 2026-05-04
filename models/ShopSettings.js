const mongoose = require('mongoose');

const shopSettingsSchema = new mongoose.Schema({
  perDayPrice: { type: Number, default: 50 },
  extraDevicePrice: { type: Number, default: 10 },
  platformFee: { type: Number, default: 0 },      // 🆕 flat fee per order
  enableDiscordLogin: { type: Boolean, default: true },
  enableGoogleLogin: { type: Boolean, default: true },
  siteName: { type: String, default: 'Key Shop' },
  faviconUrl: { type: String, default: '' },
  logoUrl: { type: String, default: '' },
  maintenanceMode: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});

shopSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model('ShopSettings', shopSettingsSchema);