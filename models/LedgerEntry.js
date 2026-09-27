const mongoose = require('mongoose');

const LedgerEntrySchema = new mongoose.Schema({
  trip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },

  entry_type: {
    type: String,
    enum: [
      'booking_assigned', 'booking_removed', 'booking_cost_adjusted',
      'cost_share_recalculated', 'payment_recorded', 'refund_issued',
      'overpayment_credited', 'rounding_adjustment', 'manual_adjustment',
      'dispute_hold', 'settlement_finalized'
    ],
    required: true
  },
  entry_date: { type: Date, default: Date.now },

  participant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  operator_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  debit: { type: Number, default: 0 },   // Amount owed
  credit: { type: Number, default: 0 },  // Amount paid/credited
  balance_after: { type: Number, default: 0 },

  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  refund_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund' },

  description: { type: String, required: true },
  notes: { type: String, default: '' },

  affected_booking_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }],
  recalculation_trigger: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('LedgerEntry', LedgerEntrySchema);
