const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const Expense = require('../models/Expense');
const Trip = require('../models/Trip');
const Participant = require('../models/Participant');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const { recalculateParticipantBalances, roundAmount } = require('../services/calculationService');
const { parseReceiptData } = require('../services/receiptService');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /api/v1/trips/:tripId/expenses - Create expense
router.post('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const {
      description, merchant, category, amount, currency, date,
      payerId, participants, splitMethod, receiptUrl, aiParsed, aiConfidence,
      isSideQuest, sideQuestTitle, itineraryBlockId, subgroupTag
    } = req.body;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    if (trip.organizer_id.toString() !== req.user.userId && trip.settings && trip.settings.allowMemberExpenses === false) {
      return res.status(403).json({ success: false, message: 'The host has disabled members from adding expenses to this trip.' });
    }

    if (!description || amount === undefined || !payerId) {
      return res.status(400).json({ success: false, message: 'Description, amount, and payer are required.' });
    }

    const allParticipants = await Participant.find({ trip_id: tripId, status: { $ne: 'removed' } });
    const numAmount = Number(amount);

    // Validate payer
    const payer = allParticipants.find(p => p._id.toString() === payerId.toString());
    if (!payer) {
      return res.status(400).json({ success: false, message: 'Payer is not a valid participant in this trip.' });
    }

    // Determine target participants & calculate shares
    let formattedParticipants = [];
    const splitType = splitMethod || 'EQUAL';

    if (participants && Array.isArray(participants) && participants.length > 0) {
      if (splitType === 'EQUAL') {
        const count = participants.length;
        const perPerson = Math.floor((numAmount / count) * 100) / 100;
        let runningTotal = 0;
        formattedParticipants = participants.map((pObj, idx) => {
          const mId = pObj.memberId || pObj;
          const isLast = idx === count - 1;
          const shareVal = isLast ? Math.round((numAmount - runningTotal) * 100) / 100 : perPerson;
          runningTotal += perPerson;
          return {
            memberId: mId,
            share: shareVal,
            shareType: 'EQUAL'
          };
        });
      } else if (splitType === 'PERCENTAGE') {
        formattedParticipants = participants.map(pObj => {
          const pct = Number(pObj.customPercentage || 0);
          const shareVal = roundAmount((numAmount * pct) / 100, trip.rounding_method);
          return {
            memberId: pObj.memberId,
            share: shareVal,
            shareType: 'PERCENTAGE',
            customPercentage: pct
          };
        });
      } else if (splitType === 'CUSTOM') {
        formattedParticipants = participants.map(pObj => ({
          memberId: pObj.memberId,
          share: Number(pObj.customAmount || 0),
          shareType: 'CUSTOM',
          customAmount: Number(pObj.customAmount || 0)
        }));
      } else {
        formattedParticipants = participants.map(pObj => ({
          memberId: pObj.memberId || pObj,
          share: Number(pObj.share || 0),
          shareType: splitType
        }));
      }
    } else {
      // Default to all active participants split equally
      const count = allParticipants.length;
      const perPerson = Math.floor((numAmount / count) * 100) / 100;
      let runningTotal = 0;
      formattedParticipants = allParticipants.map((p, idx) => {
        const isLast = idx === count - 1;
        const shareVal = isLast ? Math.round((numAmount - runningTotal) * 100) / 100 : perPerson;
        runningTotal += perPerson;
        return {
          memberId: p._id,
          share: shareVal,
          shareType: 'EQUAL'
        };
      });
    }

    const expense = new Expense({
      tripId,
      payerId,
      description,
      merchant: merchant || '',
      category: category || 'OTHER',
      amount: numAmount,
      currency: currency || trip.currency || 'USD',
      date: date ? new Date(date) : new Date(),
      receiptUrl: receiptUrl || '',
      aiParsed: !!aiParsed,
      aiConfidence: aiConfidence || 0,
      isSideQuest: !!isSideQuest,
      sideQuestTitle: sideQuestTitle || '',
      itineraryBlockId: itineraryBlockId || null,
      subgroupTag: subgroupTag || '',
      participants: formattedParticipants,
      status: 'POSTED',
      approvalStatus: trip.settings?.requireHostApproval ? 'PENDING_APPROVAL' : 'APPROVED'
    });

    await expense.save();

    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'EXPENSE_CREATED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'EXPENSE', id: expense._id.toString() },
      reason: `Added expense "${description}" for $${numAmount}`
    });

    res.status(201).json({ success: true, expense });
  } catch (err) {
    console.error('Create expense error:', err);
    res.status(500).json({ success: false, message: 'Server error creating expense.' });
  }
});

// GET /api/v1/trips/:tripId/expenses - List expenses
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const { category, status } = req.query;

    const filter = { tripId };
    if (category) filter.category = category;
    if (status) filter.status = status;
    else filter.status = { $ne: 'DELETED' };

    const expenses = await Expense.find(filter)
      .populate('payerId', 'name email')
      .populate('participants.memberId', 'name email')
      .sort({ date: -1 });

    res.json({ success: true, expenses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching expenses.' });
  }
});

// GET /api/v1/trips/:tripId/expenses/:eid - Single expense details
router.get('/:eid', auth, async (req, res) => {
  try {
    const { tripId, eid } = req.params;
    const expense = await Expense.findOne({ _id: eid, tripId })
      .populate('payerId', 'name email')
      .populate('participants.memberId', 'name email');

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }

    res.json({ success: true, expense });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching expense details.' });
  }
});

