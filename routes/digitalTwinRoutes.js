const express = require('express');
const router = express.Router({ mergeParams: true });
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const auth = require('../middleware/auth');
const { getLiveWeather } = require('../services/weatherService');
const { getSocialSignals } = require('../services/socialService');
const { getDigitalTwinImpact, simulateWhatIf } = require('../services/digitalTwinService');

/**
 * GET /api/v1/trips/:tripId/digital-twin/weather
 * Returns live weather + 5-day forecast + meteorological alerts for the trip destination
 */
router.get('/weather', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const forceRefresh = req.query.refresh === 'true';
    const locationQuery = req.query.location;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    let targetLocation = locationQuery ? locationQuery.trim() : (trip.destination || '');
    if (!targetLocation) {
      const firstBooking = await Booking.findOne({ trip_id: tripId, location: { $exists: true, $ne: '' } });
      targetLocation = firstBooking ? firstBooking.location : 'Mumbai';
    }

    const weatherData = await getLiveWeather(targetLocation, forceRefresh);

    res.json({
      success: true,
      tripId,
      tripDestination: trip.destination || targetLocation,
      data: weatherData
    });
  } catch (err) {
    console.error('[DigitalTwinRoutes:Weather Error]:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve live weather data.' });
  }
});

/**
 * GET /api/v1/trips/:tripId/digital-twin/social
 * Returns Reddit public social signals, traveler sentiment scoring, and emerging conditions
 */
router.get('/social', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const locationQuery = req.query.location;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const targetLocation = locationQuery ? locationQuery.trim() : (trip.destination || 'Mumbai');
    const socialData = await getSocialSignals(targetLocation);

    res.json({
      success: true,
      tripId,
      tripDestination: targetLocation,
      data: socialData
    });
  } catch (err) {
    console.error('[DigitalTwinRoutes:Social Error]:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve social signals.' });
  }
});

/**
 * GET /api/v1/trips/:tripId/digital-twin/impact
 * Returns current AI Digital Twin state, risk scores, propagation chains, and affected bookings
 */
router.get('/impact', auth, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const twinState = await getDigitalTwinImpact(tripId);

    res.json({
      success: true,
      tripId,
      data: twinState
    });
  } catch (err) {
    console.error('[DigitalTwinRoutes:Impact Error]:', err);
    res.status(500).json({ success: false, message: 'Failed to compute digital twin impact.' });
  }
});

/**
 * POST /api/v1/trips/:tripId/digital-twin/simulate
 * Simulates what-if weather parameter variations and returns updated digital twin predictions
 */
router.post('/simulate', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const { scenario } = req.body || {};

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const scenarioParams = {
      rainfallMm: Number(scenario?.rainfallMm ?? 0),
      tempDeltaCelsius: Number(scenario?.tempDeltaCelsius ?? 0),
      stormDurationHours: Number(scenario?.stormDurationHours ?? 0),
      windKph: Number(scenario?.windKph ?? 0),
      floodRisk: Boolean(scenario?.floodRisk),
      extremeHeat: Boolean(scenario?.extremeHeat),
      location: scenario?.location || trip.destination || ''
    };

    const simulatedState = await simulateWhatIf(tripId, scenarioParams);

    res.json({
      success: true,
      tripId,
      isSimulation: true,
      scenario: scenarioParams,
      data: simulatedState
    });
  } catch (err) {
    console.error('[DigitalTwinRoutes:Simulate Error]:', err);
    res.status(500).json({ success: false, message: 'Failed to execute digital twin simulation.' });
  }
});

module.exports = router;
