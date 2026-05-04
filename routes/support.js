const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const { sendTicketLog } = require('../services/discordBot');

// ensure auth (same as shop)
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = '/support';
  res.redirect('/auth/login');
}

// Submit ticket page
router.get('/', ensureAuth, async (req, res) => {
  res.render('support', { user: req.user });
});

// Handle submission
router.post('/', ensureAuth, async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) {
    return res.render('support', { user: req.user, error: 'Please fill all fields.' });
  }
  try {
    const ticket = new SupportTicket({
      userId: req.user._id,
      email: req.user.email || '',
      discordUsername: req.user.discordUsername || (req.user.username || ''),
      subject,
      message
    });
    await ticket.save();

    // Send to Discord
    try {
      await sendTicketLog(ticket, req.user);
    } catch (e) { console.error('Discord ticket log failed:', e); }

    req.session.success_msg = 'Ticket submitted successfully! We will get back to you soon.';
    res.redirect('/support/success'); // or just redirect to a thank you page
  } catch (err) {
    console.error(err);
    res.render('support', { user: req.user, error: 'Error submitting ticket.' });
  }
});

// Success page (optional)
router.get('/success', (req, res) => res.render('support-success'));

// View my tickets
router.get('/my', ensureAuth, async (req, res) => {
  const tickets = await SupportTicket.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.render('support-tickets', { tickets });
});

module.exports = router;