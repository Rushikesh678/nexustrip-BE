const express = require('express');
const router = express.Router({ mergeParams: true });
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const Participant = require('../models/Participant');
const auth = require('../middleware/auth');
const { getSavingsRecommendations } = require('../services/savingsService');

// GET /api/v1/trips/:tripId/recommendations - Get AI savings recommendations for trip's booking locations
router.get('/', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const requestedLocation = req.query.location;
    const forceRefresh = req.query.refresh === 'true';

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const [bookings, participants] = await Promise.all([
      Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } }).select('location description type total_cost'),
      Participant.find({ trip_id: tripId, status: { $ne: 'removed' } }).select('_id name')
    ]);

    // Gather unique locations from bookings
    const bookingLocations = [...new Set(
      bookings
        .map(b => (b.location || '').trim())
        .filter(loc => loc.length > 0)
    )];

    // Target location priority: query override -> first booking location -> trip destination
    const targetLocation = requestedLocation
      ? requestedLocation.trim()
      : (bookingLocations[0] || (trip.destination ? trip.destination.trim() : ''));

    if (!targetLocation) {
      return res.json({
        success: true,
        hasLocation: false,
        bookingLocations: [],
        message: 'No location found yet. Create a booking with a compulsory location or set a trip destination to unlock AI Group Savings Recommendations.'
      });
    }

    const tripContext = {
      participantsCount: participants.length || 4,
      currency: trip.currency || 'INR',
      budget: trip.budget || 0,
      totalBookingCost: bookings.reduce((sum, b) => sum + (b.total_cost || 0), 0)
    };

    const recommendations = await getSavingsRecommendations(targetLocation, tripContext, forceRefresh);

    res.json({
      success: true,
      hasLocation: true,
      primaryLocation: targetLocation,
      bookingLocations,
      tripDestination: trip.destination || '',
      recommendations
    });
  } catch (err) {
    console.error('[RecommendationRoutes Error]:', err);
    res.status(500).json({ success: false, message: 'Server error generating savings recommendations.' });
  }
});

// POST /api/v1/trips/:tripId/recommendations/refresh - Force re-generation of savings recommendations
router.post('/refresh', auth, async (req, res) => {
  try {
    const { tripId } = req.params;
    const { location } = req.body;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    const [bookings, participants] = await Promise.all([
      Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } }).select('location total_cost'),
      Participant.find({ trip_id: tripId, status: { $ne: 'removed' } }).select('_id')
    ]);

    const bookingLocations = [...new Set(
      bookings
        .map(b => (b.location || '').trim())
        .filter(loc => loc.length > 0)
    )];

    const targetLocation = location
      ? location.trim()
      : (bookingLocations[0] || (trip.destination ? trip.destination.trim() : ''));

    if (!targetLocation) {
      return res.status(400).json({
        success: false,
        message: 'Cannot refresh recommendations: No location provided or found in bookings/destination.'
      });
    }

    const tripContext = {
      participantsCount: participants.length || 4,
      currency: trip.currency || 'INR',
      budget: trip.budget || 0
    };

    const recommendations = await getSavingsRecommendations(targetLocation, tripContext, true);

    res.json({
      success: true,
      hasLocation: true,
      primaryLocation: targetLocation,
      bookingLocations,
      recommendations
    });
  } catch (err) {
    console.error('[RecommendationRoutes Refresh Error]:', err);
    res.status(500).json({ success: false, message: 'Server error refreshing recommendations.' });
  }
});

module.exports = router;
