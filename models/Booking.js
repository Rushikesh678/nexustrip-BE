const mongoose = require('mongoose');

const AssignedParticipantSchema = new mongoose.Schema({
  participant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  share_calculation: {
    model: { type: String },
    base_share: { type: Number, default: 0 },
    participation_weight: { type: Number, default: 1 },
    multiplier: { type: Number, default: 1 },
    final_share: { type: Number, default: 0 }
  },
  amount_owed: { type: Number, required: true, default: 0 },
  quantity: { type: Number, default: 1 }
}, { _id: false });

const BookingSchema = new mongoose.Schema({
  trip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },

  vendor_id: { type: String, default: '' },
  vendor_name: { type: String, default: '' },
  booking_reference: { type: String, default: '' },
  type: {
    type: String,
    enum: ['accommodation', 'transportation', 'activity', 'meal', 'other'],
    default: 'other'
  },
  description: { type: String, required: true },
  location: { 
    type: String, 
    required: [true, 'Booking location is compulsory'], 
    trim: true,
    default: 'Trip Destination' 
  },

  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  quantity: { type: Number, default: 1 },

  total_cost: { type: Number, required: true, default: 0 },
  cost_per_unit: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  tax_amount: { type: Number, default: 0 },
  service_charge: { type: Number, default: 0 },
  change_fee: { type: Number, default: 0 },

  assigned_participants: [AssignedParticipantSchema],
  allocation_model: {
    type: String,
    enum: ['equal', 'weighted_nights', 'weighted_quantity', 'occupancy_based', 'consumption_only', 'custom_fixed', 'tiered'],
    default: 'equal'
  },

  refund_policy: {
    type: String,
    enum: ['full', 'partial', 'none', 'custom'],
    default: 'full'
  },
  cancellation_deadline: { type: Date },
  refund_percentage: { type: Number, default: 100 },

  payment_status: {
    type: String,
    enum: ['not_paid', 'partially_paid', 'paid_in_full', 'awaiting_confirmation', 'overpaid', 'refund_pending'],
    default: 'not_paid'
  },
  amount_paid: { type: Number, default: 0 },
  amount_owed_to_vendor: { type: Number, default: 0 },
  paid_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant' },
  paid_date: { type: Date },

  status: {
    type: String,
    enum: ['draft', 'requested', 'confirmed', 'modified', 'cancelled', 'completed', 'dispute'],
    default: 'confirmed'
  },
  cancellation_date: { type: Date },
  cancellation_reason: { type: String, default: '' },
  refund_received_date: { type: Date },
  refund_amount: { type: Number, default: 0 },
  itineraryBlockId: { type: mongoose.Schema.Types.ObjectId, ref: 'ItineraryBlock', default: null },
  subgroupTag: { type: String, default: '' }, // e.g. "Room 101", "Room 102"
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Booking', BookingSchema);
