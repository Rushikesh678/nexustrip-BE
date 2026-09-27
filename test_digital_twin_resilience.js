/**
 * Comprehensive Automated Resilience & Dataset Verification Suite
 * Tests all 4 Digital Twin endpoints across all database trips with valid and extreme edge cases.
 */

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('./models/User');
const Trip = require('./models/Trip');
const Booking = require('./models/Booking');

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🧪 NEXUSTRIP DIGITAL TWIN RESILIENCE & DATASET TEST SUITE 🧪');
  console.log('===============================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas.');

  // 1. Fetch Demo User & Create Auth Token
  const user = await User.findOne({ email: 'demo@nexustrip.com' });
  if (!user) {
    console.error('❌ Demo user not found! Please run `npm run seed` first.');
    process.exit(1);
  }
  const token = jwt.sign({ userId: user._id, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 2. Fetch all Trips from Database
  const trips = await Trip.find();
  console.log(`📋 Found ${trips.length} Trips in Database to test:\n`);
  trips.forEach((t, i) => {
    console.log(`   ${i + 1}. [${t.destination || 'No Destination'}] "${t.name}" (ID: ${t._id})`);
  });
  console.log('\n---------------------------------------------------------------');

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  async function assertEndpoint(name, url, options = {}) {
    totalTests++;
    try {
      const res = await fetch(url, { headers: authHeaders, ...options });
      const json = await res.json();

      if (res.ok && json.success) {
        console.log(`  ✅ [PASS] ${name} (HTTP ${res.status})`);
        passedTests++;
        return json;
      } else {
        console.error(`  ❌ [FAIL] ${name} (HTTP ${res.status}):`, json.message || json);
        failedTests++;
        return null;
      }
    } catch (err) {
      console.error(`  ❌ [ERROR] ${name}:`, err.message);
      failedTests++;
      return null;
    }
  }

  // 3. Test Every Trip in Database with all 4 Endpoints
  for (const trip of trips) {
    console.log(`\n🔍 TESTING TRIP: "${trip.name}" (${trip.destination || 'Default'})`);

    const bookingsCount = await Booking.countDocuments({ trip_id: trip._id });
    console.log(`   Associated Active Bookings: ${bookingsCount}`);

    // Endpoint 1: Weather
    const weatherRes = await assertEndpoint(
      `GET /digital-twin/weather (${trip.destination})`,
      `http://localhost:5000/api/v1/trips/${trip._id}/digital-twin/weather`
    );
    if (weatherRes?.data?.weather) {
      const cur = weatherRes.data.weather.current;
      console.log(`     ↳ Live Temp: ${cur.temp}°C | Condition: ${cur.condition} | Forecast: ${weatherRes.data.weather.forecast?.length} days`);
    }

    // Endpoint 2: Social Signals
    const socialRes = await assertEndpoint(
      `GET /digital-twin/social (${trip.destination})`,
      `http://localhost:5000/api/v1/trips/${trip._id}/digital-twin/social`
    );
    if (socialRes?.data) {
      console.log(`     ↳ Sentiment: ${socialRes.data.overallSentiment} (${socialRes.data.sentimentLabel}) | Posts: ${socialRes.data.posts?.length}`);
    }

    // Endpoint 3: Impact Reasoner
    const impactRes = await assertEndpoint(
      `GET /digital-twin/impact (${trip.name})`,
      `http://localhost:5000/api/v1/trips/${trip._id}/digital-twin/impact`
    );
    if (impactRes?.data) {
      console.log(`     ↳ Overall Risk: ${impactRes.data.overallRiskScore}/100 | State: ${impactRes.data.twinState.toUpperCase()} | Monitored Nodes: ${impactRes.data.entities?.length}`);
      if (impactRes.data.propagationChain?.length > 0) {
        console.log(`     ↳ Causality Chain: ${impactRes.data.propagationChain[0]} ➔ ... (${impactRes.data.propagationChain.length} hops)`);
      }
    }

    // Endpoint 4: What-If Simulation (Normal & Extreme Scenarios)
    console.log(`   🧪 Running Counterfactual Scenario 1 (Monsoon Deluge: 350mm Rain, 12h storm)...`);
    const simRes1 = await assertEndpoint(
      `POST /digital-twin/simulate (Monsoon Deluge)`,
      `http://localhost:5000/api/v1/trips/${trip._id}/digital-twin/simulate`,
      {
        method: 'POST',
        body: JSON.stringify({
          scenario: {
            rainfallMm: 350,
            tempDeltaCelsius: -2,
            stormDurationHours: 12,
            windKph: 75,
            floodRisk: true,
            extremeHeat: false
          }
        })
      }
    );
    if (simRes1?.data) {
      console.log(`     ↳ Simulated State: ${simRes1.data.twinState.toUpperCase()} (Risk: ${simRes1.data.overallRiskScore}/100) | Est. Cost Impact: ₹${simRes1.data.totalEstimatedCostImpact || 0}`);
    }

    console.log(`   🧪 Running Counterfactual Scenario 2 (Extreme Heatwave: +10°C)...`);
    const simRes2 = await assertEndpoint(
      `POST /digital-twin/simulate (Heatwave Anomaly)`,
      `http://localhost:5000/api/v1/trips/${trip._id}/digital-twin/simulate`,
      {
        method: 'POST',
        body: JSON.stringify({
          scenario: {
            rainfallMm: 0,
            tempDeltaCelsius: 10,
            stormDurationHours: 0,
            windKph: 15,
            floodRisk: false,
            extremeHeat: true
          }
        })
      }
    );
  }

  // 4. Test Extreme Edge Cases & Malformed Inputs
  console.log('\n===============================================================');
  console.log('🛡️ TESTING EXTREME EDGE CASES & ZERO-FAILURE GUARANTEES');
  console.log('===============================================================\n');

  const firstTrip = trips[0];

  // Edge Case A: Empty Simulation Body
  console.log('Test Edge Case A: Empty Body in Simulation');
  await assertEndpoint(
    'POST /digital-twin/simulate (Empty Body {})',
    `http://localhost:5000/api/v1/trips/${firstTrip._id}/digital-twin/simulate`,
    {
      method: 'POST',
      body: JSON.stringify({})
    }
  );

  // Edge Case B: Boundary Sliders (Maximum 500mm, 72h storm, 200km/h wind)
  console.log('Test Edge Case B: Extreme Max Boundary Sliders');
  await assertEndpoint(
    'POST /digital-twin/simulate (Max Boundaries: 500mm rain, 200km/h wind, 72h)',
    `http://localhost:5000/api/v1/trips/${firstTrip._id}/digital-twin/simulate`,
    {
      method: 'POST',
      body: JSON.stringify({
        scenario: {
          rainfallMm: 500,
          tempDeltaCelsius: 20,
          stormDurationHours: 72,
          windKph: 200,
          floodRisk: true,
          extremeHeat: true
        }
      })
    }
  );

  // Edge Case C: Force Refresh Weather Query Parameter
  console.log('Test Edge Case C: Force Refresh Query');
  await assertEndpoint(
    'GET /digital-twin/weather?refresh=true',
    `http://localhost:5000/api/v1/trips/${firstTrip._id}/digital-twin/weather?refresh=true`
  );

  // Summary
  console.log('\n===============================================================');
  console.log(`📊 FINAL RESILIENCE TEST RESULTS:`);
  console.log(`   Total Tests Run: ${totalTests}`);
  console.log(`   Passed Tests:    ${passedTests} (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log(`   Failed Tests:    ${failedTests}`);
  console.log('===============================================================');

  if (failedTests === 0) {
    console.log('🎉 100% OF DIGITAL TWIN ENDPOINTS AND SCENARIOS PASSED WITH ZERO ERRORS!');
  }

  process.exit(failedTests === 0 ? 0 : 1);
}

runTestSuite().catch(e => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});
