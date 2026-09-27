const express = require('express');
const router = express.Router();
const Trip = require('../models/Trip');
const Participant = require('../models/Participant');
const Expense = require('../models/Expense');
const Booking = require('../models/Booking');
const ItineraryBlock = require('../models/ItineraryBlock');
const AuditLog = require('../models/AuditLog');
const LedgerEntry = require('../models/LedgerEntry');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const Settlement = require('../models/Settlement');
const auth = require('../middleware/auth');
const { recalculateParticipantBalances } = require('../services/calculationService');

// Helper to generate unique readable invite code
const generateInviteCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'EXP-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// POST /api/v1/trips - Create trip
router.post('/', auth, async (req, res) => {
  try {
    const {
      name, description, destination, start_date, end_date, currency,
      budget, cost_sharing_model, refund_policy, rounding_method, settings
    } = req.body;

    if (!name || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'Please provide trip name, start date, and end date.' });
    }

    // Ensure unique inviteCode
    let inviteCode = generateInviteCode();
    while (await Trip.findOne({ inviteCode })) {
      inviteCode = generateInviteCode();
    }

    const trip = new Trip({
      name,
      description: description || '',
      destination: destination || '',
      organizer_id: req.user.userId,
      inviteCode,
      start_date: new Date(start_date),
      end_date: new Date(end_date),
      currency: currency || 'USD',
      budget: budget || 0,
      cost_sharing_model: cost_sharing_model || 'equal',
      refund_policy: refund_policy || 'full',
      rounding_method: rounding_method || 'last_person',
      settings: settings || {}
    });

    await trip.save();

    // Auto-create Organizer as first confirmed participant
    const hostParticipant = new Participant({
      trip_id: trip._id,
      user_id: req.user.userId,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone || '',
      upi_id: req.user.upi_id || '',
      venmo_handle: req.user.venmo_handle || '',
      status: 'active',
      arrival_date: trip.start_date,
      departure_date: trip.end_date
    });
    await hostParticipant.save();

    // Log action
    await AuditLog.create({
      tripId: trip._id,
      action: 'TRIP_CREATED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'TRIP', id: trip._id.toString() },
      reason: 'Created new group trip'
    });

    res.status(201).json({ success: true, trip, hostParticipant });
  } catch (err) {
    console.error('Create trip error:', err);
    res.status(500).json({ success: false, message: 'Server error creating trip.' });
  }
});

// POST /api/v1/trips/join - Member joins trip with invite code
router.post('/join', auth, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode || !inviteCode.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide a valid Trip Invite Code.' });
    }

    const cleanCode = inviteCode.trim().toUpperCase();
    const trip = await Trip.findOne({ inviteCode: cleanCode });
    if (!trip) {
      return res.status(404).json({ success: false, message: 'No trip found matching this invite code. Please check with your host.' });
    }

    // Check if user is already a participant
    let participant = await Participant.findOne({
      trip_id: trip._id,
      $or: [{ user_id: req.user.userId }, { email: req.user.email.toLowerCase() }]
    });

    if (participant) {
      if (!participant.user_id) {
        participant.user_id = req.user.userId;
        await participant.save();
      }
      return res.json({
        success: true,
        message: `You are already part of "${trip.name}"!`,
        tripId: trip._id,
        trip
      });
    }

    // Create participant for member
    participant = new Participant({
      trip_id: trip._id,
      user_id: req.user.userId,
      name: req.user.name,
      email: req.user.email.toLowerCase(),
      phone: req.user.phone || '',
      upi_id: req.user.upi_id || '',
      venmo_handle: req.user.venmo_handle || '',
      status: 'confirmed',
      arrival_date: trip.start_date,
      departure_date: trip.end_date,
      cost_tier: 'STANDARD',
      tier_multiplier: 1.0
    });
    await participant.save();

    await recalculateParticipantBalances(trip._id);

    await AuditLog.create({
      tripId: trip._id,
      action: 'MEMBER_JOINED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'PARTICIPANT', id: participant._id.toString() },
      reason: `${req.user.name} joined trip via invite code ${cleanCode}`
    });

    res.status(201).json({
      success: true,
      message: `Successfully joined "${trip.name}"!`,
      tripId: trip._id,
      trip
    });
  } catch (err) {
    console.error('Join trip error:', err);
    res.status(500).json({ success: false, message: 'Server error joining trip.' });
  }
});

