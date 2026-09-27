const express = require('express');
const router = express.Router({ mergeParams: true });
const ItineraryBlock = require('../models/ItineraryBlock');
const Trip = require('../models/Trip');
const Expense = require('../models/Expense');
const Booking = require('../models/Booking');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');

// Helper to sort time slots logically
const SLOT_ORDER = {
  morning: 1,
  afternoon: 2,
  evening: 3,
  night: 4,
  all_day: 0,
  custom: 5
};

// GET /api/v1/trips/:tripId/itinerary - List all itinerary blocks with linked financial rollups
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const blocks = await ItineraryBlock.find({ trip_id: tripId })
      .populate('assigned_participants', 'name email status')
      .lean();

    // Fetch all active expenses and bookings for this trip
    const [expenses, bookings] = await Promise.all([
      Expense.find({ tripId, status: { $ne: 'DELETED' } })
        .populate('payerId', 'name email')
        .populate('participants.memberId', 'name email')
        .lean(),
      Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } })
        .populate('paid_by', 'name email')
        .populate('assigned_participants.participant_id', 'name email')
        .lean()
    ]);

    // Attach linked expenses and bookings to each block
    const populatedBlocks = blocks.map(block => {
      const bId = block._id.toString();
      const linkedExpenses = expenses.filter(e => e.itineraryBlockId && e.itineraryBlockId.toString() === bId);
      const linkedBookings = bookings.filter(b => b.itineraryBlockId && b.itineraryBlockId.toString() === bId);

      const expenseTotal = linkedExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      const bookingTotal = linkedBookings.reduce((sum, b) => sum + (b.total_cost || 0), 0);
      const actualCost = expenseTotal + bookingTotal;
      const estimatedCost = block.estimated_cost || 0;
      const variance = actualCost - estimatedCost;

      return {
        ...block,
        linked_expenses: linkedExpenses,
        linked_bookings: linkedBookings,
        actual_cost: actualCost,
        expense_total: expenseTotal,
        booking_total: bookingTotal,
        variance,
        is_over_budget: estimatedCost > 0 && actualCost > estimatedCost,
        is_untracked: estimatedCost > 0 && actualCost === 0
      };
    });

    // Sort by date ascending, then by time slot or start time
    populatedBlocks.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateA - dateB;

      if (a.start_time && b.start_time) {
        return a.start_time.localeCompare(b.start_time);
      }
      return (SLOT_ORDER[a.time_slot] || 99) - (SLOT_ORDER[b.time_slot] || 99);
    });

    // Summary calculation
    const totalEstimated = populatedBlocks.reduce((sum, b) => sum + (b.estimated_cost || 0), 0);
    const totalActual = populatedBlocks.reduce((sum, b) => sum + (b.actual_cost || 0), 0);
    const untrackedCount = populatedBlocks.filter(b => b.is_untracked).length;

    res.json({
      success: true,
      itinerary: populatedBlocks,
      summary: {
        totalBlocks: populatedBlocks.length,
        totalEstimated,
        totalActual,
        totalVariance: totalActual - totalEstimated,
        untrackedCount
      }
    });
  } catch (err) {
    console.error('Fetch itinerary error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching itinerary.' });
  }
});

// POST /api/v1/trips/:tripId/itinerary - Create new itinerary time block
router.post('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const {
      day_number, date, time_slot, start_time, end_time,
      title, location, category, estimated_cost, currency,
      assigned_participants, notes
    } = req.body;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Activity title is required.' });
    }

    // Default date calculation if not provided
    let blockDate = date ? new Date(date) : null;
    let dayNum = day_number ? Number(day_number) : 1;

    if (!blockDate) {
      const start = new Date(trip.start_date);
      blockDate = new Date(start);
      blockDate.setDate(start.getDate() + (dayNum - 1));
    }

    const block = new ItineraryBlock({
      trip_id: tripId,
      day_number: dayNum,
      date: blockDate,
      time_slot: time_slot || 'morning',
      start_time: start_time || '',
      end_time: end_time || '',
      title: title.trim(),
      location: location ? location.trim() : '',
      category: category || 'ACTIVITY',
      estimated_cost: estimated_cost !== undefined ? Number(estimated_cost) : 0,
      currency: currency || trip.currency || 'INR',
      assigned_participants: assigned_participants || [],
      notes: notes || '',
      status: 'PLANNED'
    });

    await block.save();

    await AuditLog.create({
      tripId,
      action: 'ITINERARY_CREATED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'ITINERARY', id: block._id.toString() },
      reason: `Added itinerary block: "${block.title}" on Day ${dayNum}`
    });

    res.status(201).json({ success: true, block });
  } catch (err) {
    console.error('Create itinerary block error:', err);
    res.status(500).json({ success: false, message: 'Server error creating itinerary block.' });
  }
});

