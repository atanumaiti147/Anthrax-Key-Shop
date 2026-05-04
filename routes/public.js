const express = require('express');
const router = express.Router();
const Policy = require('../models/Policy');
const ShopSettings = require('../models/ShopSettings');

// Show single policy by slug
router.get('/policy/:slug', async (req, res) => {
  try {
    const policy = await Policy.findOne({ slug: req.params.slug });
    if (!policy) {
      return res.status(404).render('error', { message: 'Policy not found' });
    }
    const settings = await ShopSettings.getSettings();
    res.render('policy', { policy, settings });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error' });
  }
});

// List all policies (optional)
router.get('/policies', async (req, res) => {
  try {
    const policies = await Policy.find().sort({ updatedAt: -1 }).lean();
    const settings = await ShopSettings.getSettings();
    res.render('policies', { policies, settings });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error' });
  }
});

module.exports = router;