const express = require('express');
const router = express.Router({ mergeParams: true });
const LedgerEntry = require('../models/LedgerEntry');
const Expense = require('../models/Expense');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Participant = require('../models/Participant');
const auth = require('../middleware/auth');

// GET /api/v1/trips/:tripId/ledger - Full trip financial ledger
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;

    const expenses = await Expense.find({ tripId, status: { $ne: 'DELETED' } })
      .populate('payerId', 'name email')
      .populate('participants.memberId', 'name email');

    const bookings = await Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } })
      .populate('paid_by', 'name email')
      .populate('assigned_participants.participant_id', 'name email');

    const payments = await Payment.find({ trip_id: tripId, status: 'completed' })
      .populate('payer_id payee_id', 'name email');

    const participants = await Participant.find({ trip_id: tripId });

    // Build unified chronological ledger entries
    const ledger = [];

    expenses.forEach(e => {
      const payerName = e.payerId?.name || 'Payer';
      e.participants.forEach(pt => {
        const partName = pt.memberId?.name || 'Participant';
        ledger.push({
          id: `${e._id}_${pt.memberId?._id}`,
          date: e.date,
          type: 'EXPENSE',
          category: e.category,
          description: `${e.description} (${e.merchant || 'General'})`,
          payer: payerName,
          participant: partName,
          totalAmount: e.amount,
          participantShare: pt.share,
          debit: pt.share,
          credit: e.payerId?._id.toString() === pt.memberId?._id.toString() ? e.amount : 0
        });
      });
    });

    bookings.forEach(b => {
      const payerName = b.paid_by?.name || 'Organizer/Vendor';
      b.assigned_participants.forEach(ap => {
        const partName = ap.participant_id?.name || 'Participant';
        ledger.push({
          id: `${b._id}_${ap.participant_id?._id}`,
          date: b.start_date,
          type: 'BOOKING',
          category: b.type,
          description: `Booking: ${b.description} (${b.vendor_name || 'Vendor'})`,
          payer: payerName,
          participant: partName,
          totalAmount: b.total_cost,
          participantShare: ap.amount_owed,
          debit: ap.amount_owed,
          credit: b.paid_by?._id.toString() === ap.participant_id?._id.toString() ? b.total_cost : 0
        });
      });
    });

    payments.forEach(p => {
      ledger.push({
        id: p._id,
        date: p.payment_date,
        type: 'PAYMENT',
        category: 'REIMBURSEMENT',
        description: `Direct Payment (${p.payment_method})`,
        payer: p.payer_id?.name || 'Payer',
        participant: p.payee_id?.name || 'Payee',
        totalAmount: p.amount,
        participantShare: p.amount,
        debit: 0,
        credit: p.amount
      });
    });

    ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, ledger, participantSummary: participants });
  } catch (err) {
    console.error('Ledger error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching ledger.' });
  }
});

module.exports = router;
