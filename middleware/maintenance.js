const ShopSettings = require('../models/ShopSettings');

module.exports = async (req, res, next) => {
  try {
    const settings = await ShopSettings.getSettings();
    console.log(`🛠️ Maintenance: path=${req.path}, mode=${settings.maintenanceMode}`);

    if (!settings.maintenanceMode) {
      // Maintenance off – sab allow
      return next();
    }

    // Maintenance ON: allowed paths
    const allowed = ['/admin', '/css', '/js', '/favicon.ico'];
    const isAllowed = allowed.some(p => req.path.startsWith(p));

    if (isAllowed) {
      console.log(`   → Allowed: ${req.path}`);
      return next();
    }

    // Block with maintenance page
    console.log(`   → Blocked: ${req.path}`);
    return res.status(503).render('maintenance', {
      message: 'We are under maintenance. Please try again later.'
    });
  } catch (err) {
    console.error('Maintenance middleware error:', err);
    // If error (e.g., DB not ready), play safe: block access? Ya allow?
    // Better to block with a generic maintenance page
    return res.status(503).render('maintenance', {
      message: 'Service temporarily unavailable.'
    });
  }
};