// PUT /api/v1/trips/:tripId/itinerary/:blockId - Update time block
router.put('/:blockId', auth, async (req, res) => {
  try {
    const { tripId, blockId } = req.params;
    const block = await ItineraryBlock.findOne({ _id: blockId, trip_id: tripId });
    if (!block) {
      return res.status(404).json({ success: false, message: 'Itinerary block not found.' });
    }

    const {
      day_number, date, time_slot, start_time, end_time,
      title, location, category, estimated_cost, status,
      assigned_participants, notes
    } = req.body;

    if (day_number !== undefined) block.day_number = Number(day_number);
    if (date) block.date = new Date(date);
    if (time_slot) block.time_slot = time_slot;
    if (start_time !== undefined) block.start_time = start_time;
    if (end_time !== undefined) block.end_time = end_time;
    if (title) block.title = title.trim();
    if (location !== undefined) block.location = location.trim();
    if (category) block.category = category;
    if (estimated_cost !== undefined) block.estimated_cost = Number(estimated_cost);
    if (status) block.status = status;
    if (assigned_participants !== undefined) block.assigned_participants = assigned_participants;
    if (notes !== undefined) block.notes = notes;

    await block.save();

    res.json({ success: true, block });
  } catch (err) {
    console.error('Update itinerary block error:', err);
    res.status(500).json({ success: false, message: 'Server error updating itinerary block.' });
  }
});

// DELETE /api/v1/trips/:tripId/itinerary/:blockId - Delete time block
router.delete('/:blockId', auth, async (req, res) => {
  try {
    const { tripId, blockId } = req.params;
    const block = await ItineraryBlock.findOne({ _id: blockId, trip_id: tripId });
    if (!block) {
      return res.status(404).json({ success: false, message: 'Itinerary block not found.' });
    }

    // Unlink any expenses or bookings associated with this block
    await Promise.all([
      Expense.updateMany({ tripId, itineraryBlockId: blockId }, { $set: { itineraryBlockId: null } }),
      Booking.updateMany({ trip_id: tripId, itineraryBlockId: blockId }, { $set: { itineraryBlockId: null } })
    ]);

    await ItineraryBlock.findByIdAndDelete(blockId);

    await AuditLog.create({
      tripId,
      action: 'ITINERARY_DELETED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'ITINERARY', id: blockId },
      reason: `Removed itinerary block: "${block.title}"`
    });

    res.json({ success: true, message: 'Itinerary block deleted successfully.' });
  } catch (err) {
    console.error('Delete itinerary block error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting itinerary block.' });
  }
});

// POST /api/v1/trips/:tripId/itinerary/auto-generate - Generate days from trip dates & auto-link bookings
router.post('/auto-generate', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const start = new Date(trip.start_date);
    const end = new Date(trip.end_date);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);

    // Fetch existing bookings to convert or link
    const bookings = await Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } });
    const existingBlocks = await ItineraryBlock.find({ trip_id: tripId });

    const createdBlocks = [];

    // For each booking, create an itinerary block if one doesn't already exist for it
    for (const booking of bookings) {
      const alreadyLinked = existingBlocks.some(b => b._id.toString() === (booking.itineraryBlockId?.toString()));
      if (!alreadyLinked) {
        const bStart = new Date(booking.start_date);
        const dayOffset = Math.max(0, Math.floor((bStart - start) / (1000 * 60 * 60 * 24)));
        const dayNumber = Math.min(diffDays, dayOffset + 1);

        let cat = 'ACTIVITY';
        let slot = 'afternoon';
        if (booking.type === 'accommodation') {
          cat = 'ACCOMMODATION';
          slot = 'all_day';
        } else if (booking.type === 'transportation') {
          cat = 'TRANSPORT';
          slot = 'morning';
        } else if (booking.type === 'meal') {
          cat = 'FOOD';
          slot = 'evening';
        }

        const newBlock = new ItineraryBlock({
          trip_id: tripId,
          day_number: dayNumber,
          date: bStart,
          time_slot: slot,
          title: booking.description,
          location: booking.location || trip.destination || '',
          category: cat,
          estimated_cost: booking.total_cost,
          currency: booking.currency || trip.currency || 'INR',
          assigned_participants: booking.assigned_participants?.map(ap => ap.participant_id) || [],
          notes: booking.vendor_name ? `Vendor: ${booking.vendor_name} (Ref: ${booking.booking_reference || 'N/A'})` : ''
        });

        await newBlock.save();
        createdBlocks.push(newBlock);

        // Link booking to this block
        booking.itineraryBlockId = newBlock._id;
        await booking.save();
      }
    }

    // If trip has zero blocks at all, create standard starter day outlines
    if (existingBlocks.length === 0 && createdBlocks.length === 0) {
      for (let day = 1; day <= Math.min(diffDays, 7); day++) {
        const curDate = new Date(start);
        curDate.setDate(start.getDate() + (day - 1));

        const starterBlock = new ItineraryBlock({
          trip_id: tripId,
          day_number: day,
          date: curDate,
          time_slot: day === 1 ? 'afternoon' : 'morning',
          title: day === 1 ? `Arrive at ${trip.destination || 'Destination'} & Check-In` : `Day ${day} Group Exploration`,
          location: trip.destination || '',
          category: day === 1 ? 'ACCOMMODATION' : 'ACTIVITY',
          estimated_cost: 0,
          currency: trip.currency || 'INR',
          status: 'PLANNED'
        });
        await starterBlock.save();
        createdBlocks.push(starterBlock);
      }
    }

    res.json({
      success: true,
      message: `Generated ${createdBlocks.length} itinerary time blocks.`,
      blocks: createdBlocks
    });
  } catch (err) {
    console.error('Auto-generate itinerary error:', err);
    res.status(500).json({ success: false, message: 'Server error auto-generating itinerary.' });
  }
});

module.exports = router;
