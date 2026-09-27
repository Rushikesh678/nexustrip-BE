const Participant = require('../models/Participant');
const Expense = require('../models/Expense');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');

function calculateOverlapNights(arrivalA, departureA, arrivalB, departureB) {
  const start = new Date(Math.max(new Date(arrivalA).getTime(), new Date(arrivalB).getTime()));
  const end = new Date(Math.min(new Date(departureA).getTime(), new Date(departureB).getTime()));
  if (start >= end) return 0;
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function roundAmount(amount, method = 'last_person') {
  if (isNaN(amount)) return 0;
  switch (method) {
    case 'banker':
      return Math.round(amount * 100) / 100;
    case 'last_person':
      return Math.floor(amount * 100) / 100;
    case 'equal':
    default:
      return Math.round(amount * 100) / 100;
  }
}

function calculateParticipantShare(booking, participant, participants, trip) {
  const errors = [];
  let share = 0;
  let breakdown = '';

  const assignment = booking.assigned_participants?.find(
    a => a.participant_id.toString() === participant._id.toString()
  );

  if (!assignment && booking.allocation_model !== 'equal') {
    errors.push(`Participant ${participant.name} is not assigned to booking ${booking.description}`);
    return { share: 0, breakdown: 'ERROR: Not assigned', valid: false, errors };
  }

  const assignedCount = booking.assigned_participants?.length || participants.length || 1;

  switch (booking.allocation_model) {
    case 'equal':
      share = booking.total_cost / assignedCount;
      breakdown = `Total ₹${booking.total_cost} ÷ ${assignedCount} participants`;
      break;

    case 'weighted_nights': {
      const pNights = calculateOverlapNights(
        participant.arrival_date || trip.start_date,
        participant.departure_date || trip.end_date,
        booking.start_date,
        booking.end_date
      );
      const totalNights = booking.assigned_participants.reduce((sum, a) => {
        const p = participants.find(x => x._id.toString() === a.participant_id.toString());
        if (!p) return sum;
        return sum + calculateOverlapNights(
          p.arrival_date || trip.start_date,
          p.departure_date || trip.end_date,
          booking.start_date,
          booking.end_date
        );
      }, 0);

      share = totalNights > 0 ? (booking.total_cost / totalNights) * pNights : 0;
      breakdown = `(${pNights} nights ÷ ${totalNights} total nights) × ₹${booking.total_cost}`;
      break;
    }

    case 'tiered': {
      const tierTotal = booking.assigned_participants.reduce((sum, a) => {
        const p = participants.find(x => x._id.toString() === a.participant_id.toString());
        return sum + (p?.tier_multiplier || 1.0);
      }, 0);
      const multiplier = participant.tier_multiplier || 1.0;
      share = tierTotal > 0 ? (booking.total_cost / tierTotal) * multiplier : 0;
      breakdown = `(Multiplier ${multiplier} ÷ Total ${tierTotal}) × ₹${booking.total_cost}`;
      break;
    }

    case 'occupancy_based': {
      const qty = assignment ? assignment.quantity : 1;
      const roomies = booking.assigned_participants.filter(a => a.quantity === qty);
      share = roomies.length > 0 ? booking.total_cost / roomies.length : booking.total_cost / assignedCount;
      breakdown = `Group cost ₹${booking.total_cost} ÷ ${roomies.length || assignedCount} occupants`;
      break;
    }

    case 'consumption_only':
      share = booking.total_cost / assignedCount;
      breakdown = `${assignedCount} participants attended; ₹${booking.total_cost} total`;
      break;

    case 'custom_fixed':
      share = assignment ? assignment.amount_owed : 0;
      breakdown = `Custom fixed share: ₹${share}`;
      break;

    default:
      share = booking.total_cost / assignedCount;
      breakdown = `Default equal split: ₹${booking.total_cost} ÷ ${assignedCount}`;
  }

  share = roundAmount(share, trip.rounding_method);
  return { share, breakdown, valid: true, errors };
}

function calculateSettlement(trip, participants, expenses = [], payments = []) {
  const settlement = {
    tripId: trip._id,
    settlement_date: new Date().toISOString(),
    balances: [],
    transactions_required: [],
    validation_errors: [],
    is_balanced: true
  };

  let sumNetBalances = 0;

  for (const p of participants) {
    const totalOwed = p.total_owed || 0;
    const totalPaid = p.total_paid || 0;
    const netBalance = Math.round((p.balance || 0) * 100) / 100; // positive = owed money, negative = owes money

    settlement.balances.push({
      participant_id: p._id,
      name: p.name,
      total_owed: Math.round(totalOwed * 100) / 100,
      total_paid: Math.round(totalPaid * 100) / 100,
      consumption_share: Math.round((p.consumption_share || totalOwed) * 100) / 100,
      upfront_paid: Math.round((p.upfront_paid || totalPaid) * 100) / 100,
      net_balance: netBalance
    });

    sumNetBalances += netBalance;
  }

  // Debtors owe money (net_balance < -0.01)
  const debtors = settlement.balances
    .filter(b => b.net_balance < -0.01)
    .map(b => ({ ...b, remaining: Math.round(-b.net_balance * 100) / 100 }))
    .sort((a, b) => b.remaining - a.remaining);

  // Creditors are owed money (net_balance > 0.01)
  const creditors = settlement.balances
    .filter(b => b.net_balance > 0.01)
    .map(b => ({ ...b, remaining: Math.round(b.net_balance * 100) / 100 }))
    .sort((a, b) => b.remaining - a.remaining);

  let dIdx = 0;
  let cIdx = 0;
  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    const transfer = Math.min(debtor.remaining, creditor.remaining);
    const transferRounded = Math.round(transfer * 100) / 100;

    if (transferRounded > 0.009) {
      settlement.transactions_required.push({
        from_participant: debtor.participant_id,
        to_participant: creditor.participant_id,
        amount: transferRounded,
        reason: `Trip Settlement for ${trip.name}`,
        status: 'PENDING'
      });

      debtor.remaining = Math.round((debtor.remaining - transferRounded) * 100) / 100;
      creditor.remaining = Math.round((creditor.remaining - transferRounded) * 100) / 100;
    }

    if (debtor.remaining <= 0.009) dIdx++;
    if (creditor.remaining <= 0.009) cIdx++;
  }

  if (Math.abs(sumNetBalances) > 0.5) {
    settlement.validation_errors.push(`Unallocated balance difference: ₹${Math.abs(sumNetBalances).toFixed(2)} (check for unpaid vendor bookings).`);
  }

  settlement.is_balanced = settlement.validation_errors.length === 0;
  return settlement;
}

