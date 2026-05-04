const mongoose = require('mongoose');

const shopOrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopUser' },
  email: String,
  discordId: { type: String, default: null },
  discordUsername: { type: String, default: null },
  keyDetails: {
    expiryDate: Date,
    maxDevices: Number,
    note: String
  },
  amount: Number,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  generatedKey: String,
  couponCode: { type: String, default: null },
  discountAmount: { type: Number, default: 0 },
  remindersSent: { type: [Number], default: [] },
  // 🆕 Gift fields
  isGift: { type: Boolean, default: false },
  giftRecipientEmail: { type: String, default: null },
  giftRecipientDiscordUsername: { type: String, default: null },
  // 🆕 Transfer fields
  transferred: { type: Boolean, default: false },
  transferredToEmail: { type: String, default: null },
  transferredToDiscordUsername: { type: String, default: null },
  transferredAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ShopOrder', shopOrderSchema);