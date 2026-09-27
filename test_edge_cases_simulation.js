const mongoose = require('mongoose');
require('dotenv').config();

const Trip = require('./models/Trip');
const Participant = require('./models/Participant');
const Expense = require('./models/Expense');
const Booking = require('./models/Booking');
const Payment = require('./models/Payment');
const Settlement = require('./models/Settlement');
const User = require('./models/User');

const {
  calculateOverlapNights,
  roundAmount,
  calculateParticipantShare,
  calculateSettlement,
  recalculateParticipantBalances
} = require('./services/calculationService');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function runEdgeCasesSimulation() {
  console.log('================================================================');
  console.log('🚀 NEXUSTRIP: EDGE CASE & SETTLEMENT MATRIX VERIFICATION SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // UNIT TEST 1: Overlap Nights Edge Cases
  // -------------------------------------------------------------
  console.log('▶️ TEST 1: Date Range & Overlap Nights Edge Cases');
  {
    // Normal 4 nights
    const n1 = calculateOverlapNights('2026-10-01', '2026-10-05', '2026-10-01', '2026-10-05');
    assert(n1 === 4, `Full overlap: expected 4 nights, got ${n1}`);

    // Arrives 2 days late (Oct 3 to Oct 5 = 2 nights)
    const n2 = calculateOverlapNights('2026-10-03', '2026-10-05', '2026-10-01', '2026-10-05');
    assert(n2 === 2, `Late arrival (Oct 3): expected 2 nights, got ${n2}`);

    // Departs early (Oct 1 to Oct 3 = 2 nights)
    const n3 = calculateOverlapNights('2026-10-01', '2026-10-03', '2026-10-01', '2026-10-05');
    assert(n3 === 2, `Early departure (Oct 3): expected 2 nights, got ${n3}`);

    // No overlap (arrives after booking ends)
    const n4 = calculateOverlapNights('2026-10-06', '2026-10-10', '2026-10-01', '2026-10-05');
    assert(n4 === 0, `Zero overlap after booking: expected 0 nights, got ${n4}`);

    // Same day arrival & departure (0 nights)
    const n5 = calculateOverlapNights('2026-10-01', '2026-10-01', '2026-10-01', '2026-10-05');
    assert(n5 === 0, `Same day check-in/out: expected 0 nights, got ${n5}`);
  }

  // -------------------------------------------------------------
  // UNIT TEST 2: Tiered Multiplier Splitting
  // -------------------------------------------------------------
  console.log('\n▶️ TEST 2: Tiered Multiplier Allocation');
  {
    const trip = { _id: new mongoose.Types.ObjectId(), rounding_method: 'banker' };
    const pVip = { _id: new mongoose.Types.ObjectId(), name: 'VIP Host', tier_multiplier: 2.0 };
    const pStd = { _id: new mongoose.Types.ObjectId(), name: 'Standard Member', tier_multiplier: 1.0 };
    const pKid = { _id: new mongoose.Types.ObjectId(), name: 'Kid/Student', tier_multiplier: 0.5 };
    const allP = [pVip, pStd, pKid];

    // Total cost = 700. Multipliers sum = 2.0 + 1.0 + 0.5 = 3.5.
    // VIP share: (700 / 3.5) * 2.0 = 400
    // Standard share: (700 / 3.5) * 1.0 = 200
    // Kid share: (700 / 3.5) * 0.5 = 100
    const booking = {
      total_cost: 700,
      allocation_model: 'tiered',
      assigned_participants: allP.map(p => ({ participant_id: p._id }))
    };

    const sVip = calculateParticipantShare(booking, pVip, allP, trip).share;
    const sStd = calculateParticipantShare(booking, pStd, allP, trip).share;
    const sKid = calculateParticipantShare(booking, pKid, allP, trip).share;

    assert(sVip === 400, `VIP share should be 400, got ${sVip}`);
    assert(sStd === 200, `Standard share should be 200, got ${sStd}`);
    assert(sKid === 100, `Kid share should be 100, got ${sKid}`);
    assert(sVip + sStd + sKid === 700, `Sum of tiered shares (${sVip + sStd + sKid}) equals total cost (700)`);
  }

  // -------------------------------------------------------------
  // UNIT TEST 3: Greedy Settlement Matrix Mathematical Invariance
  // -------------------------------------------------------------
  console.log('\n▶️ TEST 3: Greedy Settlement Algorithm & Minimum Transaction Optimization');
  {
    const mockTrip = { _id: new mongoose.Types.ObjectId(), name: 'Matrix Test Trip' };
    const p1 = { _id: new mongoose.Types.ObjectId(), name: 'Alice (Heavy Creditor)', balance: 500, total_paid: 600, total_owed: 100 };
    const p2 = { _id: new mongoose.Types.ObjectId(), name: 'Bob (Debtor)', balance: -200, total_paid: 0, total_owed: 200 };
    const p3 = { _id: new mongoose.Types.ObjectId(), name: 'Charlie (Debtor)', balance: -150, total_paid: 50, total_owed: 200 };
    const p4 = { _id: new mongoose.Types.ObjectId(), name: 'Dave (Debtor)', balance: -150, total_paid: 0, total_owed: 150 };
    const p5 = { _id: new mongoose.Types.ObjectId(), name: 'Eve (Even / Settled)', balance: 0, total_paid: 100, total_owed: 100 };

    const settlement = calculateSettlement(mockTrip, [p1, p2, p3, p4, p5]);

    assert(settlement.is_balanced === true, 'Settlement is strictly balanced (sum net balance = 0)');
    assert(settlement.transactions_required.length === 3, `Minimal transactions: expected 3, got ${settlement.transactions_required.length}`);

    // Verify all transactions flow to Alice
    let totalTransfer = 0;
    for (const tx of settlement.transactions_required) {
      assert(tx.to_participant.toString() === p1._id.toString(), `Transfer directed to creditor Alice from ${tx.from_participant}`);
      totalTransfer += tx.amount;
    }
    assert(totalTransfer === 500, `Total transfers (${totalTransfer}) exactly match creditor surplus (500)`);
    console.log('    Transfers generated:');
    settlement.transactions_required.forEach((tx, i) => {
      console.log(`     [Tx ${i+1}] Amount: ₹${tx.amount.toFixed(2)} | Status: ${tx.status}`);
    });

    // -------------------------------------------------------------
    // UNIT TEST 3B: Complex Multi-Creditor Multi-Debtor Bipartite Split
    // -------------------------------------------------------------
    console.log('\n▶️ TEST 3B: Complex Multi-Creditor & Multi-Debtor Split Boundary Matching');
    const c1 = { _id: new mongoose.Types.ObjectId(), name: 'Creditor 1 (Alice)', balance: 350, total_paid: 450, total_owed: 100 };
    const c2 = { _id: new mongoose.Types.ObjectId(), name: 'Creditor 2 (Bob)', balance: 250, total_paid: 350, total_owed: 100 };
    const d1 = { _id: new mongoose.Types.ObjectId(), name: 'Debtor 1 (Charlie)', balance: -300, total_paid: 0, total_owed: 300 };
    const d2 = { _id: new mongoose.Types.ObjectId(), name: 'Debtor 2 (Dave)', balance: -200, total_paid: 0, total_owed: 200 };
    const d3 = { _id: new mongoose.Types.ObjectId(), name: 'Debtor 3 (Eve)', balance: -100, total_paid: 0, total_owed: 100 };

    const multiSettlement = calculateSettlement(mockTrip, [c1, c2, d1, d2, d3]);
    assert(multiSettlement.is_balanced === true, 'Multi-party settlement is balanced');
    assert(multiSettlement.transactions_required.length === 4, `Multi-party transactions: expected 4, got ${multiSettlement.transactions_required.length}`);

    let multiTotal = 0;
    const multiVirtual = { [c1._id]: 350, [c2._id]: 250, [d1._id]: -300, [d2._id]: -200, [d3._id]: -100 };
    for (const tx of multiSettlement.transactions_required) {
      multiTotal += tx.amount;
      multiVirtual[tx.from_participant] += tx.amount;
      multiVirtual[tx.to_participant] -= tx.amount;
    }
    assert(multiTotal === 600, `Multi-party transfer total (${multiTotal}) equals total credit (600)`);
    for (const [pId, bal] of Object.entries(multiVirtual)) {
      assert(Math.abs(bal) < 0.001, `Participant ${pId} perfectly resolved to 0 (balance: ${bal})`);
    }
    console.log('    Multi-creditor split transfers generated:');
    multiSettlement.transactions_required.forEach((tx, i) => {
      console.log(`     [Tx ${i+1}] ${tx.from_participant} ➡️  ${tx.to_participant}: ₹${tx.amount.toFixed(2)}`);
    });
  }

  // -------------------------------------------------------------
  // INTEGRATION TEST: Full Database Demo Trip with ALL Edge Cases
  // -------------------------------------------------------------
  console.log('\n▶️ TEST 4: Live MongoDB End-to-End Simulation with Full Edge Case Trip');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('  ✓ Connected to MongoDB');

  // Find or create demo organizer user
  let hostUser = await User.findOne({ email: 'host_edgecase@nexustrip.com' });
  if (!hostUser) {
    hostUser = new User({
      name: 'Priya Sharma (Trip Host)',
      email: 'host_edgecase@nexustrip.com',
      password: 'password123',
      isVerified: true
    });
    await hostUser.save();
  }

  // Clean up any previous test run trip
  const existingTestTrip = await Trip.findOne({ name: 'Goa Coastal Quest - Edge Case Lab' });
  if (existingTestTrip) {
    const oldTripId = existingTestTrip._id;
    await Booking.deleteMany({ trip_id: oldTripId });
    await Expense.deleteMany({ tripId: oldTripId });
    await Payment.deleteMany({ trip_id: oldTripId });
    await Settlement.deleteMany({ tripId: oldTripId });
    await Participant.deleteMany({ trip_id: oldTripId });
    await Trip.deleteOne({ _id: oldTripId });
    console.log('  ✓ Cleaned up old demo trip');
  }

  // 1. Create Trip (Oct 1 to Oct 6, 2026 - 5 nights)
  const trip = new Trip({
    name: 'Goa Coastal Quest - Edge Case Lab',
    description: 'Comprehensive demo trip testing: Weighted nights, Tiered multipliers, Subgroup side quests, Multiple payers, Mid-trip settle-ups, and Remainder pennies.',
    destination: 'Goa, India',
    organizer_id: hostUser._id,
    start_date: new Date('2026-10-01'),
    end_date: new Date('2026-10-06'),
    status: 'active',
    currency: 'INR',
    cost_sharing_model: 'equal',
    rounding_method: 'banker',
    settings: {
      allowMemberExpenses: true,
      requireHostApproval: false,
      settlementMethod: 'simplify'
    }
  });
  await trip.save();
  console.log(`  ✓ Created Demo Trip: "${trip.name}" (ID: ${trip._id})`);

  // 2. Create Diverse Participants with Edge Case Profiles
  const participantsData = [
    {
      name: 'Alice (Villa Host)',
      email: 'alice@nexustrip.com',
      status: 'confirmed',
      arrival_date: new Date('2026-10-01'),
      departure_date: new Date('2026-10-06'),
      cost_tier: 'HOST',
      tier_multiplier: 1.0,
      upi_id: 'alice@okhdfcbank'
    },
    {
      name: 'Bob (Late Joiner)',
      email: 'bob@nexustrip.com',
      status: 'confirmed',
      arrival_date: new Date('2026-10-03'), // Arrives 2 days late! Stays 3 nights
      departure_date: new Date('2026-10-06'),
      cost_tier: 'STANDARD',
      tier_multiplier: 1.0,
      upi_id: 'bob@okaxis'
    },
    {
      name: 'Charlie (Early Departer)',
      email: 'charlie@nexustrip.com',
      status: 'confirmed',
      arrival_date: new Date('2026-10-01'),
      departure_date: new Date('2026-10-04'), // Leaves 2 days early! Stays 3 nights
      cost_tier: 'STANDARD',
      tier_multiplier: 1.0,
      upi_id: 'charlie@oksbi'
    },
    {
      name: 'Diana (VIP Suite Sponsor)',
      email: 'diana@nexustrip.com',
      status: 'confirmed',
      arrival_date: new Date('2026-10-01'),
      departure_date: new Date('2026-10-06'),
      cost_tier: 'VIP',
      tier_multiplier: 1.5, // 1.5x multiplier on tiered bookings
      upi_id: 'diana@paytm'
    },
    {
      name: 'Evan (Student / Budget Tier)',
      email: 'evan@nexustrip.com',
      status: 'confirmed',
      arrival_date: new Date('2026-10-01'),
      departure_date: new Date('2026-10-06'),
      cost_tier: 'STUDENT',
      tier_multiplier: 0.5, // 0.5x multiplier on tiered bookings
      upi_id: 'evan@upi'
    },
    {
      name: 'Frank (Side-Quest Opt-out)',
      email: 'frank@nexustrip.com',
      status: 'confirmed',
      arrival_date: new Date('2026-10-01'),
      departure_date: new Date('2026-10-06'),
      cost_tier: 'STANDARD',
      tier_multiplier: 1.0,
      upi_id: 'frank@ybl'
    },
    {
      name: 'Grace (Van Booker & Mid-Trip Settle)',
      email: 'grace@nexustrip.com',
      status: 'confirmed',
      arrival_date: new Date('2026-10-01'),
      departure_date: new Date('2026-10-06'),
      cost_tier: 'STANDARD',
      tier_multiplier: 1.0,
      upi_id: 'grace@icici'
    }
  ];

  const participants = [];
  for (const pd of participantsData) {
    const p = new Participant({ ...pd, trip_id: trip._id });
    await p.save();
    participants.push(p);
  }
  console.log(`  ✓ Created ${participants.length} edge-case participants`);

  const [alice, bob, charlie, diana, evan, frank, grace] = participants;

  // 3. BOOKING 1: Luxury Beachfront Villa (WEIGHTED NIGHTS EDGE CASE)
  // Total Cost: ₹35,000 for 5 nights (Oct 1 - Oct 6)
  // Alice pays upfront.
  // Stays:
  // Alice: 5 nights, Bob: 3 nights, Charlie: 3 nights, Diana: 5 nights, Evan: 5 nights, Frank: 5 nights, Grace: 5 nights
  // Total participant nights = 5 + 3 + 3 + 5 + 5 + 5 + 5 = 31 nights.
  // Cost per night-share = 35,000 / 31 = ₹1129.032258...
  const villaBooking = new Booking({
    trip_id: trip._id,
    description: 'Heritage Beachfront Villa (5 Nights)',
    location: 'Candolim, North Goa',
    type: 'accommodation',
    vendor_name: 'Goa Villa Stays',
    booking_reference: 'VILLA-GOA-778',
    start_date: new Date('2026-10-01'),
    end_date: new Date('2026-10-06'),
    total_cost: 35000,
    allocation_model: 'weighted_nights',
    paid_by: alice._id,
    payment_status: 'paid_in_full',
    amount_paid: 35000,
    assigned_participants: participants.map(p => {
      const calc = calculateParticipantShare(
        {
          total_cost: 35000,
          start_date: new Date('2026-10-01'),
          end_date: new Date('2026-10-06'),
          allocation_model: 'weighted_nights',
          assigned_participants: participants.map(x => ({ participant_id: x._id }))
        },
        p,
        participants,
        trip
      );
      return {
        participant_id: p._id,
        amount_owed: calc.share,
        share_calculation: {
          model: 'weighted_nights',
          final_share: calc.share
        }
      };
    })
  });
  await villaBooking.save();
  console.log('  ✓ Booking 1 created: Weighted Nights Villa (₹35,000 paid by Alice)');

  // 4. BOOKING 2: Luxury Catamaran Sunset Cruise (TIERED MULTIPLIER EDGE CASE)
  // Total Cost: ₹14,000.
  // Diana pays upfront.
  // Multipliers: Diana (1.5), Evan (0.5), Alice (1.0), Bob (1.0), Charlie (1.0), Frank (1.0), Grace (1.0).
  // Total multiplier sum = 1.5 + 0.5 + 1.0 + 1.0 + 1.0 + 1.0 + 1.0 = 7.0!
  // Per unit = 14000 / 7 = 2000.
  // Diana: 2000 * 1.5 = 3000
  // Evan: 2000 * 0.5 = 1000
  // Each other (5 people): 2000 * 1.0 = 2000 each (Total = 10000).
  // Sum = 3000 + 1000 + 10000 = 14000 exact!
  const cruiseBooking = new Booking({
    trip_id: trip._id,
    description: 'Private Catamaran Sunset Yacht Cruise',
    location: 'Mandovi River, Panaji',
    type: 'activity',
    vendor_name: 'Goa Yacht Charters',
    start_date: new Date('2026-10-03'),
    end_date: new Date('2026-10-03'),
    total_cost: 14000,
    allocation_model: 'tiered',
    paid_by: diana._id,
    payment_status: 'paid_in_full',
    amount_paid: 14000,
    assigned_participants: participants.map(p => {
      const calc = calculateParticipantShare(
        {
          total_cost: 14000,
          allocation_model: 'tiered',
          assigned_participants: participants.map(x => ({ participant_id: x._id }))
        },
        p,
        participants,
        trip
      );
      return {
        participant_id: p._id,
        amount_owed: calc.share,
        share_calculation: {
          model: 'tiered',
          multiplier: p.tier_multiplier || 1,
          final_share: calc.share
        }
      };
    })
  });
  await cruiseBooking.save();
  console.log('  ✓ Booking 2 created: Tiered Cruise (₹14,000 paid by Diana)');

  // 5. BOOKING 3: Group AC Traveler Van Shuttle (EQUAL SPLIT WITH REMAINDER PENNY)
  // Total Cost: ₹7,001 (Notice the ₹1 odd remainder to test penny balancing across 7 people!)
  // Grace pays upfront.
  // 7001 / 7 = 1000.1428...
  // 6 people @ ₹1000.14, 7th person @ ₹1000.16. Sum = exactly ₹7001.00!
  let runningShare = 0;
  const vanAssigned = participants.map((p, idx) => {
    const isLast = idx === participants.length - 1;
    const base = Math.floor((7001 / participants.length) * 100) / 100;
    const finalShare = isLast ? Math.round((7001 - runningShare) * 100) / 100 : base;
    runningShare += base;
    return {
      participant_id: p._id,
      amount_owed: finalShare,
      share_calculation: { model: 'equal', final_share: finalShare }
    };
  });

  const vanBooking = new Booking({
    trip_id: trip._id,
    description: 'Airport & Intercity 12-Seater AC Van',
    location: 'Goa Airport to Villa',
    type: 'transportation',
    vendor_name: 'Goa Miles Tourist Vans',
    start_date: new Date('2026-10-01'),
    end_date: new Date('2026-10-06'),
    total_cost: 7001,
    allocation_model: 'equal',
    paid_by: grace._id,
    payment_status: 'paid_in_full',
    amount_paid: 7001,
    assigned_participants: vanAssigned
  });
  await vanBooking.save();
  console.log('  ✓ Booking 3 created: Equal Van with Remainder Penny (₹7,001 paid by Grace)');

  // 6. EXPENSE 1: Grande Island Scuba Diving (SUBGROUP SIDE-QUEST EDGE CASE)
  // Only Alice, Bob, and Diana went. Frank, Evan, Charlie, Grace opted out!
  // Cost: ₹9,000 paid by Bob.
  // Split 3 ways: Alice (3000), Bob (3000), Diana (3000). Frank & others owe ₹0.
  const scubaExpense = new Expense({
    tripId: trip._id,
    payerId: bob._id,
    description: 'Scuba Diving & Island Snorkeling',
    merchant: 'Dive Goa Adventure Club',
    category: 'ACTIVITY',
    amount: 9000,
    isSideQuest: true,
    sideQuestTitle: 'Scuba Squad Subgroup',
    status: 'POSTED',
    participants: [
      { memberId: alice._id, share: 3000, shareType: 'EQUAL' },
      { memberId: bob._id, share: 3000, shareType: 'EQUAL' },
      { memberId: diana._id, share: 3000, shareType: 'EQUAL' }
    ]
  });
  await scubaExpense.save();
  console.log('  ✓ Expense 1 created: Subgroup Side Quest (₹9,000 paid by Bob, only 3 attended)');

  // 7. EXPENSE 2: Beachside Barbecue & Cocktail Night (CUSTOM SPLIT EDGE CASE)
  // Total Cost: ₹8,500 paid by Frank.
  // Custom split based on consumption:
  // Alice: 1500, Bob: 1000, Charlie: 1000, Diana: 2000, Evan: 500, Frank: 1500, Grace: 1000 = ₹8,500.
  const bbqExpense = new Expense({
    tripId: trip._id,
    payerId: frank._id,
    description: 'Fishermans Wharf Seafood Barbecue Dinner',
    merchant: 'The Fishermans Wharf',
    category: 'FOOD',
    amount: 8500,
    status: 'POSTED',
    participants: [
      { memberId: alice._id, share: 1500, shareType: 'CUSTOM', customAmount: 1500 },
      { memberId: bob._id, share: 1000, shareType: 'CUSTOM', customAmount: 1000 },
      { memberId: charlie._id, share: 1000, shareType: 'CUSTOM', customAmount: 1000 },
      { memberId: diana._id, share: 2000, shareType: 'CUSTOM', customAmount: 2000 },
      { memberId: evan._id, share: 500, shareType: 'CUSTOM', customAmount: 500 },
      { memberId: frank._id, share: 1500, shareType: 'CUSTOM', customAmount: 1500 },
      { memberId: grace._id, share: 1000, shareType: 'CUSTOM', customAmount: 1000 }
    ]
  });
  await bbqExpense.save();
  console.log('  ✓ Expense 2 created: Custom Consumption Split (₹8,500 paid by Frank)');

  // 8. PAYMENT: Mid-Trip Direct Settle-Up (PARTIAL PAYMENT EDGE CASE)
  // Evan realizes he owes upfront money and pays ₹500 directly to Alice via UPI during the trip!
  const directPymt = new Payment({
    trip_id: trip._id,
    payer_id: evan._id,
    payee_id: alice._id,
    amount: 500,
    payment_method: 'upi',
    reference_number: 'UPI-TXN-998822',
    status: 'completed',
    notes: 'Evan mid-trip cash settle-up towards Alice'
  });
  await directPymt.save();
  console.log('  ✓ Payment created: Mid-Trip Direct Settlement (₹500 from Evan -> Alice)');

  // -------------------------------------------------------------
  // RECALCULATE AND RUN SETTLEMENT ENGINE
  // -------------------------------------------------------------
  console.log('\n▶️ TEST 5: Recalculating Ledger Balances & Running Settlement Matrix');

  const updatedParticipants = await recalculateParticipantBalances(trip._id);
  const settlementResult = calculateSettlement(trip, updatedParticipants);

  // Save Settlement Document
  const settlementDoc = new Settlement({
    tripId: trip._id,
    status: 'IN_PROGRESS',
    balances: settlementResult.balances,
    transactions_required: settlementResult.transactions_required,
    validation_errors: settlementResult.validation_errors,
    is_balanced: settlementResult.is_balanced,
    calculatedAt: new Date()
  });
  await settlementDoc.save();

  // Print Formatted Net Position Table
  console.log('\n📊 PARTICIPANT NET POSITION SUMMARY:');
  console.table(
    settlementResult.balances.map(b => ({
      'Participant': b.name,
      'Paid Upfront': `₹${b.total_paid.toFixed(2)}`,
      'Consumption Share': `₹${b.total_owed.toFixed(2)}`,
      'Net Balance': b.net_balance > 0 ? `+₹${b.net_balance.toFixed(2)} (CREDITOR)` : b.net_balance < 0 ? `-₹${Math.abs(b.net_balance).toFixed(2)} (DEBTOR)` : '₹0.00 (EVEN)'
    }))
  );

  // -------------------------------------------------------------
  // MATHEMATICAL INVARIANCE ASSERTIONS
  // -------------------------------------------------------------
  console.log('\n▶️ TEST 6: Verifying Mathematical Invariants & Settlement Integrity');

  let totalPaidAll = 0;
  let totalOwedAll = 0;
  let sumNetBalances = 0;
  let sumDebtors = 0;
  let sumCreditors = 0;

  for (const b of settlementResult.balances) {
    totalPaidAll += b.total_paid;
    totalOwedAll += b.total_owed;
    sumNetBalances += b.net_balance;
    if (b.net_balance < -0.009) sumDebtors += Math.abs(b.net_balance);
    if (b.net_balance > 0.009) sumCreditors += b.net_balance;
  }

  console.log(`  • Total Out of Pocket Paid across all members: ₹${totalPaidAll.toFixed(2)}`);
  console.log(`  • Total Consumption Share across all members:  ₹${totalOwedAll.toFixed(2)}`);
  console.log(`  • Net Balance Algebraic Sum:                   ₹${sumNetBalances.toFixed(4)}`);
  console.log(`  • Total Debtors Owe:                          ₹${sumDebtors.toFixed(2)}`);
  console.log(`  • Total Creditors are Owed:                   ₹${sumCreditors.toFixed(2)}`);

  assert(Math.abs(totalPaidAll - totalOwedAll) < 0.05, `Conservation of Money: Total Paid (₹${totalPaidAll.toFixed(2)}) == Total Owed (₹${totalOwedAll.toFixed(2)})`);
  assert(Math.abs(sumNetBalances) < 0.05, `Zero-Sum Invariance: Net balances sum (${sumNetBalances.toFixed(4)}) is practically 0.00`);
  assert(Math.abs(sumDebtors - sumCreditors) < 0.05, `Bipartite Symmetry: Debtor sum (${sumDebtors.toFixed(2)}) == Creditor sum (${sumCreditors.toFixed(2)})`);
  assert(settlementResult.is_balanced === true, 'Settlement is_balanced flag is TRUE with 0 validation errors');

  // -------------------------------------------------------------
  // TRANSACTIONS VERIFICATION
  // -------------------------------------------------------------
  console.log('\n📋 REQUIRED PEER PAYOUT TRANSACTIONS (GREEDY MINIMIZED):');
  let totalTxAmount = 0;
  settlementResult.transactions_required.forEach((tx, idx) => {
    const fromP = updatedParticipants.find(p => p._id.toString() === tx.from_participant.toString());
    const toP = updatedParticipants.find(p => p._id.toString() === tx.to_participant.toString());
    console.log(`   [Tx ${idx + 1}] ${fromP.name} ➡️  ${toP.name}: ₹${tx.amount.toFixed(2)} (${tx.reason})`);
    totalTxAmount += tx.amount;
  });

  assert(Math.abs(totalTxAmount - sumCreditors) < 0.05, `Sum of Transactions (₹${totalTxAmount.toFixed(2)}) == Total Debt (₹${sumCreditors.toFixed(2)})`);
  assert(settlementResult.transactions_required.length < participants.length * (participants.length - 1) / 2,
    `Optimization achieved: ${settlementResult.transactions_required.length} transactions vs ${participants.length * (participants.length - 1) / 2} naive pairwise combinations`);

  // -------------------------------------------------------------
  // SIMULATE TRANSACTION EXECUTION TO ZERO
  // -------------------------------------------------------------
  console.log('\n▶️ TEST 7: Simulating Post-Payout Balances (Zero-Out Check)');
  const virtualBalances = {};
  for (const b of settlementResult.balances) {
    virtualBalances[b.participant_id.toString()] = b.net_balance;
  }

  for (const tx of settlementResult.transactions_required) {
    virtualBalances[tx.from_participant.toString()] += tx.amount; // Debtor pays, balance goes towards 0
    virtualBalances[tx.to_participant.toString()] -= tx.amount;   // Creditor receives, balance goes towards 0
  }

  for (const p of updatedParticipants) {
    const finalBalance = Math.round(virtualBalances[p._id.toString()] * 100) / 100;
    assert(Math.abs(finalBalance) <= 0.01, `${p.name} final balance after settlements is exactly ₹0.00 (got ${finalBalance})`);
  }

  console.log('\n================================================================');
  console.log('🎉 ALL EDGE CASES & SETTLEMENT MATRIX TESTS PASSED WITH 100% ACCURACY!');
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

runEdgeCasesSimulation().catch(err => {
  console.error('Fatal error during simulation:', err);
  process.exit(1);
});
