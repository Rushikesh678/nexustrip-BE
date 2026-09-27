const express = require('express');
const router = express.Router({ mergeParams: true });
const Payment = require('../models/Payment');
const Participant = require('../models/Participant');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const { recalculateParticipantBalances } = require('../services/calculationService');

// POST /api/v1/trips/:tripId/payments - Record payment
router.post('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const { payer_id, payee_id, amount, payment_method, payment_app, transaction_id, notes } = req.body;

    if (!payer_id || !payee_id || !amount) {
      return res.status(400).json({ success: false, message: 'Payer, payee, and amount are required.' });
    }

    const numAmount = Number(amount);
    if (numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero.' });
    }

    const payment = new Payment({
      trip_id: tripId,
      payer_id,
      payee_id,
      amount: numAmount,
      payment_method: payment_method || 'venmo',
      payment_app: payment_app || 'venmo',
      transaction_id: transaction_id || '',
      notes: notes || '',
      status: 'completed',
      payment_date: new Date()
    });

    await payment.save();

    await recalculateParticipantBalances(tripId);

    const payer = await Participant.findById(payer_id);
    const payee = await Participant.findById(payee_id);

    await AuditLog.create({
      tripId,
      action: 'PAYMENT_RECORDED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'PAYMENT', id: payment._id.toString() },
      reason: `Recorded payment: ${payer?.name || 'Payer'} paid ${payee?.name || 'Payee'} $${numAmount}`
    });

    res.status(201).json({ success: true, payment });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ success: false, message: 'Server error recording payment.' });
  }
});

// GET /api/v1/trips/:tripId/payments - List payments
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const payments = await Payment.find({ trip_id: tripId })
      .populate('payer_id payee_id', 'name email')
      .sort({ payment_date: -1 });
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching payments.' });
  }
});

// POST /api/v1/trips/:tripId/payments/:pid/dispute - Dispute a payment
router.post('/:pid/dispute', auth, async (req, res) => {
  try {
    const { tripId, pid } = req.params;
    const { reason } = req.body;

    const payment = await Payment.findOne({ _id: pid, trip_id: tripId });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }

    payment.disputed = true;
    payment.dispute_reason = reason || 'Disputed by participant';
    payment.dispute_status = 'pending_review';
    await payment.save();

    await AuditLog.create({
      tripId,
      action: 'PAYMENT_DISPUTED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'PAYMENT', id: pid },
      reason: `Disputed payment: ${reason || ''}`
    });

    res.json({ success: true, message: 'Payment dispute submitted.', payment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error disputing payment.' });
  }
});

module.exports = router;