async function recalculateParticipantBalances(tripId) {
  const participants = await Participant.find({ trip_id: tripId });
  const expenses = await Expense.find({ tripId, status: { $ne: 'DELETED' } });
  const payments = await Payment.find({ trip_id: tripId, status: 'completed' });
  const bookings = await Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } });

  for (const p of participants) {
    let expensesPaid = 0;
    let bookingsPaid = 0;
    let expensesOwed = 0;
    let bookingsOwed = 0;
    let settlementPaid = 0;
    let settlementReceived = 0;

    // From Expenses
    for (const exp of expenses) {
      if (exp.payerId && exp.payerId.toString() === p._id.toString()) {
        expensesPaid += exp.amount;
      }
      const part = exp.participants?.find(pt => pt.memberId && pt.memberId.toString() === p._id.toString());
      if (part) {
        expensesOwed += part.share;
      }
    }

    // From Bookings
    for (const b of bookings) {
      if (b.paid_by && b.paid_by.toString() === p._id.toString()) {
        bookingsPaid += b.amount_paid || b.total_cost;
      }
      const assigned = b.assigned_participants?.find(ap => ap.participant_id && ap.participant_id.toString() === p._id.toString());
      if (assigned) {
        bookingsOwed += assigned.amount_owed;
      }
    }

    // From Direct Settlement Payments
    for (const pym of payments) {
      if (pym.payer_id && pym.payer_id.toString() === p._id.toString()) {
        settlementPaid += pym.amount;
      }
      if (pym.payee_id && pym.payee_id.toString() === p._id.toString()) {
        settlementReceived += pym.amount;
      }
    }

    const upfrontPaid = Math.round((expensesPaid + bookingsPaid) * 100) / 100;
    const consumptionShare = Math.round((expensesOwed + bookingsOwed) * 100) / 100;

    p.upfront_paid = upfrontPaid;
    p.consumption_share = consumptionShare;
    p.total_paid = Math.round((upfrontPaid + settlementPaid) * 100) / 100;
    p.total_owed = Math.round((consumptionShare + settlementReceived) * 100) / 100;
    p.balance = Math.round((p.total_paid - p.total_owed) * 100) / 100;

    await p.save();
  }

  return participants;
}

module.exports = {
  calculateOverlapNights,
  roundAmount,
  calculateParticipantShare,
  calculateSettlement,
  recalculateParticipantBalances
};
