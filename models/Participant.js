const mongoose = require('mongoose');

const ParticipantSchema = new mongoose.Schema({
  trip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, default: '' },

  status: {
    type: String,
    enum: ['provisional', 'confirmed', 'active', 'departed', 'no_show', 'withdrawn', 'removed', 'ghosting'],
    default: 'confirmed'
  },
  arrival_date: { type: Date },
  departure_date: { type: Date },

  cost_tier: { type: String, default: 'STANDARD' },
  tier_multiplier: { type: Number, default: 1.0 },

  total_owed: { type: Number, default: 0 },
  total_paid: { type: Number, default: 0 },
  consumption_share: { type: Number, default: 0 }, // Actual expense + booking share
  upfront_paid: { type: Number, default: 0 }, // Upfront amount paid for expenses + bookings
  balance: { type: Number, default: 0 }, // total_paid - total_owed (positive = owed money, negative = owes money)

  payment_method: { type: String, default: 'venmo' },
  venmo_handle: { type: String, default: '' },
  paypal_email: { type: String, default: '' },
  upi_id: { type: String, default: '' },

  last_reminded: { type: Date },
  communication_preference: { type: String, default: 'email' },

  joinedDate: { type: Date, default: Date.now },
  leftDate: { type: Date },
  removed_at: { type: Date },
  removal_reason: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Participant', ParticipantSchema);
