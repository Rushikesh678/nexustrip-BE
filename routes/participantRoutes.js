const express = require('express');
const router = express.Router({ mergeParams: true });
const Participant = require('../models/Participant');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const Expense = require('../models/Expense');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { recalculateParticipantBalances } = require('../services/calculationService');

// POST /api/v1/trips/:tripId/participants - Add new participant
router.post('/', auth, async (req, res) => {
  try {
    const { name, email, phone, cost_tier, tier_multiplier, arrival_date, departure_date, status, venmo_handle, paypal_email, upi_id, user_id } = req.body;
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required.' });
    }

    // Check if participant with this email already exists in trip
    let participant = await Participant.findOne({ trip_id: tripId, email: email.toLowerCase().trim() });
    if (participant) {
      return res.status(400).json({ success: false, message: 'Participant with this email is already added to this trip.' });
    }

    // Look for existing registered user by user_id or email
    let linkedUserId = user_id || null;
    let registeredUser = null;
    if (linkedUserId) {
      registeredUser = await User.findById(linkedUserId);
    } else {
      registeredUser = await User.findOne({ email: email.toLowerCase().trim() });
      if (registeredUser) linkedUserId = registeredUser._id;
    }

    participant = new Participant({
      trip_id: tripId,
      user_id: linkedUserId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone || registeredUser?.phone || '',
      cost_tier: cost_tier || 'STANDARD',
      tier_multiplier: tier_multiplier || 1.0,
      arrival_date: arrival_date ? new Date(arrival_date) : trip.start_date,
      departure_date: departure_date ? new Date(departure_date) : trip.end_date,
      status: status || 'confirmed',
      venmo_handle: venmo_handle || registeredUser?.venmo_handle || '',
      paypal_email: paypal_email || registeredUser?.paypal_email || '',
      upi_id: upi_id || registeredUser?.upi_id || ''
    });

    await participant.save();

    // Recalculate balances
    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'PARTICIPANT_ADDED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'PARTICIPANT', id: participant._id.toString() },
      reason: `Added participant ${name}`
    });

    res.status(201).json({ success: true, participant });
  } catch (err) {
    console.error('Add participant error:', err);
    res.status(500).json({ success: false, message: 'Server error adding participant.' });
  }
});

// GET /api/v1/trips/:tripId/participants - List participants
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    await recalculateParticipantBalances(tripId);
    const participants = await Participant.find({ trip_id: tripId });
    res.json({ success: true, participants });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching participants.' });
  }
});

// PUT /api/v1/trips/:tripId/participants/:pid - Update participant
router.put('/:pid', auth, async (req, res) => {
  try {
    const { tripId, pid } = req.params;
    const participant = await Participant.findOne({ _id: pid, trip_id: tripId });
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Participant not found.' });
    }

    const { name, phone, status, cost_tier, tier_multiplier, arrival_date, departure_date, venmo_handle, paypal_email, upi_id } = req.body;

    if (name) participant.name = name;
    if (phone !== undefined) participant.phone = phone;
    if (status) participant.status = status;
    if (cost_tier) participant.cost_tier = cost_tier;
    if (tier_multiplier !== undefined) participant.tier_multiplier = tier_multiplier;
    if (arrival_date) participant.arrival_date = new Date(arrival_date);
    if (departure_date) participant.departure_date = new Date(departure_date);
    if (venmo_handle !== undefined) participant.venmo_handle = venmo_handle;
    if (paypal_email !== undefined) participant.paypal_email = paypal_email;
    if (upi_id !== undefined) participant.upi_id = upi_id;

    await participant.save();

    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'PARTICIPANT_UPDATED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'PARTICIPANT', id: participant._id.toString() },
      reason: `Updated participant details for ${participant.name}`
    });

    res.json({ success: true, participant });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating participant.' });
  }
});

// POST /api/v1/trips/:tripId/participants/:pid/depart - Handle early departure recalculation
router.post('/:pid/depart', auth, async (req, res) => {
  try {
    const { tripId, pid } = req.params;
    const { departure_date, reason } = req.body;

    const participant = await Participant.findOne({ _id: pid, trip_id: tripId });
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Participant not found.' });
    }

    const departDate = departure_date ? new Date(departure_date) : new Date();

    participant.status = 'departed';
    participant.leftDate = departDate;
    participant.departure_date = departDate;
    if (reason) participant.removal_reason = reason;

    await participant.save();

    // Recalculate trip balances with updated departure date
    await recalculateParticipantBalances(tripId);
    const updatedParticipant = await Participant.findById(pid);

    await AuditLog.create({
      tripId,
      action: 'PARTICIPANT_DEPARTED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'PARTICIPANT', id: pid },
      reason: `Participant ${participant.name} departed on ${departDate.toISOString().split('T')[0]}. ${reason || ''}`
    });

    res.json({
      success: true,
      message: `${participant.name} marked as departed on ${departDate.toISOString().split('T')[0]}. Costs recalculated.`,
      participant: updatedParticipant
    });
  } catch (err) {
    console.error('Depart error:', err);
    res.status(500).json({ success: false, message: 'Server error processing participant departure.' });
  }
});

// DELETE /api/v1/trips/:tripId/participants/:pid - Remove participant
router.delete('/:pid', auth, async (req, res) => {
  try {
    const { tripId, pid } = req.params;
    const participant = await Participant.findOne({ _id: pid, trip_id: tripId });
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Participant not found.' });
    }

    participant.status = 'removed';
    participant.removed_at = new Date();
    await participant.save();

    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'PARTICIPANT_REMOVED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'PARTICIPANT', id: pid },
      reason: `Removed participant ${participant.name}`
    });

    res.json({ success: true, message: 'Participant marked as removed.', participant });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error removing participant.' });
  }
});

module.exports = router;
