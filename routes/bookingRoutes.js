const express = require('express');
const router = express.Router({ mergeParams: true });
const Booking = require('../models/Booking');
const Trip = require('../models/Trip');
const Participant = require('../models/Participant');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const { calculateParticipantShare, recalculateParticipantBalances } = require('../services/calculationService');

// POST /api/v1/trips/:tripId/bookings - Create booking
router.post('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const {
      description, location, type, vendor_name, booking_reference, start_date, end_date,
      quantity, total_cost, currency, allocation_model, assigned_participant_ids,
      paid_by, refund_policy, cancellation_deadline, notes, itineraryBlockId, subgroupTag
    } = req.body;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    if (!description || !location || !location.trim() || total_cost === undefined || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'Description, location, total cost, start date, and end date are required.' });
    }

    const participants = await Participant.find({ trip_id: tripId, status: { $ne: 'removed' } });

    // Determine target participants
    let targetParticipants = participants;
    if (assigned_participant_ids && Array.isArray(assigned_participant_ids) && assigned_participant_ids.length > 0) {
      targetParticipants = participants.filter(p => assigned_participant_ids.includes(p._id.toString()));
    }

    if (targetParticipants.length === 0) {
      return res.status(400).json({ success: false, message: 'Booking must be assigned to at least one participant.' });
    }

    const modelToUse = allocation_model || trip.cost_sharing_model || 'equal';

    // Calculate individual shares
    const assigned = [];
    const numParticipants = targetParticipants.length;
    const baseShare = numParticipants > 0 ? Number(total_cost) / numParticipants : 0;
    let runningAssigned = 0;

    for (let idx = 0; idx < targetParticipants.length; idx++) {
      const p = targetParticipants[idx];
      const isLast = idx === targetParticipants.length - 1;
      let shareAmount = 0;

      if (modelToUse === 'equal') {
        const perPerson = Math.floor((Number(total_cost) / targetParticipants.length) * 100) / 100;
        shareAmount = isLast ? Math.round((Number(total_cost) - runningAssigned) * 100) / 100 : perPerson;
        runningAssigned += perPerson;
      } else {
        const calcResult = calculateParticipantShare(
          { total_cost: Number(total_cost), start_date, end_date, allocation_model: modelToUse, assigned_participants: targetParticipants.map(tp => ({ participant_id: tp._id })) },
          p,
          participants,
          trip
        );
        shareAmount = calcResult.share;
      }

      assigned.push({
        participant_id: p._id,
        share_calculation: {
          model: modelToUse,
          base_share: baseShare,
          participation_weight: 1,
          multiplier: p.tier_multiplier || 1,
          final_share: shareAmount
        },
        amount_owed: shareAmount,
        quantity: 1
      });
    }

    const booking = new Booking({
      trip_id: tripId,
      description,
      location: location.trim(),
      type: type || 'other',
      vendor_name: vendor_name || '',
      booking_reference: booking_reference || '',
      start_date: new Date(start_date),
      end_date: new Date(end_date),
      quantity: quantity || 1,
      total_cost: Number(total_cost),
      cost_per_unit: quantity > 0 ? Number(total_cost) / quantity : Number(total_cost),
      currency: currency || trip.currency || 'USD',
      allocation_model: modelToUse,
      assigned_participants: assigned,
      paid_by: paid_by || null,
      paid_date: paid_by ? new Date() : null,
      payment_status: paid_by ? 'paid_in_full' : 'not_paid',
      amount_paid: paid_by ? Number(total_cost) : 0,
      refund_policy: refund_policy || 'full',
      cancellation_deadline: cancellation_deadline ? new Date(cancellation_deadline) : null,
      itineraryBlockId: itineraryBlockId || null,
      subgroupTag: subgroupTag || '',
      notes: notes || '',
      status: 'confirmed'
    });

    await booking.save();

    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'BOOKING_CREATED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'BOOKING', id: booking._id.toString() },
      reason: `Created booking "${description}" ($${total_cost})`
    });

    res.status(201).json({ success: true, booking });
  } catch (err) {
    console.error('Create booking error:', err);
    res.status(500).json({ success: false, message: 'Server error creating booking.' });
  }
});

// GET /api/v1/trips/:tripId/bookings - List bookings
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const bookings = await Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } }).populate('assigned_participants.participant_id paid_by');
    res.json({ success: true, bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching bookings.' });
  }
});

