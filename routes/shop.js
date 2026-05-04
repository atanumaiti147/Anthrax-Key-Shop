const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');
const ShopSettings = require('../models/ShopSettings');
const ShopOrder = require('../models/ShopOrder');
const Coupon = require('../models/Coupon');
const { generateKey } = require('../services/keygen');
const { sendEmail } = require('../services/email');
const { sendDiscordDM, sendDiscordDMByUsername, sendPurchaseLog, sendGiftDiscordDM } = require('../services/discordBot');

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
}

// Purchase form
router.get('/purchase', ensureAuth, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  res.render('shop/purchase', {
    user: req.user,
    settings,
    perDayPrice: settings.perDayPrice,
    extraDevicePrice: settings.extraDevicePrice,
    platformFee: settings.platformFee
  });
});

// Customer order history
router.get('/orders', ensureAuth, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  const orders = await ShopOrder.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.render('shop/orders', { user: req.user, orders, settings });
});

// Coupon validation (unchanged, skipped for brevity – same as yours)
router.post('/validate-coupon', ensureAuth, async (req, res) => {
  const { code, subtotal, maxDevices } = req.body;
  try {
    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (!coupon) return res.json({ valid: false, message: 'Invalid coupon code.' });
    if (!coupon.active || coupon.startDate > new Date() || coupon.endDate < new Date())
      return res.json({ valid: false, message: 'Coupon expired or not active.' });
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses)
      return res.json({ valid: false, message: 'Coupon usage limit reached.' });
    if (coupon.minOrderAmount > 0 && subtotal < coupon.minOrderAmount)
      return res.json({ valid: false, message: `Minimum order amount ₹${coupon.minOrderAmount} required.` });

    if (coupon.minDevices > 0) {
      const devices = parseInt(maxDevices) || 1;
      if (devices < coupon.minDevices) {
        return res.json({ valid: false, message: `This coupon requires at least ${coupon.minDevices} devices.` });
      }
    }
    if (coupon.allowedEmails && coupon.allowedEmails.length > 0) {
      const userEmail = req.user?.email?.toLowerCase();
      if (!userEmail || !coupon.allowedEmails.includes(userEmail)) {
        return res.json({ valid: false, message: 'You are not eligible for this coupon.' });
      }
    }
    if (coupon.oncePerUser) {
      const existingOrder = await ShopOrder.findOne({
        userId: req.user._id,
        couponCode: coupon.code,
        status: 'paid'
      });
      if (existingOrder) {
        return res.json({ valid: false, message: 'You have already used this coupon.' });
      }
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') discount = (subtotal * coupon.discountValue) / 100;
    else discount = coupon.discountValue;
    discount = Math.min(discount, subtotal);
    res.json({ valid: true, discount: parseFloat(discount.toFixed(2)), code: coupon.code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ valid: false, message: 'Server error.' });
  }
});

