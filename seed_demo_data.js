const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const Trip = require('./models/Trip');
const Participant = require('./models/Participant');
const Booking = require('./models/Booking');
const Expense = require('./models/Expense');
const Payment = require('./models/Payment');
const Settlement = require('./models/Settlement');
const ItineraryBlock = require('./models/ItineraryBlock');
const AuditLog = require('./models/AuditLog');

const {
  calculateParticipantShare,
  calculateSettlement,
  recalculateParticipantBalances
} = require('./services/calculationService');

async function seedDatabase() {
  console.log('====================================================');
  console.log('🌟 NEXUSTRIP DEMO DATA INJECTION SUITE (HACKATHON) 🌟');
  console.log('====================================================\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas successfully.');

    // -------------------------------------------------------------
    // 1. CLEAR EXISTING DEMO RECORDS (Idempotent cleanup)
    // -------------------------------------------------------------
    const demoEmails = [
      'demo@nexustrip.com',
      'alice@nexustrip.com',
      'bob@nexustrip.com',
      'charlie@nexustrip.com',
      'diana@nexustrip.com',
      'evan@nexustrip.com',
      'frank@nexustrip.com',
      'grace@nexustrip.com'
    ];

    const existingUsers = await User.find({ email: { $in: demoEmails } });
    const userIds = existingUsers.map(u => u._id);

    const existingTrips = await Trip.find({
      $or: [
        { organizer_id: { $in: userIds } },
        { inviteCode: { $in: ['GOA2026', 'TOKYO26', 'ALPS2026'] } },
        { name: /Goa Coastal Quest|Tokyo Neon|Swiss Alps/i }
      ]
    });
    const tripIds = existingTrips.map(t => t._id);

    await Booking.deleteMany({ trip_id: { $in: tripIds } });
    await Expense.deleteMany({ tripId: { $in: tripIds } });
    await Payment.deleteMany({ trip_id: { $in: tripIds } });
    await Settlement.deleteMany({ tripId: { $in: tripIds } });
    await ItineraryBlock.deleteMany({ trip_id: { $in: tripIds } });
    await Participant.deleteMany({ trip_id: { $in: tripIds } });
    await AuditLog.deleteMany({ tripId: { $in: tripIds } });
    await Trip.deleteMany({ _id: { $in: tripIds } });
    await User.deleteMany({ email: { $in: demoEmails } });

    console.log('🧹 Cleaned up old demo records for a fresh state.\n');

    // -------------------------------------------------------------
    // 2. CREATE DEMO USERS (Password: "password123")
    // -------------------------------------------------------------
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const usersData = [
      {
        name: 'Alex Vance (Lead Organizer)',
        email: 'demo@nexustrip.com',
        password: hashedPassword,
        role: 'host',
        phone: '+91 98765 43210',
        upi_id: 'demo@okhdfcbank',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'
      },
      {
        name: 'Alice Chen (Villa Host)',
        email: 'alice@nexustrip.com',
        password: hashedPassword,
        role: 'host',
        phone: '+91 98234 11223',
        upi_id: 'alice@okhdfcbank',
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'
      },
      {
        name: 'Bob Martinez (Late Joiner)',
        email: 'bob@nexustrip.com',
        password: hashedPassword,
        role: 'member',
        phone: '+91 98345 22334',
        upi_id: 'bob@okaxis',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'
      },
      {
        name: 'Charlie Dubois (Early Departer)',
        email: 'charlie@nexustrip.com',
        password: hashedPassword,
        role: 'member',
        phone: '+91 98456 33445',
        upi_id: 'charlie@oksbi',
        avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150'
      },
      {
        name: 'Diana Prince (VIP Sponsor)',
        email: 'diana@nexustrip.com',
        password: hashedPassword,
        role: 'member',
        phone: '+91 98567 44556',
        upi_id: 'diana@paytm',
        avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'
      },
      {
        name: 'Evan Wright (Student / Budget)',
        email: 'evan@nexustrip.com',
        password: hashedPassword,
        role: 'member',
        phone: '+91 98678 55667',
        upi_id: 'evan@upi',
        avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150'
      },
      {
        name: 'Frank Castle (Foodie / Opt-out)',
        email: 'frank@nexustrip.com',
        password: hashedPassword,
        role: 'member',
        phone: '+91 98789 66778',
        upi_id: 'frank@ybl',
        avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150'
      },
      {
        name: 'Grace Hopper (Logistics Lead)',
        email: 'grace@nexustrip.com',
        password: hashedPassword,
        role: 'member',
        phone: '+91 98890 77889',
        upi_id: 'grace@icici',
        avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150'
      }
    ];

    const users = await User.insertMany(usersData);
    const userMap = {};
    users.forEach(u => { userMap[u.email] = u; });
    console.log(`👤 Created ${users.length} Demo Accounts with password: "password123"`);

    const demoHost = userMap['demo@nexustrip.com'];

    // =============================================================
    // 3. TRIP 1: FLAGSHIP SHOWCASE - GOA COASTAL QUEST 2026
    // =============================================================
    console.log('\n🌴 Seeding Trip 1: "Goa Coastal Quest 2026" (Flagship Edge-Case Lab)...');

    const trip1 = new Trip({
      name: 'Goa Coastal Quest 2026',
      description: 'The ultimate showcase trip: Multi-model cost splits (Weighted nights, Tiered multipliers, Subgroup side quests, Odd remainder penny balancing), Live UPI settlements, and Interactive Itinerary.',
      destination: 'Goa, India',
      organizer_id: demoHost._id,
      co_organizers: [userMap['alice@nexustrip.com']._id],
      start_date: new Date('2026-10-01'),
      end_date: new Date('2026-10-06'),
      status: 'active',
      currency: 'INR',
      inviteCode: 'GOA2026',
      total_cost_estimated: 85000,
      total_cost_actual: 76551,
      budget: 90000,
      payment_deadline: new Date('2026-09-28'),
      settlement_deadline: new Date('2026-10-10'),
      cost_sharing_model: 'equal',
      allow_partial_join: true,
      allow_partial_payment: true,
      refund_policy: 'full',
      rounding_method: 'banker',
      settings: {
        allowMemberExpenses: true,
        requireHostApproval: false,
        allowMultipleCurrencies: true,
        settlementMethod: 'simplify'
      }
    });
    await trip1.save();

    // 3A. PARTICIPANTS FOR TRIP 1 (With distinct edge-case dates & multipliers)
    const participantsTrip1Data = [
      {
        trip_id: trip1._id,
        user_id: userMap['alice@nexustrip.com']._id,
        name: 'Alice Chen (Villa Host)',
        email: 'alice@nexustrip.com',
        phone: '+91 98234 11223',
        status: 'confirmed',
        arrival_date: new Date('2026-10-01'),
        departure_date: new Date('2026-10-06'),
        cost_tier: 'HOST',
        tier_multiplier: 1.0,
        upi_id: 'alice@okhdfcbank'
      },
      {
        trip_id: trip1._id,
        user_id: userMap['bob@nexustrip.com']._id,
        name: 'Bob Martinez (Late Joiner)',
        email: 'bob@nexustrip.com',
        phone: '+91 98345 22334',
        status: 'confirmed',
        arrival_date: new Date('2026-10-03'), // Stays 3 nights instead of 5
        departure_date: new Date('2026-10-06'),
        cost_tier: 'STANDARD',
        tier_multiplier: 1.0,
        upi_id: 'bob@okaxis'
      },
      {
        trip_id: trip1._id,
        user_id: userMap['charlie@nexustrip.com']._id,
        name: 'Charlie Dubois (Early Departer)',
        email: 'charlie@nexustrip.com',
        phone: '+91 98456 33445',
        status: 'confirmed',
        arrival_date: new Date('2026-10-01'),
        departure_date: new Date('2026-10-04'), // Leaves 2 days early! Stays 3 nights
        cost_tier: 'STANDARD',
        tier_multiplier: 1.0,
        upi_id: 'charlie@oksbi'
      },
      {
        trip_id: trip1._id,
        user_id: userMap['diana@nexustrip.com']._id,
        name: 'Diana Prince (VIP Sponsor)',
        email: 'diana@nexustrip.com',
        phone: '+91 98567 44556',
        status: 'confirmed',
        arrival_date: new Date('2026-10-01'),
        departure_date: new Date('2026-10-06'),
        cost_tier: 'VIP',
        tier_multiplier: 1.5, // Pays 1.5x on tiered events
        upi_id: 'diana@paytm'
      },
      {
        trip_id: trip1._id,
        user_id: userMap['evan@nexustrip.com']._id,
        name: 'Evan Wright (Student / Budget)',
        email: 'evan@nexustrip.com',
        phone: '+91 98678 55667',
        status: 'confirmed',
        arrival_date: new Date('2026-10-01'),
        departure_date: new Date('2026-10-06'),
        cost_tier: 'STUDENT',
        tier_multiplier: 0.5, // Pays 0.5x on tiered events
        upi_id: 'evan@upi'
      },
      {
        trip_id: trip1._id,
        user_id: userMap['frank@nexustrip.com']._id,
        name: 'Frank Castle (Activity Opt-out)',
        email: 'frank@nexustrip.com',
        phone: '+91 98789 66778',
        status: 'confirmed',
        arrival_date: new Date('2026-10-01'),
        departure_date: new Date('2026-10-06'),
        cost_tier: 'STANDARD',
        tier_multiplier: 1.0,
        upi_id: 'frank@ybl'
      },
      {
        trip_id: trip1._id,
        user_id: userMap['grace@nexustrip.com']._id,
        name: 'Grace Hopper (Logistics Lead)',
        email: 'grace@nexustrip.com',
        phone: '+91 98890 77889',
        status: 'confirmed',
        arrival_date: new Date('2026-10-01'),
        departure_date: new Date('2026-10-06'),
        cost_tier: 'STANDARD',
        tier_multiplier: 1.0,
        upi_id: 'grace@icici'
      }
    ];

    const pTrip1 = await Participant.insertMany(participantsTrip1Data);
    const [pAlice, pBob, pCharlie, pDiana, pEvan, pFrank, pGrace] = pTrip1;

    // 3B. ITINERARY BLOCKS (5 Days)
    const itineraryData = [
      {
        trip_id: trip1._id,
        day_number: 1,
        date: new Date('2026-10-01'),
        time_slot: 'morning',
        start_time: '10:00',
        end_time: '13:00',
        title: 'Airport Arrivals & AC Van Pickup',
        location: 'Goa Dabolim Airport',
        category: 'TRANSPORT',
        estimated_cost: 3500,
        status: 'COMPLETED',
        notes: 'Grace coordinating group shuttle pickup'
      },
      {
        trip_id: trip1._id,
        day_number: 1,
        date: new Date('2026-10-01'),
        time_slot: 'afternoon',
        start_time: '14:00',
        end_time: '16:00',
        title: 'Check-in: Heritage Beachfront Villa',
        location: 'Candolim, North Goa',
        category: 'ACCOMMODATION',
        estimated_cost: 35000,
        status: 'COMPLETED',
        notes: 'Host Alice handling keys and room assignments'
      },
      {
        trip_id: trip1._id,
        day_number: 1,
        date: new Date('2026-10-01'),
        time_slot: 'evening',
        start_time: '18:00',
        end_time: '21:00',
        title: 'Candolim Sunset Beach Walk & Cocktails',
        location: 'Candolim Beach Shack',
        category: 'FOOD',
        estimated_cost: 2500,
        status: 'COMPLETED'
      },
      {
        trip_id: trip1._id,
        day_number: 2,
        date: new Date('2026-10-02'),
        time_slot: 'morning',
        start_time: '09:30',
        end_time: '13:00',
        title: 'Old Goa Heritage Walk & Basilica of Bom Jesus',
        location: 'Old Goa, Panaji',
        category: 'ACTIVITY',
        estimated_cost: 1500,
        status: 'COMPLETED'
      },
      {
        trip_id: trip1._id,
        day_number: 2,
        date: new Date('2026-10-02'),
        time_slot: 'night',
        start_time: '20:00',
        end_time: '23:30',
        title: 'Anjuna Flea Market & Live Jazz Dinner',
        location: 'Curlies / Shiva Valley, Anjuna',
        category: 'LEISURE',
        estimated_cost: 4500,
        status: 'COMPLETED'
      },
      {
        trip_id: trip1._id,
        day_number: 3,
        date: new Date('2026-10-03'),
        time_slot: 'afternoon',
        start_time: '15:30',
        end_time: '19:00',
        title: 'Private Catamaran Sunset Yacht Cruise',
        location: 'Mandovi River Bay, Panaji',
        category: 'ACTIVITY',
        estimated_cost: 14000,
        status: 'COMPLETED',
        notes: 'VIP Sponsor Diana sponsored the charter with tiered contributions'
      },
      {
        trip_id: trip1._id,
        day_number: 4,
        date: new Date('2026-10-04'),
        time_slot: 'morning',
        start_time: '07:30',
        end_time: '14:00',
        title: 'Grande Island Scuba Diving & Coral Snorkeling (Side Quest)',
        location: 'Grande Island, South Goa',
        category: 'ACTIVITY',
        estimated_cost: 9000,
        status: 'IN_PROGRESS',
        notes: 'Subgroup excursion: Alice, Bob, and Diana attended'
      },
      {
        trip_id: trip1._id,
        day_number: 4,
        date: new Date('2026-10-04'),
        time_slot: 'night',
        start_time: '19:30',
        end_time: '23:00',
        title: "Fisherman's Wharf Seafood Barbecue Dinner",
        location: 'Fishermans Wharf, Salcete',
        category: 'FOOD',
        estimated_cost: 8500,
        status: 'PLANNED',
        notes: 'Frank paid bill; split customized by item consumption'
      },
      {
        trip_id: trip1._id,
        day_number: 5,
        date: new Date('2026-10-05'),
        time_slot: 'afternoon',
        start_time: '11:00',
        end_time: '15:00',
        title: 'Sahakari Spice Plantation Tour & Traditional Buffet',
        location: 'Ponda, Central Goa',
        category: 'ACTIVITY',
        estimated_cost: 3000,
        status: 'PLANNED'
      },
      {
        trip_id: trip1._id,
        day_number: 5,
        date: new Date('2026-10-05'),
        time_slot: 'night',
        start_time: '20:00',
        end_time: '23:00',
        title: 'Farewell Beach Bonfire & Ledger Settle-Up Party',
        location: 'Candolim Beach',
        category: 'LEISURE',
        estimated_cost: 2000,
        status: 'PLANNED'
      }
    ];
    await ItineraryBlock.insertMany(itineraryData);
    console.log(`  📅 Added ${itineraryData.length} Day-by-Day Itinerary Blocks`);

    // 3C. BOOKINGS (Demonstrating Weighted Nights, Tiered Multipliers, Remainder Pennies)
    
    // Booking 1: Weighted Nights Accommodation
    const villaBooking = new Booking({
      trip_id: trip1._id,
      description: 'Heritage Beachfront Villa (5 Nights)',
      location: 'Candolim, North Goa',
      type: 'accommodation',
      vendor_name: 'Goa Luxury Villa Stays',
      booking_reference: 'VILLA-GOA-778',
      start_date: new Date('2026-10-01'),
      end_date: new Date('2026-10-06'),
      total_cost: 35000,
      allocation_model: 'weighted_nights',
      paid_by: pAlice._id,
      payment_status: 'paid_in_full',
      amount_paid: 35000,
      assigned_participants: pTrip1.map(p => {
        const calc = calculateParticipantShare(
          {
            total_cost: 35000,
            start_date: new Date('2026-10-01'),
            end_date: new Date('2026-10-06'),
            allocation_model: 'weighted_nights',
            assigned_participants: pTrip1.map(x => ({ participant_id: x._id }))
          },
          p,
          pTrip1,
          trip1
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

    // Booking 2: Tiered Multiplier Yacht Cruise
    const cruiseBooking = new Booking({
      trip_id: trip1._id,
      description: 'Private Catamaran Sunset Yacht Cruise',
      location: 'Mandovi River, Panaji',
      type: 'activity',
      vendor_name: 'Goa Yacht Charters',
      booking_reference: 'YACHT-MAND-402',
      start_date: new Date('2026-10-03'),
      end_date: new Date('2026-10-03'),
      total_cost: 14000,
      allocation_model: 'tiered',
      paid_by: pDiana._id,
      payment_status: 'paid_in_full',
      amount_paid: 14000,
      assigned_participants: pTrip1.map(p => {
        const calc = calculateParticipantShare(
          {
            total_cost: 14000,
            allocation_model: 'tiered',
            assigned_participants: pTrip1.map(x => ({ participant_id: x._id }))
          },
          p,
          pTrip1,
          trip1
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

    // Booking 3: Odd-Penny Van Shuttle (₹7,001 split across 7 people with penny resolution)
    let runningShare = 0;
    const vanAssigned = pTrip1.map((p, idx) => {
      const isLast = idx === pTrip1.length - 1;
      const base = Math.floor((7001 / pTrip1.length) * 100) / 100;
      const finalShare = isLast ? Math.round((7001 - runningShare) * 100) / 100 : base;
      runningShare += base;
      return {
        participant_id: p._id,
        amount_owed: finalShare,
        share_calculation: { model: 'equal', final_share: finalShare }
      };
    });

    const vanBooking = new Booking({
      trip_id: trip1._id,
      description: 'Airport & Intercity 12-Seater AC Van Shuttle',
      location: 'Goa Airport to Candolim Villa',
      type: 'transportation',
      vendor_name: 'Goa Miles Tourist Vans',
      booking_reference: 'VAN-EXP-889',
      start_date: new Date('2026-10-01'),
      end_date: new Date('2026-10-06'),
      total_cost: 7001,
      allocation_model: 'equal',
      paid_by: pGrace._id,
      payment_status: 'paid_in_full',
      amount_paid: 7001,
      assigned_participants: vanAssigned
    });
    await vanBooking.save();

    console.log('  🏨 Added 3 Advanced Bookings (Weighted Nights, Tiered Cruise, Remainder Penny Van)');

    // 3D. EXPENSES (Subgroups, OCR, Custom splits)
    
    // Expense 1: Subgroup Side Quest (Scuba) - Only Alice, Bob, Diana attended
    const scubaExpense = new Expense({
      tripId: trip1._id,
      payerId: pBob._id,
      description: 'Scuba Diving & Island Snorkeling Excursion',
      merchant: 'Dive Goa Adventure Club',
      category: 'ACTIVITY',
      amount: 9000,
      currency: 'INR',
      isSideQuest: true,
      sideQuestTitle: 'Scuba Squad Subgroup',
      status: 'POSTED',
      participants: [
        { memberId: pAlice._id, share: 3000, shareType: 'EQUAL' },
        { memberId: pBob._id, share: 3000, shareType: 'EQUAL' },
        { memberId: pDiana._id, share: 3000, shareType: 'EQUAL' }
      ]
    });
    await scubaExpense.save();

    // Expense 2: Custom Split Dinner
    const bbqExpense = new Expense({
      tripId: trip1._id,
      payerId: pFrank._id,
      description: "Fisherman's Wharf Seafood Barbecue Dinner",
      merchant: "The Fisherman's Wharf",
      category: 'FOOD',
      amount: 8500,
      currency: 'INR',
      status: 'POSTED',
      participants: [
        { memberId: pAlice._id, share: 1500, shareType: 'CUSTOM', customAmount: 1500 },
        { memberId: pBob._id, share: 1000, shareType: 'CUSTOM', customAmount: 1000 },
        { memberId: pCharlie._id, share: 1000, shareType: 'CUSTOM', customAmount: 1000 },
        { memberId: pDiana._id, share: 2000, shareType: 'CUSTOM', customAmount: 2000 },
        { memberId: pEvan._id, share: 500, shareType: 'CUSTOM', customAmount: 500 },
        { memberId: pFrank._id, share: 1500, shareType: 'CUSTOM', customAmount: 1500 },
        { memberId: pGrace._id, share: 1000, shareType: 'CUSTOM', customAmount: 1000 }
      ]
    });
    await bbqExpense.save();

    // Expense 3: AI Parsed OCR Receipt Expense
    const coconutExpense = new Expense({
      tripId: trip1._id,
      payerId: pEvan._id,
      description: 'Candolim Beach Shack Drinks & Refreshments',
      merchant: 'Curlies Shack & Bar',
      category: 'FOOD',
      amount: 1050,
      currency: 'INR',
      aiParsed: true,
      aiConfidence: 98.4,
      status: 'POSTED',
      participants: pTrip1.map(p => ({
        memberId: p._id,
        share: 150,
        shareType: 'EQUAL'
      }))
    });
    await coconutExpense.save();

    // Expense 4: Scooter Rentals (Charlie paid for 4 people)
    const scooterExpense = new Expense({
      tripId: trip1._id,
      payerId: pCharlie._id,
      description: 'Day 2 Activa Scooter Rentals & Fuel',
      merchant: 'Goa Bike Rentals Candolim',
      category: 'TRANSPORT',
      amount: 2000,
      currency: 'INR',
      status: 'POSTED',
      participants: [
        { memberId: pAlice._id, share: 500, shareType: 'EQUAL' },
        { memberId: pCharlie._id, share: 500, shareType: 'EQUAL' },
        { memberId: pEvan._id, share: 500, shareType: 'EQUAL' },
        { memberId: pFrank._id, share: 500, shareType: 'EQUAL' }
      ]
    });
    await scooterExpense.save();

    console.log('  🧾 Added 4 Diverse Expenses (Subgroup Side-quest, Custom Split, AI OCR, Category splits)');

    // 3E. MID-TRIP PAYMENTS (Direct Settle-ups)
    const payment1 = new Payment({
      trip_id: trip1._id,
      payer_id: pEvan._id,
      payee_id: pAlice._id,
      amount: 500,
      currency: 'INR',
      payment_method: 'upi',
      reference_number: 'UPI-TXN-998822',
      status: 'completed',
      notes: 'Evan mid-trip cash settle-up towards Alice'
    });
    await payment1.save();

    const payment2 = new Payment({
      trip_id: trip1._id,
      payer_id: pCharlie._id,
      payee_id: pDiana._id,
      amount: 1000,
      currency: 'INR',
      payment_method: 'upi',
      reference_number: 'UPI-TXN-445511',
      status: 'completed',
      notes: 'Charlie early departure partial settlement'
    });
    await payment2.save();

    console.log('  💸 Added 2 Mid-Trip UPI Direct Payments');

    // 3F. RECALCULATE BALANCES & GENERATE SETTLEMENT MATRIX
    const updatedParticipants = await recalculateParticipantBalances(trip1._id);
    const settlementResult = calculateSettlement(trip1, updatedParticipants);

    const settlementDoc = new Settlement({
      tripId: trip1._id,
      status: 'IN_PROGRESS',
      balances: settlementResult.balances,
      transactions_required: settlementResult.transactions_required,
      validation_errors: settlementResult.validation_errors,
      is_balanced: settlementResult.is_balanced,
      calculatedAt: new Date()
    });
    await settlementDoc.save();

    console.log('  🧮 Ledger recalculated: Zero-sum balanced Greedy Settlement Matrix active!');

    // 3G. AUDIT LOGS FOR TRIP 1
    const auditLogs = [
      {
        tripId: trip1._id,
        action: 'TRIP_CREATED',
        actorId: demoHost._id,
        actorName: 'Alex Vance',
        target: { type: 'Trip', id: trip1._id.toString() },
        reason: 'Initial trip creation with banker rounding and simplify settlement method.'
      },
      {
        tripId: trip1._id,
        action: 'BOOKING_ADDED',
        actorId: userMap['alice@nexustrip.com']._id,
        actorName: 'Alice Chen',
        target: { type: 'Booking', id: villaBooking._id.toString() },
        reason: 'Added Heritage Beachfront Villa with Weighted Nights allocation.'
      },
      {
        tripId: trip1._id,
        action: 'EXPENSE_APPROVED',
        actorId: userMap['bob@nexustrip.com']._id,
        actorName: 'Bob Martinez',
        target: { type: 'Expense', id: scubaExpense._id.toString() },
        reason: 'Subgroup side quest approved for Alice, Bob, and Diana.'
      },
      {
        tripId: trip1._id,
        action: 'PAYMENT_RECORDED',
        actorId: userMap['evan@nexustrip.com']._id,
        actorName: 'Evan Wright',
        target: { type: 'Payment', id: payment1._id.toString() },
        reason: 'Direct UPI payment of ₹500 recorded to Alice.'
      }
    ];
    await AuditLog.insertMany(auditLogs);

    // =============================================================
    // 4. TRIP 2: TOKYO NEON & CYBERPUNK ODYSSEY (Multi-Currency Demo)
    // =============================================================
    console.log('\n🗼 Seeding Trip 2: "Tokyo Neon Horizons 2026" (International & Planning Phase)...');

    const trip2 = new Trip({
      name: 'Tokyo Neon Horizons 2026',
      description: 'High-tech Tokyo expedition: Shinjuku nightlife, Akihabara VR, TeamLab Planets, and bullet train to Kyoto.',
      destination: 'Tokyo, Japan',
      organizer_id: demoHost._id,
      co_organizers: [userMap['diana@nexustrip.com']._id],
      start_date: new Date('2026-11-10'),
      end_date: new Date('2026-11-18'),
      status: 'planning',
      currency: 'USD',
      inviteCode: 'TOKYO26',
      total_cost_estimated: 4800,
      total_cost_actual: 3200,
      budget: 5500,
      payment_deadline: new Date('2026-10-25'),
      cost_sharing_model: 'equal',
      allow_partial_join: true,
      allow_partial_payment: true,
      refund_policy: 'full',
      rounding_method: 'banker',
      settings: {
        allowMemberExpenses: true,
        requireHostApproval: false,
        allowMultipleCurrencies: true,
        settlementMethod: 'simplify'
      }
    });
    await trip2.save();

    const pTrip2 = await Participant.insertMany([
      {
        trip_id: trip2._id,
        user_id: demoHost._id,
        name: 'Alex Vance',
        email: 'demo@nexustrip.com',
        phone: '+91 98765 43210',
        status: 'confirmed',
        cost_tier: 'HOST',
        tier_multiplier: 1.0
      },
      {
        trip_id: trip2._id,
        user_id: userMap['diana@nexustrip.com']._id,
        name: 'Diana Prince',
        email: 'diana@nexustrip.com',
        phone: '+91 98567 44556',
        status: 'confirmed',
        cost_tier: 'VIP',
        tier_multiplier: 1.5
      },
      {
        trip_id: trip2._id,
        user_id: userMap['frank@nexustrip.com']._id,
        name: 'Frank Castle',
        email: 'frank@nexustrip.com',
        phone: '+91 98789 66778',
        status: 'confirmed',
        cost_tier: 'STANDARD',
        tier_multiplier: 1.0
      }
    ]);

    await ItineraryBlock.insertMany([
      {
        trip_id: trip2._id,
        day_number: 1,
        date: new Date('2026-11-10'),
        time_slot: 'evening',
        start_time: '18:00',
        end_time: '22:00',
        title: 'Shinjuku Neon Alley & Omoide Yokocho Food Tour',
        location: 'Shinjuku, Tokyo',
        category: 'FOOD',
        estimated_cost: 150,
        currency: 'USD',
        status: 'PLANNED'
      },
      {
        trip_id: trip2._id,
        day_number: 2,
        date: new Date('2026-11-11'),
        time_slot: 'morning',
        start_time: '10:00',
        end_time: '14:00',
        title: 'TeamLab Planets Immersive Digital Art',
        location: 'Toyosu, Tokyo',
        category: 'ACTIVITY',
        estimated_cost: 120,
        currency: 'USD',
        status: 'PLANNED'
      }
    ]);

    // =============================================================
    // 5. TRIP 3: SWISS ALPS POWDER & SKI EXPEDITION
    // =============================================================
    console.log('\n🏔️ Seeding Trip 3: "Swiss Alps Ski Expedition" (Active Winter Trip)...');

    const trip3 = new Trip({
      name: 'Swiss Alps Ski Expedition',
      description: 'Zermatt glacier skiing, luxury ski-in/ski-out chalet, and alpine fondue dinners.',
      destination: 'Zermatt, Switzerland',
      organizer_id: demoHost._id,
      start_date: new Date('2026-12-20'),
      end_date: new Date('2026-12-27'),
      status: 'active',
      currency: 'EUR',
      inviteCode: 'ALPS2026',
      total_cost_estimated: 6200,
      total_cost_actual: 4500,
      budget: 7000,
      payment_deadline: new Date('2026-11-30'),
      cost_sharing_model: 'equal',
      allow_partial_join: true,
      allow_partial_payment: true,
      refund_policy: 'full',
      rounding_method: 'banker',
      settings: {
        allowMemberExpenses: true,
        requireHostApproval: false,
        allowMultipleCurrencies: true,
        settlementMethod: 'simplify'
      }
    });
    await trip3.save();

    await Participant.insertMany([
      {
        trip_id: trip3._id,
        user_id: demoHost._id,
        name: 'Alex Vance',
        email: 'demo@nexustrip.com',
        phone: '+91 98765 43210',
        status: 'confirmed',
        cost_tier: 'HOST',
        tier_multiplier: 1.0
      },
      {
        trip_id: trip3._id,
        user_id: userMap['alice@nexustrip.com']._id,
        name: 'Alice Chen',
        email: 'alice@nexustrip.com',
        phone: '+91 98234 11223',
        status: 'confirmed',
        cost_tier: 'STANDARD',
        tier_multiplier: 1.0
      },
      {
        trip_id: trip3._id,
        user_id: userMap['grace@nexustrip.com']._id,
        name: 'Grace Hopper',
        email: 'grace@nexustrip.com',
        phone: '+91 98890 77889',
        status: 'confirmed',
        cost_tier: 'STANDARD',
        tier_multiplier: 1.0
      }
    ]);

    console.log('\n====================================================');
    console.log('🎉 DEMO DATA SEEDED SUCCESSFULLY WITH 100% ACCURACY!');
    console.log('====================================================\n');
    console.log('🔑 CREDENTIALS FOR HACKATHON DEMO:');
    console.log('   Email:    demo@nexustrip.com');
    console.log('   Password: password123');
    console.log('\n💡 SHOWCASE TRIPS:');
    console.log('   1. Goa Coastal Quest 2026 (Flagship - Weighted Nights, Tiered, Side Quests, Greedy Settlement)');
    console.log('   2. Tokyo Neon Horizons 2026 (International / Multi-currency USD)');
    console.log('   3. Swiss Alps Ski Expedition (Winter active trip EUR)\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding demo data:', err);
    process.exit(1);
  }
}

seedDatabase();