// GET /api/v1/trips - List all trips for logged-in user
router.get('/', auth, async (req, res) => {
  try {
    // Find participants matching user_id or email
    const participantRecords = await Participant.find({
      $or: [{ user_id: req.user.userId }, { email: req.user.email.toLowerCase() }]
    });
    const tripIds = participantRecords.map(p => p.trip_id);

    const trips = await Trip.find({
      $or: [{ organizer_id: req.user.userId }, { _id: { $in: tripIds } }]
    }).populate('organizer_id', 'name email').sort({ createdAt: -1 });

    // Backfill inviteCode for any legacy trips
    for (const t of trips) {
      if (!t.inviteCode) {
        t.inviteCode = generateInviteCode();
        await t.save();
      }
    }

    // Attach isOrganizer flag
    const formattedTrips = trips.map(t => {
      const orgId = t.organizer_id?._id ? t.organizer_id._id.toString() : t.organizer_id?.toString();
      const isOrganizer = orgId === req.user.userId.toString();
      return {
        ...t.toObject(),
        isOrganizer
      };
    });

    res.json({ success: true, trips: formattedTrips });
  } catch (err) {
    console.error('List trips error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching trips.' });
  }
});

// GET /api/v1/trips/:tripId - Get single trip details with stats
router.get('/:tripId', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.tripId).populate('organizer_id', 'name email');
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    if (!trip.inviteCode) {
      trip.inviteCode = generateInviteCode();
      await trip.save();
    }

    const participants = await Participant.find({ trip_id: trip._id });
    const expenses = await Expense.find({ tripId: trip._id, status: { $ne: 'DELETED' } }).populate('payerId', 'name email');
    const bookings = await Booking.find({ trip_id: trip._id, status: { $ne: 'cancelled' } });
    const itineraryBlocks = await ItineraryBlock.find({ trip_id: trip._id }).lean();

    // Ensure balances are updated
    await recalculateParticipantBalances(trip._id);
    const updatedParticipants = await Participant.find({ trip_id: trip._id });

    const totalExpenseCost = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalBookingCost = bookings.reduce((sum, b) => sum + b.total_cost, 0);

    // Current user's participant profile
    const myParticipant = updatedParticipants.find(
      p => (p.user_id && p.user_id.toString() === req.user.userId) || p.email === req.user.email
    );

    res.json({
      success: true,
      trip,
      participants: updatedParticipants,
      expenses,
      bookings,
      itineraryBlocks: itineraryBlocks || [],
      myParticipant,
      stats: {
        totalSpent: totalExpenseCost + totalBookingCost,
        totalExpenses: totalExpenseCost,
        totalBookings: totalBookingCost,
        budget: trip.budget || 0,
        budgetUsedPercentage: trip.budget > 0 ? Math.round(((totalExpenseCost + totalBookingCost) / trip.budget) * 100) : 0,
        participantCount: updatedParticipants.length
      }
    });
  } catch (err) {
    console.error('Get trip error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching trip details.' });
  }
});

// PUT /api/v1/trips/:tripId - Update trip details & settings
router.put('/:tripId', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    // Check authorization (must be organizer or co-organizer)
    if (trip.organizer_id.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the organizer can modify trip settings.' });
    }

    const {
      name, description, destination, start_date, end_date, currency,
      budget, status, cost_sharing_model, refund_policy, rounding_method, settings
    } = req.body;

    if (name) trip.name = name;
    if (description !== undefined) trip.description = description;
    if (destination !== undefined) trip.destination = destination;
    if (start_date) trip.start_date = new Date(start_date);
    if (end_date) trip.end_date = new Date(end_date);
    if (currency) trip.currency = currency;
    if (budget !== undefined) trip.budget = budget;
    if (status) trip.status = status;
    if (cost_sharing_model) trip.cost_sharing_model = cost_sharing_model;
    if (refund_policy) trip.refund_policy = refund_policy;
    if (rounding_method) trip.rounding_method = rounding_method;
    if (settings) trip.settings = { ...trip.settings, ...settings };

    await trip.save();

    await AuditLog.create({
      tripId: trip._id,
      action: 'TRIP_UPDATED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'TRIP', id: trip._id.toString() },
      reason: 'Updated trip parameters'
    });

    res.json({ success: true, trip });
  } catch (err) {
    console.error('Update trip error:', err);
    res.status(500).json({ success: false, message: 'Server error updating trip.' });
  }
});

// DELETE /api/v1/trips/:tripId - Permanently delete entire trip
router.delete('/:tripId', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }
    if (trip.organizer_id.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the trip host can delete this trip.' });
    }

    const tripId = trip._id;

    // Permanently remove all trip-related collections and data
    await Promise.all([
      Participant.deleteMany({ trip_id: tripId }),
      Expense.deleteMany({ tripId: tripId }),
      Booking.deleteMany({ trip_id: tripId }),
      AuditLog.deleteMany({ tripId: tripId }),
      LedgerEntry.deleteMany({ trip_id: tripId }),
      Payment.deleteMany({ trip_id: tripId }),
      Refund.deleteMany({ trip_id: tripId }),
      Settlement.deleteMany({ tripId: tripId }),
      Trip.findByIdAndDelete(tripId)
    ]);

    res.json({ success: true, message: `Trip "${trip.name}" and all associated records have been permanently deleted.` });
  } catch (err) {
    console.error('Delete trip error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting trip.' });
  }
});

module.exports = router;
