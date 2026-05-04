const express = require('express');
const router = express.Router();
const ShopAdmin = require('../models/ShopAdmin');
const ShopOrder = require('../models/ShopOrder');
const ShopUser = require('../models/ShopUser');
const ShopSettings = require('../models/ShopSettings');
const Policy = require('../models/Policy');
const axios = require('axios');
const Coupon = require('../models/Coupon');
const Announcement = require('../models/Announcement');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const SupportTicket = require('../models/SupportTicket');

// Middlewares
const ensureShopAdmin = (req, res, next) => {
  if (req.session && req.session.shopAdminId) return next();
  res.redirect('/admin/login');
};

const ensureSuperAdmin = (req, res, next) => {
  if (req.session.shopAdminRole === 'super_admin') return next();
  req.session.error_msg = 'You need super admin privileges.';
  res.redirect('/admin/dashboard');
};

// ================== ADMIN AUTH ==================
router.get('/login', async (req, res) => {
  const settings = await ShopSettings.getSettings();
  res.render('admin/login', { error: null, settings });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const admin = await ShopAdmin.findOne({ email });
  if (!admin || !(await admin.comparePassword(password))) {
    return res.render('admin/login', { error: 'Invalid credentials' });
  }

  if (admin.twoFactorEnabled) {
    req.session.tempAdminId = admin._id;          // store temporarily
    return res.redirect('/admin/verify-2fa');
  }

  req.session.shopAdminId = admin._id;
  req.session.shopAdminRole = admin.role;
  res.redirect('/admin/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ================== DASHBOARD (FIXED AMOUNTS) ==================
router.get('/dashboard', ensureShopAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();

  // Total stats
  const totalOrders = await ShopOrder.countDocuments();
  const totalAgg = await ShopOrder.aggregate([
    { $match: { status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const totalRevenue = Math.round((totalAgg[0]?.total || 0) * 100) / 100;

  // Today's stats
  const startOfToday = new Date();
  startOfToday.setHours(0,0,0,0);
  const endOfToday = new Date();
  endOfToday.setHours(23,59,59,999);

  const todayAgg = await ShopOrder.aggregate([
    { $match: { status: 'paid', createdAt: { $gte: startOfToday, $lte: endOfToday } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const todayRevenue = Math.round((todayAgg[0]?.total || 0) * 100) / 100;

  const todayOrders = await ShopOrder.countDocuments({
    createdAt: { $gte: startOfToday, $lte: endOfToday }
  });

  // This month's stats
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23,59,59,999);

  const monthAgg = await ShopOrder.aggregate([
    { $match: { status: 'paid', createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const monthRevenue = Math.round((monthAgg[0]?.total || 0) * 100) / 100;

  // New users this month
  const newUsers = await ShopUser.countDocuments({
    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
  });

  // Recent 5 orders
  const recentOrders = await ShopOrder.find()
    .populate('userId', 'email')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  res.render('admin/dashboard', {
    totalOrders,
    totalRevenue,
    todayRevenue,
    todayOrders,
    monthRevenue,
    newUsers,
    recentOrders,
    settings
  });
});

// ================== ORDERS ==================
router.get('/orders', ensureShopAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  const orders = await ShopOrder.find().populate('userId', 'email').sort({ createdAt: -1 });
  res.render('admin/orders', { orders, settings });
});

router.post('/update-order-expiry/:id', ensureShopAdmin, async (req, res) => {
  try {
    const { expiryDate } = req.body;
    await ShopOrder.findByIdAndUpdate(req.params.id, { 'keyDetails.expiryDate': expiryDate });
    const order = await ShopOrder.findById(req.params.id);
    if (order && order.generatedKey) {
      await axios.post(`${process.env.KEYGEN_API_URL}/api/v1/extend-key`, {
        key: order.generatedKey,
        expiryDate,
        apiSecret: process.env.API_SECRET_KEY
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/delete-order/:id', ensureShopAdmin, async (req, res) => {
  await ShopOrder.findByIdAndDelete(req.params.id);
  req.session.success_msg = 'Order deleted.';
  res.redirect('/admin/orders');
});

router.get('/revoke-key/:id', ensureShopAdmin, async (req, res) => {
  const order = await ShopOrder.findById(req.params.id);
  if (order && order.generatedKey) {
    try {
      await axios.post(`${process.env.KEYGEN_API_URL}/api/v1/delete-key`, {
        key: order.generatedKey,
        apiSecret: process.env.API_SECRET_KEY
      });
    } catch (e) {
      console.error('Failed to revoke key:', e);
    }
    order.generatedKey = null;
    await order.save();
  }
  req.session.success_msg = 'Key revoked.';
  res.redirect('/admin/orders');
});

// ================== SETTINGS ==================
router.get('/settings', ensureShopAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  res.render('admin/settings', { settings });
});

router.post('/settings', ensureShopAdmin, async (req, res) => {
  const { perDayPrice, extraDevicePrice, platformFee, enableDiscordLogin, enableGoogleLogin, siteName, faviconUrl, logoUrl, maintenanceMode } = req.body;
  const settings = await ShopSettings.getSettings();
  settings.perDayPrice = parseFloat(perDayPrice) || 50;
  settings.extraDevicePrice = parseFloat(extraDevicePrice) || 0;
  settings.platformFee = parseFloat(platformFee) || 0;
  settings.enableDiscordLogin = enableDiscordLogin === 'on';
  settings.enableGoogleLogin = enableGoogleLogin === 'on';
  if (siteName) settings.siteName = siteName;
  if (faviconUrl) settings.faviconUrl = faviconUrl;
  if (logoUrl) settings.logoUrl = logoUrl;
  settings.maintenanceMode = maintenanceMode === 'on';
  await settings.save();
  req.session.success_msg = 'Settings saved successfully!';
  res.redirect('/admin/settings');
});

// ================== USERS ==================
router.get('/users', ensureShopAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  const users = await ShopUser.find().sort({ createdAt: -1 });
  res.render('admin/users', { users, settings });
});

// ================== POLICIES ==================
router.get('/policies', ensureShopAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  const policies = await Policy.find().sort({ updatedAt: -1 });
  res.render('admin/policies', { policies, settings });
});

router.get('/policies/create', ensureShopAdmin, (req, res) => {
  res.render('admin/policy-form', { policy: null });
});

router.get('/policies/edit/:id', ensureShopAdmin, async (req, res) => {
  const policy = await Policy.findById(req.params.id);
  if (!policy) return res.redirect('/admin/policies');
  res.render('admin/policy-form', { policy });
});

router.post('/policies/save', ensureShopAdmin, async (req, res) => {
  const { title, slug, content, contentType } = req.body;
  try {
    const existing = await Policy.findOne({ slug });
    if (existing) {
      req.session.error_msg = 'A policy with that slug already exists.';
      return res.redirect('/admin/policies/create');
    }
    await Policy.create({ title, slug, content, contentType });
    req.session.success_msg = 'Policy created successfully!';
    res.redirect('/admin/policies');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Error creating policy.';
    res.redirect('/admin/policies/create');
  }
});

router.post('/policies/update/:id', ensureShopAdmin, async (req, res) => {
  const { title, slug, content, contentType } = req.body;
  try {
    const existing = await Policy.findOne({ slug, _id: { $ne: req.params.id } });
    if (existing) {
      req.session.error_msg = 'Another policy already uses that slug.';
      return res.redirect(`/admin/policies/edit/${req.params.id}`);
    }
    await Policy.findByIdAndUpdate(req.params.id, { title, slug, content, contentType, updatedAt: new Date() });
    req.session.success_msg = 'Policy updated successfully!';
    res.redirect('/admin/policies');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Error updating policy.';
    res.redirect(`/admin/policies/edit/${req.params.id}`);
  }
});

router.get('/policies/delete/:id', ensureShopAdmin, async (req, res) => {
  await Policy.findByIdAndDelete(req.params.id);
  req.session.success_msg = 'Policy deleted.';
  res.redirect('/admin/policies');
});

// Bulk delete orders
router.post('/bulk-delete-orders', ensureShopAdmin, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'No orders selected' });
    }
    await ShopOrder.deleteMany({ _id: { $in: orderIds } });
    req.session.success_msg = `Deleted ${orderIds.length} orders.`;
    res.json({ success: true, count: orderIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete orders' });
  }
});

// ================== ADMIN MANAGEMENT (Super Admin only) ==================
router.get('/manage-admins', ensureSuperAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  const admins = await ShopAdmin.find().select('-password').sort({ createdAt: -1 }).lean();
  res.render('admin/manage-admins', { admins, settings });
});

router.get('/create-admin', ensureSuperAdmin, (req, res) => {
  res.render('admin/create-admin', { error: null });
});

router.post('/create-admin', ensureSuperAdmin, async (req, res) => {
  const { email, password, role } = req.body;
  try {
    const existing = await ShopAdmin.findOne({ email });
    if (existing) {
      return res.render('admin/create-admin', { error: 'Email already exists.' });
    }
    await ShopAdmin.create({ email, password, role: role || 'admin' });
    req.session.success_msg = 'Admin created successfully!';
    res.redirect('/admin/manage-admins');
  } catch (err) {
    console.error(err);
    res.render('admin/create-admin', { error: 'Error creating admin.' });
  }
});

router.get('/edit-admin/:id', ensureSuperAdmin, async (req, res) => {
  try {
    const admin = await ShopAdmin.findById(req.params.id).select('-password');
    if (!admin) return res.redirect('/admin/manage-admins');
    res.render('admin/edit-admin', { admin, error: null });
  } catch (err) {
    res.redirect('/admin/manage-admins');
  }
});

router.post('/edit-admin/:id', ensureSuperAdmin, async (req, res) => {
  const { email, password, role } = req.body;
  try {
    const admin = await ShopAdmin.findById(req.params.id);
    if (!admin) return res.redirect('/admin/manage-admins');
    
    if (email) admin.email = email;
    if (role) admin.role = role;
    if (password && password.trim().length > 0) {
      admin.password = password;   // bcrypt will hash it automatically due to pre-save hook
    }
    await admin.save();
    req.session.success_msg = 'Admin updated successfully.';
    res.redirect('/admin/manage-admins');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Failed to update admin.';
    res.redirect(`/admin/edit-admin/${req.params.id}`);
  }
});

router.get('/delete-admin/:id', ensureSuperAdmin, async (req, res) => {
  try {
    const admin = await ShopAdmin.findById(req.params.id);
    if (!admin) {
      req.session.error_msg = 'Admin not found.';
      return res.redirect('/admin/manage-admins');
    }
    if (admin._id.toString() === req.session.shopAdminId.toString()) {
      req.session.error_msg = 'You cannot delete your own account.';
      return res.redirect('/admin/manage-admins');
    }
    await ShopAdmin.findByIdAndDelete(req.params.id);
    req.session.success_msg = 'Admin deleted.';
    res.redirect('/admin/manage-admins');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Failed to delete admin.';
    res.redirect('/admin/manage-admins');
  }
});

// ================== COUPONS (UPDATED with advanced rules & bulk) ==================
router.get('/coupons', ensureShopAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
  res.render('admin/coupons', { coupons, settings });
});

router.get('/coupons/create', ensureShopAdmin, (req, res) => {
  res.render('admin/coupon-form', { coupon: null, error: null });
});

router.post('/coupons/create', ensureShopAdmin, async (req, res) => {
  const { code, discountType, discountValue, minOrderAmount, maxUses, startDate, endDate, active,
          minDevices, oncePerUser, allowedEmails } = req.body;
  try {
    const emailList = allowedEmails ? allowedEmails.split(',').map(e => e.trim().toLowerCase()).filter(e => e) : [];

    await Coupon.create({
      code: code.toUpperCase(),
      discountType,
      discountValue: parseFloat(discountValue),
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      maxUses: parseInt(maxUses) || 0,
      minDevices: parseInt(minDevices) || 0,
      oncePerUser: oncePerUser === 'on',
      allowedEmails: emailList,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      active: active === 'on'
    });
    req.session.success_msg = 'Coupon created!';
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Error creating coupon.';
    res.redirect('/admin/coupons/create');
  }
});

router.get('/coupons/edit/:id', ensureShopAdmin, async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) return res.redirect('/admin/coupons');
  res.render('admin/coupon-form', { coupon, error: null });
});

router.post('/coupons/edit/:id', ensureShopAdmin, async (req, res) => {
  const { code, discountType, discountValue, minOrderAmount, maxUses, startDate, endDate, active,
          minDevices, oncePerUser, allowedEmails } = req.body;
  try {
    const emailList = allowedEmails ? allowedEmails.split(',').map(e => e.trim().toLowerCase()).filter(e => e) : [];

    await Coupon.findByIdAndUpdate(req.params.id, {
      code: code.toUpperCase(),
      discountType,
      discountValue: parseFloat(discountValue),
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      maxUses: parseInt(maxUses) || 0,
      minDevices: parseInt(minDevices) || 0,
      oncePerUser: oncePerUser === 'on',
      allowedEmails: emailList,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      active: active === 'on'
    });
    req.session.success_msg = 'Coupon updated.';
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Error updating coupon.';
    res.redirect(`/admin/coupons/edit/${req.params.id}`);
  }
});

router.get('/coupons/delete/:id', ensureShopAdmin, async (req, res) => {
  await Coupon.findByIdAndDelete(req.params.id);
  req.session.success_msg = 'Coupon deleted.';
  res.redirect('/admin/coupons');
});

// Bulk coupon generation
router.get('/coupons/bulk', ensureShopAdmin, (req, res) => {
  res.render('admin/bulk-coupons', { error: null });
});

router.post('/coupons/bulk', ensureShopAdmin, async (req, res) => {
  const { prefix, count, discountType, discountValue, minOrderAmount, minDevices, oncePerUser,
          allowedEmails, startDate, endDate, active, maxUses } = req.body;
  try {
    const num = parseInt(count);
    if (!num || num <= 0 || num > 500) {
      return res.render('admin/bulk-coupons', { error: 'Enter a valid count (1-500).' });
    }
    const emailList = allowedEmails ? allowedEmails.split(',').map(e => e.trim().toLowerCase()).filter(e => e) : [];
    const baseCode = prefix ? prefix.toUpperCase() : 'BULK';
    const coupons = [];
    for (let i = 0; i < num; i++) {
      const random = Math.floor(1000 + Math.random() * 9000);
      const code = `${baseCode}-${random}`;
      coupons.push({
        code,
        discountType,
        discountValue: parseFloat(discountValue),
        minOrderAmount: parseFloat(minOrderAmount) || 0,
        maxUses: parseInt(maxUses) || 0,
        minDevices: parseInt(minDevices) || 0,
        oncePerUser: oncePerUser === 'on',
        allowedEmails: emailList,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        active: active === 'on'
      });
    }
    await Coupon.insertMany(coupons);
    req.session.success_msg = `${num} coupons created!`;
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Bulk generation failed.';
    res.redirect('/admin/coupons/bulk');
  }
});

// ================== ANNOUNCEMENTS ==================
router.get('/announcements', ensureShopAdmin, async (req, res) => {
  const settings = await ShopSettings.getSettings();
  const announcements = await Announcement.find().sort({ createdAt: -1 }).lean();
  res.render('admin/announcements', { announcements, settings });
});

router.get('/announcements/create', ensureShopAdmin, (req, res) => {
  res.render('admin/announcement-form', { announcement: null });
});

router.post('/announcements/create', ensureShopAdmin, async (req, res) => {
  const { message, startDate, endDate, active } = req.body;
  try {
    await Announcement.create({
      message,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      active: active === 'on'
    });
    req.session.success_msg = 'Announcement created!';
    res.redirect('/admin/announcements');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Error creating announcement.';
    res.redirect('/admin/announcements/create');
  }
});

router.get('/announcements/edit/:id', ensureShopAdmin, async (req, res) => {
  const announcement = await Announcement.findById(req.params.id);
  if (!announcement) return res.redirect('/admin/announcements');
  res.render('admin/announcement-form', { announcement });
});

router.post('/announcements/edit/:id', ensureShopAdmin, async (req, res) => {
  const { message, startDate, endDate, active } = req.body;
  try {
    await Announcement.findByIdAndUpdate(req.params.id, {
      message,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      active: active === 'on'
    });
    req.session.success_msg = 'Announcement updated.';
    res.redirect('/admin/announcements');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Error updating announcement.';
    res.redirect(`/admin/announcements/edit/${req.params.id}`);
  }
});

router.get('/announcements/delete/:id', ensureShopAdmin, async (req, res) => {
  await Announcement.findByIdAndDelete(req.params.id);
  req.session.success_msg = 'Announcement deleted.';
  res.redirect('/admin/announcements');
});

// ================== EXPORT ORDERS CSV (FIXED AMOUNTS) ==================
router.get('/export-orders', ensureShopAdmin, async (req, res) => {
  try {
    const orders = await ShopOrder.find()
      .populate('userId', 'email')
      .sort({ createdAt: -1 })
      .lean();

    let csv = 'Order ID,Customer Email,Duration (Days),Max Devices,Amount,Status,Coupon,Discount,License Key,Date\n';
    orders.forEach(order => {
      const created = new Date(order.createdAt);
      const expiry = new Date(order.keyDetails.expiryDate);
      const days = Math.ceil((expiry - created) / (1000 * 60 * 60 * 24));
      // Use toFixed for clean CSV output
      const amount = Number(order.amount).toFixed(2);
      const discount = Number(order.discountAmount || 0).toFixed(2);
      csv += `${order.razorpayOrderId},${order.userId?.email || 'N/A'},${days},${order.keyDetails.maxDevices},₹${amount},${order.status},${order.couponCode || 'None'},₹${discount},${order.generatedKey || 'N/A'},${created.toLocaleDateString('en-IN')}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
    res.send(csv);
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'Failed to export CSV.';
    res.redirect('/admin/dashboard');
  }
});

// ================== ADMIN ORDER DETAIL PAGE ==================
router.get('/order-detail/:orderId', ensureShopAdmin, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.orderId)
      .populate('userId', 'email username provider')
      .lean();
    if (!order) return res.redirect('/admin/orders');
    const settings = await ShopSettings.getSettings();
    res.render('admin/order-detail', { order, settings });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/orders');
  }
});

// Admin invoice download
router.get('/invoice/:orderId', ensureShopAdmin, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.orderId).populate('userId');
    if (!order) return res.status(404).render('error', { message: 'Order not found' });
    const settings = await ShopSettings.getSettings();
    const { generateInvoice } = require('../services/invoice');
    await generateInvoice(res, order, settings);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Failed to generate invoice.' });
  }
});

// ================== 2FA SETTINGS ==================
router.get('/settings/2fa', ensureShopAdmin, async (req, res) => {
  try {
    const admin = await ShopAdmin.findById(req.session.shopAdminId);
    if (admin.twoFactorEnabled) {
      return res.render('admin/2fa-status', { enabled: true, adminRole: req.session.shopAdminRole });
    }
    const secret = speakeasy.generateSecret({
      name: `KeyShop (${admin.email})`
    });
    req.session.temp2FASecret = secret.base32;
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.render('admin/setup-2fa', {
      qrCodeUrl,
      secret: secret.base32,
      error: null,
      adminRole: req.session.shopAdminRole
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
});

router.post('/settings/2fa/verify', ensureShopAdmin, async (req, res) => {
  const { token } = req.body;
  const secret = req.session.temp2FASecret;
  if (!secret) return res.redirect('/admin/settings/2fa');

  const verified = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!verified) {
    const admin = await ShopAdmin.findById(req.session.shopAdminId);
    const qrCodeUrl = await QRCode.toDataURL(`otpauth://totp/KeyShop%20(${admin.email})?secret=${secret}`);
    return res.render('admin/setup-2fa', {
      qrCodeUrl,
      secret,
      error: 'Invalid OTP. Try again.',
      adminRole: req.session.shopAdminRole
    });
  }

  await ShopAdmin.findByIdAndUpdate(req.session.shopAdminId, {
    twoFactorEnabled: true,
    twoFactorSecret: secret
  });
  delete req.session.temp2FASecret;
  req.session.success_msg = 'Two‑factor authentication enabled.';
  res.redirect('/admin/dashboard');
});

router.post('/settings/2fa/disable', ensureShopAdmin, async (req, res) => {
  await ShopAdmin.findByIdAndUpdate(req.session.shopAdminId, {
    twoFactorEnabled: false,
    twoFactorSecret: null
  });
  req.session.success_msg = 'Two‑factor authentication disabled.';
  res.redirect('/admin/dashboard');
});

// ================== 2FA LOGIN VERIFICATION ==================
router.get('/verify-2fa', (req, res) => {
  if (!req.session.tempAdminId) return res.redirect('/admin/login');
  res.render('admin/verify-2fa', { error: null });
});

router.post('/verify-2fa', async (req, res) => {
  const adminId = req.session.tempAdminId;
  if (!adminId) return res.redirect('/admin/login');

  const admin = await ShopAdmin.findById(adminId);
  const { token } = req.body;
  const verified = speakeasy.totp.verify({
    secret: admin.twoFactorSecret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!verified) {
    return res.render('admin/verify-2fa', { error: 'Invalid OTP code' });
  }

  req.session.shopAdminId = admin._id;
  req.session.shopAdminRole = admin.role;
  delete req.session.tempAdminId;
  res.redirect('/admin/dashboard');
});

// ================== SUPPORT TICKETS ==================
router.get('/tickets', ensureShopAdmin, async (req, res) => {
  const tickets = await SupportTicket.find()
    .populate('userId', 'email username')
    .sort({ createdAt: -1 })
    .lean();
  res.render('admin/tickets', { tickets });
});

router.get('/tickets/close/:id', ensureShopAdmin, async (req, res) => {
  await SupportTicket.findByIdAndUpdate(req.params.id, { status: 'closed' });
  req.session.success_msg = 'Ticket closed.';
  res.redirect('/admin/tickets');
});

module.exports = router;
