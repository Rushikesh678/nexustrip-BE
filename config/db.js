const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tripledger');
    console.log(`[MongoDB Connected]: ${conn.connection.host}`);
  } catch (error) {
    console.warn(`[MongoDB Warning]: ${error.message}. Running server with memory-fallback/offline mode if MongoDB server is unavailable.`);
  }
};

module.exports = connectDB;
