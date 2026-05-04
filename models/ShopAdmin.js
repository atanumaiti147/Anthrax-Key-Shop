const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const shopAdminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' },
  twoFactorEnabled: { type: Boolean, default: false },    // 🆕
  twoFactorSecret: { type: String, default: null },       // 🆕
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopAdmin' },
  createdAt: { type: Date, default: Date.now }
});

shopAdminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

shopAdminSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('ShopAdmin', shopAdminSchema);