// Create Razorpay order — FIXED
router.post('/create-order', ensureAuth, async (req, res) => {
  const { durationDays, maxDevices, note, discordUsername, couponCode,
          isGift, giftEmail, giftDiscordUsername } = req.body;
  const settings = await ShopSettings.getSettings();

  const days = parseInt(durationDays) || 1;
  if (days <= 0) return res.status(400).json({ error: 'Invalid duration' });

  const expiryDate = new Date(Date.now() + days * 86400000);

  const baseAmount = days * settings.perDayPrice;
  const devices = parseInt(maxDevices) || 1;
  const extraDevices = Math.max(0, devices - 1);
  const extraAmount = extraDevices * (settings.extraDevicePrice || 0);
  const platformFee = settings.platformFee || 0;
  let subtotal = baseAmount + extraAmount;
  let discountAmount = 0;
  let finalCouponCode = null;

  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
    if (coupon && coupon.active && coupon.startDate <= new Date() && coupon.endDate >= new Date()) {
      if (coupon.maxUses === 0 || coupon.usedCount < coupon.maxUses) {
        if (subtotal >= (coupon.minOrderAmount || 0)) {
          discountAmount = coupon.discountType === 'percentage'
            ? (subtotal * coupon.discountValue) / 100
            : coupon.discountValue;
          discountAmount = Math.min(discountAmount, subtotal);
          finalCouponCode = coupon.code;
        }
      }
    }
  }

  const amount = subtotal + platformFee - discountAmount;

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error('❌ Razorpay keys missing in env');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  // ** FIXED: round to integer paise **
  const amountInPaise = Math.round(amount * 100);

  const options = {
    amount: amountInPaise,   // integer
    currency: 'INR',
    receipt: `receipt_${Date.now()}`,
    payment_capture: 1
  };

  try {
    const order = await razorpay.orders.create(options);
    console.log('✅ Razorpay order created:', order.id);

    const shopOrder = new ShopOrder({
      userId: req.user._id,
      email: req.user.email,
      discordId: req.user.discordId,
      discordUsername: discordUsername || null,
      keyDetails: { expiryDate, maxDevices: devices, note },
      amount,
      couponCode: finalCouponCode,
      discountAmount,
      razorpayOrderId: order.id,
      status: 'pending',
      isGift: isGift === true || isGift === 'true',
      giftRecipientEmail: giftEmail || null,
      giftRecipientDiscordUsername: giftDiscordUsername || null
    });
    await shopOrder.save();

    res.json({
      orderId: order.id,
      amount: amountInPaise,   // paise bhej rahe hain frontend ko
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Verify payment – unchanged, only amountInPaise not needed
router.post('/verify-payment', ensureAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  console.log('📥 Received verification request:', { razorpay_order_id, razorpay_payment_id, razorpay_signature });

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  const sign = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(sign)
    .digest('hex');

  console.log('🔐 Expected signature:', expectedSign);
  if (expectedSign !== razorpay_signature) {
    console.error('❌ Signature mismatch!');
    return res.status(400).json({ error: 'Invalid signature' });
  }
  console.log('✅ Signature verified');

  const order = await ShopOrder.findOne({ razorpayOrderId: razorpay_order_id });
  if (!order) {
    console.error('❌ Order not found for:', razorpay_order_id);
    return res.status(404).json({ error: 'Order not found' });
  }

  order.razorpayPaymentId = razorpay_payment_id;
  order.status = 'paid';
  if (order.couponCode) {
    await Coupon.findOneAndUpdate({ code: order.couponCode }, { $inc: { usedCount: 1 } });
  }
  await order.save();

  try {
    console.log('🔑 Generating key via KeyGen API...');
    const key = await generateKey(
      order.keyDetails.expiryDate,
      order.keyDetails.maxDevices,
      order.keyDetails.note
    );
    console.log('✅ Key generated:', key);
    order.generatedKey = key;
    await order.save();

    const settings = await ShopSettings.getSettings();
    const expiryDateStr = new Date(order.keyDetails.expiryDate).toLocaleDateString('en-IN', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const buyerName = req.user ? (req.user.username || req.user.email) : 'Someone';

    if (order.isGift) {
      if (order.giftRecipientEmail) {
        const giftEmailData = {
          shopName: settings.siteName || 'Key Shop',
          key,
          expiryDate: expiryDateStr,
          maxDevices: order.keyDetails.maxDevices,
          note: order.keyDetails.note,
          amount: order.amount,
          couponCode: order.couponCode,
          discountAmount: order.discountAmount,
          shopUrl: process.env.SHOP_URL || 'https://shop.anthrax.qzz.io',
          orderId: order._id.toString(),
          isGift: true,
          from: buyerName
        };
        await sendEmail(order.giftRecipientEmail, '🎁 You received a gift license!', giftEmailData)
          .catch(err => console.error('Gift email failed:', err));
      }
      if (order.giftRecipientDiscordUsername) {
        await sendGiftDiscordDM(order.giftRecipientDiscordUsername, key, order.keyDetails.expiryDate, order._id, buyerName)
          .catch(err => console.error('Gift Discord DM failed:', err));
      }
      if (order.email) {
        const buyerEmailData = {
          shopName: settings.siteName || 'Key Shop',
          key: null,
          expiryDate: expiryDateStr,
          maxDevices: order.keyDetails.maxDevices,
          note: order.keyDetails.note,
          amount: order.amount,
          couponCode: order.couponCode,
          discountAmount: order.discountAmount,
          shopUrl: process.env.SHOP_URL || 'https://shop.anthrax.qzz.io',
          orderId: order._id.toString(),
          isGift: true,
          buyerReceipt: true
        };
        await sendEmail(order.email, '🎁 Your gift has been sent!', buyerEmailData)
          .catch(err => console.error('Buyer email failed:', err));
      }
    } else {
      if (order.email) {
        const emailData = {
          shopName: settings.siteName || 'Key Shop',
          key,
          expiryDate: expiryDateStr,
          maxDevices: order.keyDetails.maxDevices,
          note: order.keyDetails.note,
          amount: order.amount,
          couponCode: order.couponCode,
          discountAmount: order.discountAmount,
          shopUrl: process.env.SHOP_URL || 'https://shop.anthrax.qzz.io',
          orderId: order._id.toString()
        };
        await sendEmail(order.email, '🎉 Your License Key', emailData)
          .catch(err => console.error('Email failed:', err));
      }
      if (order.discordId) {
        await sendDiscordDM(order.discordId, key, order.keyDetails.expiryDate, order._id);
      } else if (order.discordUsername) {
        await sendDiscordDMByUsername(order.discordUsername, key, order.keyDetails.expiryDate, order._id);
      }
    }

    await sendPurchaseLog(order).catch(err => console.error('Log send error:', err));

    res.json({
      success: true,
      key,
      expiresAt: order.keyDetails.expiryDate,
      orderId: order._id
    });
  } catch (err) {
    console.error('❌ Key generation failed:', err);
    res.status(500).json({ error: 'Key generation failed. Contact support.' });
  }
});

// ================== KEY RENEWAL ==================
router.get('/renew/:orderId', ensureAuth, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.orderId);
    if (!order || order.userId.toString() !== req.user._id.toString()) {
      return res.status(404).render('error', { message: 'Order not found or unauthorized' });
    }
    if (!order.generatedKey) {
      return res.render('error', { message: 'Key not generated yet. Please contact support.' });
    }
    const settings = await ShopSettings.getSettings();
    res.render('shop/renew', {
      key: order.generatedKey,
      currentExpiry: order.keyDetails.expiryDate,
      perDayPrice: settings.perDayPrice,
      orderId: order._id
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Server error' });
  }
});

router.post('/create-renew-order', ensureAuth, async (req, res) => {
  const { key, newExpiryDate, orderId } = req.body;
  const settings = await ShopSettings.getSettings();

  const today = new Date();
  const expiry = new Date(newExpiryDate);
  const diffTime = expiry.getTime() - today.getTime();
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (days <= 0) return res.status(400).json({ error: 'New expiry date must be in the future' });

  const amount = days * settings.perDayPrice;

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  // FIXED: round to integer paise
  const amountInPaise = Math.round(amount * 100);

  const options = {
    amount: amountInPaise,
    currency: 'INR',
    receipt: `renewal_${Date.now()}`,
    payment_capture: 1
  };

  try {
    const order = await razorpay.orders.create(options);
    const renewalOrder = new ShopOrder({
      userId: req.user._id,
      email: req.user.email,
      discordId: req.user.discordId,
      keyDetails: { expiryDate: newExpiryDate, maxDevices: 0, note: `Renewal for key ${key}` },
      amount,
      razorpayOrderId: order.id,
      status: 'pending'
    });
    await renewalOrder.save();

    res.json({
      orderId: order.id,
      amount: amountInPaise,
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error('Renewal order creation error:', err);
    res.status(500).json({ error: 'Failed to create renewal order' });
  }
});

router.post('/verify-renew-payment', ensureAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  const sign = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(sign)
    .digest('hex');

  if (expectedSign !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const order = await ShopOrder.findOne({ razorpayOrderId: razorpay_order_id });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.razorpayPaymentId = razorpay_payment_id;
  order.status = 'paid';
  await order.save();

  const keyString = order.keyDetails.note.split('key ')[1];
  if (!keyString) return res.status(400).json({ error: 'Key not found in renewal order' });

  try {
    const response = await axios.post(`${process.env.KEYGEN_API_URL}/api/v1/extend-key`, {
      key: keyString,
      expiryDate: order.keyDetails.expiryDate,
      apiSecret: process.env.API_SECRET_KEY
    });

    if (!response.data.success) {
      throw new Error(response.data.error || 'KeyGen extend failed');
    }

    res.json({ success: true, message: 'Key extended successfully' });
  } catch (err) {
    console.error('Key extension failed:', err);
    res.status(500).json({ error: 'Failed to extend key. Contact support.' });
  }
});

// ================== KEY TRANSFER ==================
router.get('/transfer/:orderId', ensureAuth, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.orderId);
    if (!order || order.userId.toString() !== req.user._id.toString() || order.transferred) {
      return res.redirect('/shop/orders');
    }
    res.render('shop/transfer', { order });
  } catch (err) {
    console.error(err);
    res.redirect('/shop/orders');
  }
});

router.post('/transfer/:orderId', ensureAuth, async (req, res) => {
  const { email, discordUsername } = req.body;
  try {
    const order = await ShopOrder.findById(req.params.orderId);
    if (!order || order.userId.toString() !== req.user._id.toString() || order.transferred) {
      return res.status(400).render('error', { message: 'Transfer not allowed.' });
    }

    order.transferred = true;
    order.transferredToEmail = email;
    order.transferredToDiscordUsername = discordUsername || null;
    order.transferredAt = new Date();
    await order.save();

    const settings = await ShopSettings.getSettings();
    if (email) {
      const expiryDateStr = new Date(order.keyDetails.expiryDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
      await sendEmail(email, '🎁 You received a license key!', {
        shopName: settings.siteName || 'Key Shop',
        key: order.generatedKey,
        expiryDate: expiryDateStr,
        maxDevices: order.keyDetails.maxDevices,
        note: order.keyDetails.note,
        amount: order.amount,
        couponCode: order.couponCode,
        discountAmount: order.discountAmount,
        shopUrl: process.env.SHOP_URL || 'https://shop.anthrax.qzz.io',
        orderId: order._id.toString(),
        isGift: true
      }).catch(err => console.error('Transfer email failed:', err));
    }
    if (discordUsername) {
      await sendDiscordDMByUsername(discordUsername, order.generatedKey, order.keyDetails.expiryDate, order._id)
        .catch(err => console.error('Transfer DM failed:', err));
    }

    req.session.success_msg = 'Key transferred successfully!';
    res.redirect('/shop/orders');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Transfer failed.' });
  }
});

// Success page
router.get('/success/:orderId', ensureAuth, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.orderId);
    if (!order) return res.status(404).render('error', { message: 'Order not found' });
    res.render('shop/success', { key: order.generatedKey });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error' });
  }
});

// Invoice download
router.get('/invoice/:orderId', ensureAuth, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.orderId).populate('userId');
    if (!order || order.userId._id.toString() !== req.user._id.toString()) {
      return res.status(404).render('error', { message: 'Order not found or unauthorized' });
    }
    if (order.status !== 'paid' || !order.generatedKey) {
      return res.status(400).render('error', { message: 'Invoice not available for this order.' });
    }
    const settings = await ShopSettings.getSettings();
    const { generateInvoice } = require('../services/invoice');
    await generateInvoice(res, order, settings);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Failed to generate invoice.' });
  }
});

module.exports = router;
