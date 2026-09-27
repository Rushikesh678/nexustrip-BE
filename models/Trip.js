const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  destination: { type: String, default: '' },
  organizer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  co_organizers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  status: { 
    type: String, 
    enum: ['planning', 'active', 'completed', 'settlement_in_progress', 'settled', 'cancelled'],
    default: 'planning'
  },

  currency: { type: String, default: 'INR' },
  inviteCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
  total_cost_estimated: { type: Number, default: 0 },
  total_cost_actual: { type: Number, default: 0 },
  budget: { type: Number, default: 0 },
  payment_deadline: { type: Date },
  settlement_deadline: { type: Date },

  cost_sharing_model: {
    type: String,
    enum: ['equal', 'weighted', 'occupancy', 'consumption', 'tiered', 'custom'],
    default: 'equal'
  },
  allow_partial_join: { type: Boolean, default: true },
  allow_partial_payment: { type: Boolean, default: true },
  refund_policy: {
    type: String,
    enum: ['full', 'partial', 'none', 'custom'],
    default: 'full'
  },
  rounding_method: {
    type: String,
    enum: ['banker', 'last_person', 'equal'],
    default: 'last_person'
  },

  settings: {
    allowMemberExpenses: { type: Boolean, default: true },
    requireHostApproval: { type: Boolean, default: false },
    allowMultipleCurrencies: { type: Boolean, default: false },
    settlementMethod: { type: String, enum: ['simplify', 'direct'], default: 'simplify' }
  }
}, { timestamps: true });

module.exports = mongoose.model('Trip', TripSchema);
