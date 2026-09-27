const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./config/db');

// Load environment variables
dotenv.config();

// Connect Database
connectDB();

const app = express();

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Serve static assets/uploads if applicable
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/v1/auth', require('./routes/authRoutes'));
app.use('/api/v1/trips', require('./routes/tripRoutes'));
app.use('/api/v1/trips/:tripId/participants', require('./routes/participantRoutes'));
app.use('/api/v1/trips/:tripId/bookings', require('./routes/bookingRoutes'));
app.use('/api/v1/trips/:tripId/itinerary', require('./routes/itineraryRoutes'));
app.use('/api/v1/trips/:tripId/expenses', require('./routes/expenseRoutes'));
app.use('/api/v1/receipts', require('./routes/expenseRoutes')); // receipt parse route
app.use('/api/v1/trips/:tripId/payments', require('./routes/paymentRoutes'));
app.use('/api/v1/trips/:tripId/refunds', require('./routes/refundRoutes'));
app.use('/api/v1/trips/:tripId/settlement', require('./routes/settlementRoutes'));
app.use('/api/v1/trips/:tripId/ledger', require('./routes/ledgerRoutes'));
app.use('/api/v1/trips/:tripId/audit', require('./routes/auditRoutes'));
app.use('/api/v1/trips/:tripId/report', require('./routes/reportRoutes'));
app.use('/api/v1/trips/:tripId/recommendations', require('./routes/recommendationRoutes'));
app.use('/api/v1/trips/:tripId/digital-twin', require('./routes/digitalTwinRoutes'));

// Root Health Check Route
app.get('/', (req, res) => {
  res.json({
    app: 'TripLedger API',
    status: 'Running',
    version: '1.0.0',
    timestamp: new Date()
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API Server Error]:', err.stack || err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[TripLedger Server]: Running on port ${PORT}`);
});
