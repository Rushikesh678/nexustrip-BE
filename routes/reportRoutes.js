const express = require('express');
const router = express.Router({ mergeParams: true });
const Trip = require('../models/Trip');
const Participant = require('../models/Participant');
const Expense = require('../models/Expense');
const Booking = require('../models/Booking');
const Settlement = require('../models/Settlement');
const auth = require('../middleware/auth');
const { generateTripPDFReport } = require('../services/reportService');
const { calculateSettlement, recalculateParticipantBalances } = require('../services/calculationService');

// GET /api/v1/trips/:tripId/report - Get report JSON summary
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const participants = await recalculateParticipantBalances(tripId);
    const expenses = await Expense.find({ tripId, status: { $ne: 'DELETED' } }).populate('payerId', 'name email');
    const bookings = await Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } });
    const settlement = calculateSettlement(trip, participants);

    const totalExpenseCost = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalBookingCost = bookings.reduce((sum, b) => sum + b.total_cost, 0);
    const grandTotal = totalExpenseCost + totalBookingCost;

    // Spending by category
    const byCategory = {
      ACCOMMODATION: 0,
      FOOD: 0,
      TRANSPORT: 0,
      ACTIVITY: 0,
      OTHER: 0
    };

    expenses.forEach(e => {
      const cat = e.category || 'OTHER';
      byCategory[cat] = (byCategory[cat] || 0) + e.amount;
    });

    bookings.forEach(b => {
      const cat = b.type === 'accommodation' ? 'ACCOMMODATION' :
                  b.type === 'transportation' ? 'TRANSPORT' :
                  b.type === 'activity' ? 'ACTIVITY' :
                  b.type === 'meal' ? 'FOOD' : 'OTHER';
      byCategory[cat] = (byCategory[cat] || 0) + b.total_cost;
    });

    // AI Savings Recommendations based on data
    const recommendations = [];
    if (byCategory.ACCOMMODATION > 500 && participants.length >= 3) {
      recommendations.push({
        type: 'ACCOMMODATION',
        title: 'Share a Private Villa / House',
        savingsAmount: Math.round(byCategory.ACCOMMODATION * 0.25),
        description: `Your group is spending ₹${byCategory.ACCOMMODATION.toFixed(2)} on individual hotel rooms. Switching to a shared villa can save approx 25% (~₹${Math.round(byCategory.ACCOMMODATION * 0.25)}).`
      });
    }
    if (byCategory.TRANSPORT > 300 && participants.length >= 4) {
      recommendations.push({
        type: 'TRANSPORT',
        title: 'Group Van / Car Rental Optimization',
        savingsAmount: Math.round(byCategory.TRANSPORT * 0.30),
        description: `Group shuttle or rental van will save up to 30% (~₹${Math.round(byCategory.TRANSPORT * 0.30)}) compared to multiple taxis.`
      });
    }
    if (recommendations.length === 0) {
      recommendations.push({
        type: 'BUDGET',
        title: 'Group Meal & Activity Package',
        savingsAmount: 150,
        description: 'Booking group activity passes in advance yields 15% discount for 4+ members.'
      });
    }

    res.json({
      success: true,
      report: {
        tripName: trip.name,
        destination: trip.destination,
        durationDays: Math.ceil((new Date(trip.end_date) - new Date(trip.start_date)) / (1000 * 60 * 60 * 24)),
        totalCost: grandTotal,
        budget: trip.budget || 0,
        budgetUsedPercent: trip.budget > 0 ? Math.round((grandTotal / trip.budget) * 100) : 0,
        perPersonAverage: participants.length > 0 ? Math.round((grandTotal / participants.length) * 100) / 100 : 0,
        byCategory,
        participants: participants.map(p => ({
          id: p._id,
          name: p.name,
          email: p.email,
          totalPaid: p.total_paid,
          totalOwed: p.total_owed,
          netBalance: p.balance
        })),
        settlementTransactions: settlement.transactions_required,
        recommendations
      }
    });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ success: false, message: 'Server error generating trip report.' });
  }
});

// GET /api/v1/trips/:tripId/report/pdf - Export PDF
router.get('/pdf', auth, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).send('Trip not found.');
    }

    const participants = await recalculateParticipantBalances(tripId);
    const expenses = await Expense.find({ tripId, status: { $ne: 'DELETED' } });
    const bookings = await Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } });
    const settlement = calculateSettlement(trip, participants);

    generateTripPDFReport(trip, participants, expenses, bookings, settlement, res);
  } catch (err) {
    console.error('PDF error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Error generating PDF report: ' + err.message });
    }
  }
});

module.exports = router;
