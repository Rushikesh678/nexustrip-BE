const mongoose = require('mongoose');

const RefundSchema = new mongoose.Schema({
  trip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  original_payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },

  refund_reason: { type: String, required: true },
  refund_trigger: { type: String, default: 'manual' },

  refund_amount: { type: Number, required: true },
  refund_method: { type: String, default: 'venmo' },
  refund_date_processed: { type: Date, default: Date.now },
  refund_status: {
    type: String,
    enum: ['initiated', 'completed', 'failed', 'pending'],
    default: 'completed'
  },

  initiated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' },
  approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' }
}, { timestamps: true });

module.exports = mongoose.model('Refund', RefundSchema);
