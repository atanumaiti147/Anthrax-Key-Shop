const mongoose = require('mongoose');

const policySchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true }, // e.g., 'privacy', 'terms'
  content: { type: String, default: '' },
  contentType: { type: String, enum: ['text', 'html'], default: 'text' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Policy', policySchema);