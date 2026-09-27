const mongoose = require('mongoose');

const ExpenseParticipantSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  share: { type: Number, required: true, default: 0 },
  shareType: { type: String, enum: ['EQUAL', 'CUSTOM', 'PERCENTAGE', 'BY_ITEM'], default: 'EQUAL' },
  customAmount: { type: Number },
  customPercentage: { type: Number }
}, { _id: false });

const EditHistorySchema = new mongoose.Schema({
  editedAt: { type: Date, default: Date.now },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  changes: [{ field: String, before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed }]
}, { _id: false });

const ExpenseSchema = new mongoose.Schema({
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  payerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },

  description: { type: String, required: true },
  merchant: { type: String, default: '' },
  category: {
    type: String,
    enum: ['ACCOMMODATION', 'FOOD', 'TRANSPORT', 'ACTIVITY', 'OTHER'],
    default: 'OTHER'
  },

  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  originalCurrency: { type: String },
  exchangeRate: { type: Number, default: 1.0 },

  date: { type: Date, default: Date.now },
  receiptUrl: { type: String, default: '' },
  aiParsed: { type: Boolean, default: false },
  aiConfidence: { type: Number, default: 0 },
  isSideQuest: { type: Boolean, default: false },
  sideQuestTitle: { type: String, default: '' },
  itineraryBlockId: { type: mongoose.Schema.Types.ObjectId, ref: 'ItineraryBlock', default: null },
  subgroupTag: { type: String, default: '' }, // e.g. "Table 1", "Table 2", "Room A"

  participants: [ExpenseParticipantSchema],

  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'POSTED', 'REFUNDED', 'DELETED'],
    default: 'POSTED'
  },
  approvalStatus: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
    default: 'APPROVED'
  },

  editHistory: [EditHistorySchema]
}, { timestamps: true });

module.exports = mongoose.model('Expense', ExpenseSchema);
