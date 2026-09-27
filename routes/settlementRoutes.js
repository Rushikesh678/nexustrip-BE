const express = require('express');
const router = express.Router({ mergeParams: true });
const Settlement = require('../models/Settlement');
const Trip = require('../models/Trip');
const Participant = require('../models/Participant');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const { calculateSettlement, recalculateParticipantBalances } = require('../services/calculationService');

// GET /api/v1/trips/:tripId/settlement - Calculate settlement
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const participants = await recalculateParticipantBalances(tripId);
    const calculation = calculateSettlement(trip, participants);

    // Check if there's an existing settlement document
    let settlement = await Settlement.findOne({ tripId }).sort({ createdAt: -1 });
    if (!settlement) {
      settlement = new Settlement({
        tripId,
        status: 'IN_PROGRESS',
        balances: calculation.balances,
        transactions_required: calculation.transactions_required,
        validation_errors: calculation.validation_errors,
        is_balanced: calculation.is_balanced,
        calculatedAt: new Date()
      });
      await settlement.save();
    } else if (settlement.status === 'IN_PROGRESS') {
      settlement.balances = calculation.balances;
      // Preserve any completed transactions
      const completedTx = (settlement.transactions_required || []).filter(t => t.status === 'COMPLETED');
      settlement.transactions_required = [...completedTx, ...calculation.transactions_required];
      settlement.validation_errors = calculation.validation_errors;
      settlement.is_balanced = calculation.is_balanced;
      settlement.calculatedAt = new Date();
      await settlement.save();
    }

    // Populate transaction participants
    const populatedSettlement = await Settlement.findById(settlement._id)
      .populate('transactions_required.from_participant', 'name email venmo_handle paypal_email upi_id')
      .populate('transactions_required.to_participant', 'name email venmo_handle paypal_email upi_id');

    res.json({
      success: true,
      settlement: populatedSettlement,
      summary: {
        totalDebtors: calculation.balances.filter(b => b.net_balance < -0.01).length,
        totalCreditors: calculation.balances.filter(b => b.net_balance > 0.01).length,
        transactionCount: calculation.transactions_required.length,
        isBalanced: calculation.is_balanced
      }
    });
  } catch (err) {
    console.error('Calculate settlement error:', err);
    res.status(500).json({ success: false, message: 'Server error calculating settlement.' });
  }
});

// POST /api/v1/trips/:tripId/settlement/finalize - Finalize settlement
router.post('/finalize', auth, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const participants = await recalculateParticipantBalances(tripId);
    const calculation = calculateSettlement(trip, participants);

    let settlement = await Settlement.findOne({ tripId }).sort({ createdAt: -1 });
    if (!settlement) {
      settlement = new Settlement({ tripId });
    }

    settlement.status = 'FINALIZED';
    settlement.balances = calculation.balances;
    settlement.transactions_required = calculation.transactions_required;
    settlement.validation_errors = calculation.validation_errors;
    settlement.is_balanced = calculation.is_balanced;
    settlement.finalizedAt = new Date();
    await settlement.save();

    trip.status = 'settlement_in_progress';
    await trip.save();

    await AuditLog.create({
      tripId,
      action: 'SETTLEMENT_FINALIZED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'SETTLEMENT', id: settlement._id.toString() },
      reason: 'Finalized trip settlement balances and required transactions'
    });

    const populatedSettlement = await Settlement.findById(settlement._id)
      .populate('transactions_required.from_participant', 'name email venmo_handle')
      .populate('transactions_required.to_participant', 'name email venmo_handle');

    res.json({ success: true, message: 'Settlement finalized successfully.', settlement: populatedSettlement });
  } catch (err) {
    console.error('Finalize settlement error:', err);
    res.status(500).json({ success: false, message: 'Server error finalizing settlement.' });
  }
});

// POST /api/v1/trips/:tripId/settlement/record-payment - Mark transaction as paid
router.post('/record-payment', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const { transaction_id, from_participant, to_participant, amount, payment_method } = req.body;

    let settlement = await Settlement.findOne({ tripId }).sort({ createdAt: -1 });
    if (!settlement) {
      return res.status(404).json({ success: false, message: 'No settlement record found.' });
    }

    const payerId = from_participant?._id || from_participant;
    const payeeId = to_participant?._id || to_participant;

    // Create payment record
    const payment = new Payment({
      trip_id: tripId,
      payer_id: payerId,
      payee_id: payeeId,
      amount: Number(amount),
      payment_method: payment_method || 'upi',
      status: 'completed',
      notes: 'Settlement transaction payout'
    });
    await payment.save();

    // Mark specific transaction inside settlement as completed
    const tx = settlement.transactions_required.id(transaction_id);
    if (tx) {
      tx.status = 'COMPLETED';
      tx.payment_id = payment._id;
    }
    await settlement.save();

    // Recalculate balances
    await recalculateParticipantBalances(tripId);

    // Check if all transactions are complete
    const allDone = settlement.transactions_required.every(t => t.status === 'COMPLETED');
    if (allDone) {
      const trip = await Trip.findById(tripId);
      if (trip) {
        trip.status = 'settled';
        await trip.save();
      }
    }

    res.json({ success: true, message: 'Payment recorded and transaction marked as completed.', settlement, payment });
  } catch (err) {
    console.error('Record settlement payment error:', err);
    res.status(500).json({ success: false, message: 'Server error recording settlement payment.' });
  }
});

module.exports = router;
