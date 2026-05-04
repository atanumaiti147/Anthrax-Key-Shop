const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const ShopUser = require('../models/ShopUser');
const ShopSettings = require('../models/ShopSettings');
const axios = require('axios');

const router = express.Router();

// Helper to get Discord strategy config (UPDATED SCOPE)
const getDiscordConfig = () => {
  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    return {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: '/auth/discord/callback',
      scope: ['identify', 'email', 'guilds.join']   // 👈 guilds.join added
    };
  }
  return null;
};

// Helper to get Google strategy config
const getGoogleConfig = () => {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback'
    };
  }
  return null;
};

// Initialize strategies only if credentials exist
(async () => {
  const settings = await ShopSettings.getSettings();

  const discordConfig = getDiscordConfig();
  if (discordConfig && settings.enableDiscordLogin) {
    passport.use('discord', new DiscordStrategy(discordConfig, async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await ShopUser.findOne({ provider: 'discord', providerId: profile.id });
        if (!user) {
          user = new ShopUser({
            provider: 'discord',
            providerId: profile.id,
            email: profile.email,
            username: profile.username,
            discordId: profile.id
          });
          await user.save();
        }
        // Pass accessToken as extra info
        return done(null, user, { accessToken });   // 👈 important
      } catch (err) {
        done(err);
      }
    }));
  }

  const googleConfig = getGoogleConfig();
  if (googleConfig && settings.enableGoogleLogin) {
    passport.use('google', new GoogleStrategy(googleConfig, async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await ShopUser.findOne({ provider: 'google', providerId: profile.id });
        if (!user) {
          user = new ShopUser({
            provider: 'google',
            providerId: profile.id,
            email: profile.emails[0].value,
            username: profile.displayName,
            googleId: profile.id
          });
          await user.save();
        }
        return done(null, user);
      } catch (err) {
        done(err);
      }
    }));
  }
})();

// Login page (show buttons)
router.get('/login', async (req, res) => {
  try {
    const settings = await ShopSettings.getSettings();
    res.render('auth/login', {
      settings: settings,
      local_settings: settings,
      user: req.user
    });
  } catch (err) {
    res.render('auth/login', { settings: null, local_settings: null, user: req.user });
  }
});

// Discord auth
router.get('/discord', (req, res, next) => {
  if (!passport._strategies.discord) {
    return res.status(404).send('Discord login not available');
  }
  passport.authenticate('discord')(req, res, next);
});

// Discord callback – FIXED auto‑join + Welcome DM
router.get('/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/auth/login' }),
  async (req, res) => {
    if (req.user && req.user.provider === 'discord') {
      const guildId = process.env.DISCORD_GUILD_ID;
      const accessToken = req.authInfo?.accessToken;

      // 1. Auto‑join guild
      if (guildId && accessToken) {
        try {
          await axios.put(
            `https://discord.com/api/v10/guilds/${guildId}/members/${req.user.providerId}`,
            { access_token: accessToken },
            {
              headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          console.log(`✅ User ${req.user.username} joined the guild`);
        } catch (err) {
          const status = err.response?.status;
          if (status === 204) {
            console.log(`ℹ️ User already in guild`);
          } else {
            console.error('❌ Failed to add member:', err.response?.data || err.message);
          }
        }
      }

      // 2. Send welcome DM
      try {
        const { sendWelcomeDM } = require('../services/discordBot');
        await sendWelcomeDM(req.user.providerId, req.user.username);
      } catch (err) {
        console.error('Welcome DM error:', err.message);
      }
    }
    res.redirect('/shop/purchase');
  }
);

// Google auth
router.get('/google', (req, res, next) => {
  if (!passport._strategies.google) {
    return res.status(404).send('Google login not available');
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login' }),
  (req, res) => {
    res.redirect('/shop/purchase');
  }
);

// Logout
router.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

module.exports = router;