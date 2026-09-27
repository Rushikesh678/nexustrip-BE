const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  trip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },

  payer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  payee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },

  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  payment_method: { type: String, default: 'venmo' },
  payment_app: { type: String, default: 'venmo' },
  transaction_id: { type: String, default: '' },

  allocated_to: [{
    booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    amount: { type: Number, default: 0 }
  }],

  status: {
    type: String,
    enum: ['initiated', 'pending', 'completed', 'failed', 'cancelled', 'refunding', 'refunded', 'chargeback'],
    default: 'completed'
  },
  payment_date: { type: Date, default: Date.now },
  confirmation_date: { type: Date },

  receipt_uploaded: { type: Boolean, default: false },
  receipt_url: { type: String, default: '' },
  notes: { type: String, default: '' },

  disputed: { type: Boolean, default: false },
  dispute_reason: { type: String, default: '' },
  dispute_status: { type: String, enum: ['pending_review', 'investigating', 'resolved', 'escalated'] }
}, { timestamps: true });

module.exports = mongoose.model('Payment', PaymentSchema);
