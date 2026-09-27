const mongoose = require('mongoose');

const WeatherCacheSchema = new mongoose.Schema({
  location: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true
  },
  coordinates: {
    lat: { type: Number, default: 0 },
    lon: { type: Number, default: 0 }
  },
  weatherData: {
    current: {
      temp: Number,
      feels_like: Number,
      temp_min: Number,
      temp_max: Number,
      humidity: Number,
      pressure: Number,
      wind_speed: Number,
      wind_deg: Number,
      wind_gust: Number,
      condition: String,
      description: String,
      icon: String,
      clouds: Number,
      visibility: Number,
      rainfall_1h: Number,
      rainfall_3h: Number,
      uv_index: Number,
      air_quality_index: Number
    },
    forecast: [
      {
        dt: Number,
        date: String,
        temp_day: Number,
        temp_night: Number,
        temp_min: Number,
        temp_max: Number,
        condition: String,
        description: String,
        icon: String,
        pop: Number, // Probability of precipitation (0 - 1)
        rain_mm: Number,
        wind_speed: Number,
        humidity: Number
      }
    ],
    alerts: [
      {
        sender: String,
        event: String,
        start: Date,
        end: Date,
        description: String,
        severity: String // minor, moderate, severe, extreme
      }
    ],
    source: { type: String, default: 'OpenWeatherMap' },
    fetchedAt: { type: Date, default: Date.now }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 1800 // Automatically remove document after 30 minutes (1800 seconds)
  }
}, { timestamps: true });

module.exports = mongoose.model('WeatherCache', WeatherCacheSchema);
