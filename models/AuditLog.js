const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  action: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: { type: String, default: 'System' },
  target: {
    type: { type: String },
    id: { type: String }
  },
  changes: [{
    field: { type: String },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed }
  }],
  reason: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
