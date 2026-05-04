const mongoose = require('mongoose');

const shopUserSchema = new mongoose.Schema({
  provider: { type: String, enum: ['discord', 'google'], required: true },
  providerId: { type: String, required: true },
  email: String,
  username: String,
  avatar: String,
  discordId: String, // for Discord DM
  googleId: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ShopUser', shopUserSchema);