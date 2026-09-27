const mongoose = require('mongoose');

const SettlementTransactionSchema = new mongoose.Schema({
  from_participant: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  to_participant: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  amount: { type: Number, required: true },
  reason: { type: String, default: 'Settlement' },
  status: { type: String, enum: ['PENDING', 'COMPLETED'], default: 'PENDING' },
  payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }
}, { _id: true });

const SettlementSchema = new mongoose.Schema({
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  status: { type: String, enum: ['IN_PROGRESS', 'FINALIZED'], default: 'IN_PROGRESS' },

  balances: [{
    participant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' },
    name: { type: String },
    total_owed: { type: Number, default: 0 },
    total_paid: { type: Number, default: 0 },
    net_balance: { type: Number, default: 0 }
  }],

  transactions_required: [SettlementTransactionSchema],
  validation_errors: [{ type: String }],
  is_balanced: { type: Boolean, default: true },

  calculatedAt: { type: Date, default: Date.now },
  finalizedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Settlement', SettlementSchema);
