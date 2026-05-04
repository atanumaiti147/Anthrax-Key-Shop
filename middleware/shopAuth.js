// Existing ensureShopAdmin
module.exports.ensureShopAdmin = (req, res, next) => {
  if (req.session && req.session.shopAdminId) return next();
  res.redirect('/admin/login');
};

// New: allow only super_admin
module.exports.ensureSuperAdmin = (req, res, next) => {
  if (req.session && req.session.shopAdminRole === 'super_admin') return next();
  req.session.error_msg = 'You need super admin privileges.';
  res.redirect('/admin/dashboard');
};