// PUT /api/v1/trips/:tripId/expenses/:eid - Edit expense
router.put('/:eid', auth, async (req, res) => {
  try {
    const { tripId, eid } = req.params;
    const expense = await Expense.findOne({ _id: eid, tripId });
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const isHost = trip.organizer_id.toString() === req.user.userId;
    if (!isHost) {
      if (!expense.isSideQuest) {
        return res.status(403).json({ success: false, message: 'Only the trip host can edit general expenses. Members can only edit their own side quests.' });
      }
      const memberPart = await Participant.findOne({
        trip_id: tripId,
        $or: [{ user_id: req.user.userId }, { email: req.user.email.toLowerCase() }]
      });
      if (!memberPart) {
        return res.status(403).json({ success: false, message: 'You are not a participant in this trip.' });
      }
    }

    const { description, merchant, category, amount, currency, date, payerId, participants, splitMethod, isSideQuest, sideQuestTitle } = req.body;
    const changes = [];

    if (description && description !== expense.description) {
      changes.push({ field: 'description', before: expense.description, after: description });
      expense.description = description;
    }
    if (merchant !== undefined && merchant !== expense.merchant) {
      changes.push({ field: 'merchant', before: expense.merchant, after: merchant });
      expense.merchant = merchant;
    }
    if (category && category !== expense.category) {
      changes.push({ field: 'category', before: expense.category, after: category });
      expense.category = category;
    }
    if (amount !== undefined && Number(amount) !== expense.amount) {
      changes.push({ field: 'amount', before: expense.amount, after: Number(amount) });
      expense.amount = Number(amount);
    }
    if (payerId && payerId.toString() !== expense.payerId.toString()) {
      changes.push({ field: 'payerId', before: expense.payerId, after: payerId });
      expense.payerId = payerId;
    }
    if (date) expense.date = new Date(date);
    if (isSideQuest !== undefined) expense.isSideQuest = !!isSideQuest;
    if (sideQuestTitle !== undefined) expense.sideQuestTitle = sideQuestTitle || '';
    if (itineraryBlockId !== undefined) expense.itineraryBlockId = itineraryBlockId || null;
    if (subgroupTag !== undefined) expense.subgroupTag = subgroupTag || '';

    if (participants && Array.isArray(participants)) {
      changes.push({ field: 'participants', before: expense.participants.length, after: participants.length });
      const splitType = splitMethod || 'EQUAL';
      const numAmount = expense.amount;

      if (splitType === 'EQUAL') {
        const count = participants.length;
        const perPerson = Math.floor((numAmount / count) * 100) / 100;
        let runningTotal = 0;
        expense.participants = participants.map((pObj, idx) => {
          const isLast = idx === count - 1;
          const shareVal = isLast ? Math.round((numAmount - runningTotal) * 100) / 100 : perPerson;
          runningTotal += perPerson;
          return {
            memberId: pObj.memberId || pObj,
            share: shareVal,
            shareType: 'EQUAL'
          };
        });
      } else {
        expense.participants = participants.map(pObj => ({
          memberId: pObj.memberId,
          share: Number(pObj.customAmount || pObj.share || 0),
          shareType: splitType,
          customAmount: Number(pObj.customAmount || 0),
          customPercentage: Number(pObj.customPercentage || 0)
        }));
      }
    }

    if (changes.length > 0) {
      expense.editHistory.push({
        editedAt: new Date(),
        editedBy: req.user.userId,
        changes
      });
    }

    await expense.save();
    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'EXPENSE_EDITED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'EXPENSE', id: eid },
      changes,
      reason: `Edited expense "${expense.description}"`
    });

    res.json({ success: true, expense });
  } catch (err) {
    console.error('Edit expense error:', err);
    res.status(500).json({ success: false, message: 'Server error editing expense.' });
  }
});

// DELETE /api/v1/trips/:tripId/expenses/:eid - Soft delete expense
router.delete('/:eid', auth, async (req, res) => {
  try {
    const { tripId, eid } = req.params;
    const expense = await Expense.findOne({ _id: eid, tripId });
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const isHost = trip.organizer_id.toString() === req.user.userId;
    if (!isHost) {
      if (!expense.isSideQuest) {
        return res.status(403).json({ success: false, message: 'Only the trip host can delete general expenses. Members can only delete their own side quests.' });
      }
      const memberPart = await Participant.findOne({
        trip_id: tripId,
        $or: [{ user_id: req.user.userId }, { email: req.user.email.toLowerCase() }]
      });
      if (!memberPart) {
        return res.status(403).json({ success: false, message: 'You are not a participant in this trip.' });
      }
    }

    expense.status = 'DELETED';
    await expense.save();

    await recalculateParticipantBalances(tripId);

    await AuditLog.create({
      tripId,
      action: 'EXPENSE_DELETED',
      actorId: req.user.userId,
      actorName: req.user.name,
      target: { type: 'EXPENSE', id: eid },
      reason: `Deleted expense "${expense.description}" ($${expense.amount})`
    });

    res.json({ success: true, message: 'Expense deleted successfully.', expense });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting expense.' });
  }
});

// POST /api/v1/receipts/parse-receipt - Production Groq AI Receipt & Bill Parser
router.post('/parse-receipt', auth, upload.single('receipt'), async (req, res) => {
  try {
    const file = req.file;
    const fileName = file ? file.originalname : (req.body.fileName || 'receipt.jpg');
    const mimeType = file ? file.mimetype : 'image/jpeg';
    const rawTextInput = req.body.rawText || req.body.text || '';

    const parsedData = await parseReceiptData(
      file ? file.buffer : null,
      fileName,
      mimeType,
      rawTextInput
    );

    res.json({
      success: true,
      extractedData: parsedData,
      message: 'Receipt parsed successfully using Groq AI.'
    });
  } catch (err) {
    console.error('[Parse Receipt API Error]:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to process receipt with AI parser.'
    });
  }
});


module.exports = router;
