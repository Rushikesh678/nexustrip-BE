const express = require('express');
const router = express.Router({ mergeParams: true });
const Refund = require('../models/Refund');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const { recalculateParticipantBalances } = require('../services/calculationService');

// POST /api/v1/trips/:tripId/refunds - Issue refund
router.post('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const { original_payment_id, booking_id, refund_reason, refund_amount, refund_method, recipient_id } = req.body;

    if (!refund_amount || !refund_reason) {
      return res.status(400).json({ success: false, message: 'Refund amount and reason are required.' });
    }

    const refund = new Refund({
      trip_id: tripId,
      original_payment_id: original_payment_id || null,
      booking_id: booking_id || null,
      refund_reason,
      refund_amount: Number(refund_amount),
      refund_method: refund_method || 'venmo',
      initiated_by: recipient_id || null,
      refund_status: 'completed',
      refund_date_processed: new Date()
    });

    await refund.save();
    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'REFUND_ISSUED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'REFUND', id: refund._id.toString() },
      reason: `Issued refund of $${refund_amount} (${refund_reason})`
    });

    res.status(201).json({ success: true, refund });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ success: false, message: 'Server error issuing refund.' });
  }
});

// GET /api/v1/trips/:tripId/refunds - List refunds
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const refunds = await Refund.find({ trip_id: tripId }).populate('initiated_by booking_id');
    res.json({ success: true, refunds });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching refunds.' });
  }
});

module.exports = router;
