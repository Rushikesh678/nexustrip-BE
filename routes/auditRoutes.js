const express = require('express');
const router = express.Router({ mergeParams: true });
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');

// GET /api/v1/trips/:tripId/audit - View trip audit history
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const logs = await AuditLog.find({ tripId }).sort({ createdAt: -1 });
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching audit logs.' });
  }
});

module.exports = router;
