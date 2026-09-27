const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, default: '' },
  googleId: { type: String, default: '' },
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  avatar: { type: String, default: '' },
  phone: { type: String, default: '' },
  venmo_handle: { type: String, default: '' },
  paypal_email: { type: String, default: '' },
  upi_id: { type: String, default: '' },
  role: { type: String, enum: ['host', 'member'], default: 'host' }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
