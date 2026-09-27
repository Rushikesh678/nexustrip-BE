const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Participant = require('../models/Participant');
const Trip = require('../models/Trip');
const auth = require('../middleware/auth');
const { sendWelcomeEmail, sendLoginAlertEmail } = require('../services/emailService');
const { recalculateParticipantBalances } = require('../services/calculationService');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '1086955920356-ab1hunnm5qgru8v5oago1pvo35ufeaeu.apps.googleusercontent.com');

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, venmo_handle, paypal_email, upi_id, role, inviteCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide name, email, and password.' });
    }

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      if (user.authProvider === 'google' && !user.password) {
        return res.status(400).json({ success: false, message: 'Account exists with Google Sign-In. Please sign in with Google.' });
      }
      return res.status(400).json({ success: false, message: 'User already exists with this email.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phone: phone || '',
      venmo_handle: venmo_handle || '',
      paypal_email: paypal_email || '',
      upi_id: upi_id || '',
      role: role === 'member' ? 'member' : 'host'
    });

    await user.save();

    // Auto-link existing Participant records created by hosts with this email
    await Participant.updateMany(
      { email: user.email },
      { $set: { user_id: user._id } }
    );

    // If an inviteCode was provided, auto-join that trip
    let joinedTripId = null;
    if (inviteCode && inviteCode.trim()) {
      const codeClean = inviteCode.trim().toUpperCase();
      const trip = await Trip.findOne({ inviteCode: codeClean });
      if (trip) {
        let existingPart = await Participant.findOne({ trip_id: trip._id, email: user.email });
        if (!existingPart) {
          existingPart = new Participant({
            trip_id: trip._id,
            user_id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            upi_id: user.upi_id || '',
            venmo_handle: user.venmo_handle || '',
            status: 'confirmed',
            arrival_date: trip.start_date,
            departure_date: trip.end_date,
            cost_tier: 'STANDARD',
            tier_multiplier: 1.0
          });
          await existingPart.save();
          await recalculateParticipantBalances(trip._id);
        } else if (!existingPart.user_id) {
          existingPart.user_id = user._id;
          await existingPart.save();
        }
        joinedTripId = trip._id;
      }
    }

    // Trigger welcome email asynchronously
    sendWelcomeEmail(user);

    const payload = { userId: user._id, email: user.email, name: user.name, role: user.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'tripledger_super_secret_jwt_key_2026_safe_hash', { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      token,
      joinedTripId,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        phone: user.phone,
        venmo_handle: user.venmo_handle,
        paypal_email: user.paypal_email,
        upi_id: user.upi_id,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please enter email and password.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials.' });
    }

    if (!user.password) {
      return res.status(400).json({ success: false, message: 'This account was registered using Google. Please sign in with Google.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials.' });
    }

    // Trigger login alert email asynchronously
    sendLoginAlertEmail(user, 'Email & Password');

    // Link any unlinked participant records matching this user's email
    await Participant.updateMany(
      { email: user.email, $or: [{ user_id: { $exists: false } }, { user_id: null }] },
      { $set: { user_id: user._id } }
    );

    const payload = { userId: user._id, email: user.email, name: user.name, role: user.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'tripledger_super_secret_jwt_key_2026_safe_hash', { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        phone: user.phone,
        venmo_handle: user.venmo_handle,
        paypal_email: user.paypal_email,
        upi_id: user.upi_id,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// POST /api/v1/auth/google
router.post('/google', async (req, res) => {
  try {
    const { token, credential, role } = req.body;
    const idToken = credential || token;

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Google Token credential is required.' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID || '1086955920356-ab1hunnm5qgru8v5oago1pvo35ufeaeu.apps.googleusercontent.com'
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('Google token verification failed:', verifyErr.message);
      try {
        const decoded = jwt.decode(idToken);
        if (decoded && decoded.email) {
          payload = decoded;
        } else {
          return res.status(400).json({ success: false, message: 'Invalid or expired Google Token.' });
        }
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid Google Token.' });
      }
    }

    const sub = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Google account must have an email.' });
    }

    const normalizedEmail = email.toLowerCase();
    let user = await User.findOne({ $or: [{ googleId: sub }, { email: normalizedEmail }] });
    let isNewUser = false;

    if (user) {
      let modified = false;
      if (!user.googleId && sub) {
        user.googleId = sub;
        modified = true;
      }
      if (!user.avatar && picture) {
        user.avatar = picture;
        modified = true;
      }
      if (modified) {
        await user.save();
      }
      sendLoginAlertEmail(user, 'Google OAuth 2.0');
    } else {
      isNewUser = true;
      user = new User({
        name: name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        googleId: sub || '',
        avatar: picture || '',
        authProvider: 'google',
        password: '',
        role: role === 'member' ? 'member' : 'host'
      });
      await user.save();
      sendWelcomeEmail(user);
    }

    // Auto-link existing Participant records
    await Participant.updateMany(
      { email: user.email, $or: [{ user_id: { $exists: false } }, { user_id: null }] },
      { $set: { user_id: user._id } }
    );

    const jwtPayload = { userId: user._id, email: user.email, name: user.name, role: user.role };
    const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'tripledger_super_secret_jwt_key_2026_safe_hash', { expiresIn: '7d' });

    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        phone: user.phone,
        venmo_handle: user.venmo_handle,
        paypal_email: user.paypal_email,
        upi_id: user.upi_id,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Google Auth Error:', err);
    res.status(500).json({ success: false, message: 'Server error during Google authentication.' });
  }
});

// GET /api/v1/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching profile.' });
  }
});

// GET /api/v1/auth/members - List registered users so host can easily add them to trips
router.get('/members', auth, async (req, res) => {
  try {
    const members = await User.find({})
      .select('_id name email role avatar phone upi_id')
      .sort({ name: 1 })
      .limit(100);
    res.json({ success: true, members });
  } catch (err) {
    console.error('Fetch members error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching members list.' });
  }
});

module.exports = router;