// PUT /api/v1/trips/:tripId/bookings/:bid - Update booking
router.put('/:bid', auth, async (req, res) => {
  try {
    const { tripId, bid } = req.params;
    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }
    if (trip.organizer_id.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the trip host can edit bookings.' });
    }

    const booking = await Booking.findOne({ _id: bid, trip_id: tripId });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    const {
      description, location, type, vendor_name, booking_reference, start_date, end_date,
      quantity, total_cost, allocation_model, assigned_participant_ids, paid_by, status, notes,
      itineraryBlockId, subgroupTag
    } = req.body;

    if (description) booking.description = description;
    if (location !== undefined && location.trim()) booking.location = location.trim();
    if (type) booking.type = type;
    if (vendor_name !== undefined) booking.vendor_name = vendor_name;
    if (booking_reference !== undefined) booking.booking_reference = booking_reference;
    if (start_date) booking.start_date = new Date(start_date);
    if (end_date) booking.end_date = new Date(end_date);
    if (quantity !== undefined) booking.quantity = quantity;
    if (total_cost !== undefined) booking.total_cost = Number(total_cost);
    if (allocation_model) booking.allocation_model = allocation_model;
    if (paid_by !== undefined) {
      booking.paid_by = paid_by || null;
      booking.payment_status = paid_by ? 'paid_in_full' : 'not_paid';
      booking.amount_paid = paid_by ? booking.total_cost : 0;
    }
    if (status) booking.status = status;
    if (itineraryBlockId !== undefined) booking.itineraryBlockId = itineraryBlockId || null;
    if (subgroupTag !== undefined) booking.subgroupTag = subgroupTag || '';
    if (notes !== undefined) booking.notes = notes;

    // Recalculate shares if assigned_participant_ids or cost changed
    if (assigned_participant_ids || total_cost !== undefined || allocation_model) {
      const trip = await Trip.findById(tripId);
      const allParticipants = await Participant.find({ trip_id: tripId });
      let targetParticipants = allParticipants;

      if (assigned_participant_ids && Array.isArray(assigned_participant_ids) && assigned_participant_ids.length > 0) {
        targetParticipants = allParticipants.filter(p => assigned_participant_ids.includes(p._id.toString()));
      }

      const modelToUse = booking.allocation_model || 'equal';
      const numParticipants = targetParticipants.length;
      const baseShare = numParticipants > 0 ? booking.total_cost / numParticipants : 0;
      let runningAssigned = 0;

      booking.assigned_participants = targetParticipants.map((p, idx) => {
        const isLast = idx === numParticipants - 1;
        let shareAmount = 0;

        if (modelToUse === 'equal') {
          const perPerson = Math.floor((Number(booking.total_cost) / numParticipants) * 100) / 100;
          shareAmount = isLast ? Math.round((Number(booking.total_cost) - runningAssigned) * 100) / 100 : perPerson;
          runningAssigned += perPerson;
        } else {
          const calcResult = calculateParticipantShare(
            { total_cost: booking.total_cost, start_date: booking.start_date, end_date: booking.end_date, allocation_model: modelToUse, assigned_participants: targetParticipants.map(tp => ({ participant_id: tp._id })) },
            p,
            allParticipants,
            trip
          );
          shareAmount = calcResult.share;
        }

        return {
          participant_id: p._id,
          share_calculation: {
            model: modelToUse,
            base_share: baseShare,
            participation_weight: 1,
            multiplier: p.tier_multiplier || 1,
            final_share: shareAmount
          },
          amount_owed: shareAmount,
          quantity: 1
        };
      });
    }

    await booking.save();

    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'BOOKING_UPDATED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'BOOKING', id: bid },
      reason: `Updated booking "${booking.description}"`
    });

    res.json({ success: true, booking });
  } catch (err) {
    console.error('Update booking error:', err);
    res.status(500).json({ success: false, message: 'Server error updating booking.' });
  }
});

// DELETE /api/v1/trips/:tripId/bookings/:bid - Delete booking
router.delete('/:bid', auth, async (req, res) => {
  try {
    const { tripId, bid } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }
    if (trip.organizer_id.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the trip host can delete bookings.' });
    }

    const booking = await Booking.findOne({ _id: bid, trip_id: tripId });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    await Booking.findByIdAndDelete(bid);
    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'BOOKING_DELETED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'BOOKING', id: bid },
      reason: `Deleted booking "${booking.description}" ($${booking.total_cost})`
    });

    res.json({ success: true, message: 'Booking deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting booking.' });
  }
});

module.exports = router;
