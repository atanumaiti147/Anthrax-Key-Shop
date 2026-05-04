const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
  discountValue: { type: Number, required: true },
  minOrderAmount: { type: Number, default: 0 },
  minDevices: { type: Number, default: 0 },                // 🆕 minimum devices required
  allowedEmails: [{ type: String }],                       // 🆕 whitelist emails (empty = all allowed)
  oncePerUser: { type: Boolean, default: false },          // 🆕 one-time per user
  maxUses: { type: Number, default: 0 },
  usedCount: { type: Number, default: 0 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Coupon', couponSchema);