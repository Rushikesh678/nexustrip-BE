const mongoose = require('mongoose');

const ItineraryBlockSchema = new mongoose.Schema({
  trip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
  day_number: { type: Number, required: true },
  date: { type: Date, required: true },
  time_slot: {
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'night', 'all_day', 'custom'],
    default: 'morning'
  },
  start_time: { type: String, default: '' }, // e.g. "10:00"
  end_time: { type: String, default: '' },   // e.g. "13:00"
  title: { type: String, required: [true, 'Itinerary title is required'], trim: true },
  location: { type: String, default: '', trim: true },
  category: {
    type: String,
    enum: ['ACCOMMODATION', 'FOOD', 'TRANSPORT', 'ACTIVITY', 'LEISURE', 'OTHER'],
    default: 'ACTIVITY'
  },
  estimated_cost: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },
  status: {
    type: String,
    enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'PLANNED'
  },
  assigned_participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Participant' }],
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('ItineraryBlock', ItineraryBlockSchema);
