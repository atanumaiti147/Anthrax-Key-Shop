const Announcement = require('../models/Announcement');

module.exports = async (req, res, next) => {
  try {
    const now = new Date();
    const announcement = await Announcement.findOne({
      active: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });
    res.locals.announcement = announcement;
  } catch (err) {
    res.locals.announcement = null;
  }
  next();
};