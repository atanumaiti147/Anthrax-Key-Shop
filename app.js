require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const ejs = require('ejs');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const shopRoutes = require('./routes/shop');
const adminRoutes = require('./routes/admin');
const supportRoutes = require('./routes/support');          // 🆕 Support ticket routes

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files (serve even during maintenance)
app.use(express.static('public'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'shop-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
const ShopUser = require('./models/ShopUser');
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await ShopUser.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// ========== GLOBAL SETTINGS LOADER ==========
app.use(async (req, res, next) => {
  try {
    const settings = await require('./models/ShopSettings').getSettings();
    res.locals.settings = settings;
  } catch (err) {
    res.locals.settings = { siteName: 'Key Shop' };
  }
  next();
});

// ========== ADMIN ROLE GLOBAL ==========
app.use((req, res, next) => {
  res.locals.adminRole = req.session.shopAdminRole || null;
  next();
});

// ========== FLASH MESSAGES MIDDLEWARE ==========
app.use((req, res, next) => {
  res.locals.success_msg = req.session.success_msg || null;
  res.locals.error_msg = req.session.error_msg || null;
  delete req.session.success_msg;
  delete req.session.error_msg;
  next();
});

// ========== ANNOUNCEMENT MIDDLEWARE ==========
app.use(require('./middleware/announcement'));

// ========== MAINTENANCE MIDDLEWARE ==========
app.use(require('./middleware/maintenance'));

// ========== ROUTES ==========
app.use('/', publicRoutes);
app.use('/auth', authRoutes);
app.use('/shop', shopRoutes);
app.use('/admin', adminRoutes);
app.use('/support', supportRoutes);                        // 🆕 Mount support routes

// Home page (landing)
app.get('/', async (req, res) => {
  const settings = await require('./models/ShopSettings').getSettings();
  res.render('index', { settings, user: req.user });
});

// 404 handler
app.use((req, res) => res.status(404).render('error', { message: 'Page not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).render('error', { message: 'Server error' });
});

// Connect to MongoDB then start server & cron jobs
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected (Shop)');

    // 🆕 Start expiry reminder cron (every day at 9 AM)
    require('./services/expiry-reminders').start();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🛒 Shop running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });