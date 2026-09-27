/**
 * AI Digital Twin Impact Engine & Cascading Effects Simulator
 * Computes probabilistic risk propagation across travel entities (hotels, transit, activities, dining)
 * under live or simulated counterfactual weather conditions.
 */

const { Groq } = require('groq-sdk');
const { getLiveWeather, getCoordinates } = require('./weatherService');
const { getSocialSignals } = require('./socialService');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const Participant = require('../models/Participant');

/**
 * Clean LLM response string to extract pure JSON
 */
function extractJsonFromText(rawText) {
  if (!rawText) return null;
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
      } catch (subErr) {
        console.warn('[DigitalTwinService] JSON substring parse failed:', subErr.message);
      }
    }
  }
  return null;
}

/**
 * Normalize or synthesize trip bookings to ensure the digital twin always has
 * complete, realistic itinerary nodes mapped across coordinates.
 */
function normalizeTripBookings(trip, bookings = []) {
  const dest = trip?.destination || 'Destination';

  if (bookings && bookings.length > 0) {
    return bookings.map((b, idx) => ({
      _id: b._id ? b._id.toString() : `node_${idx}`,
      description: b.description || b.vendor_name || `Itinerary Booking #${idx + 1}`,
      type: b.type || 'activity',
      location: b.location || dest,
      total_cost: b.total_cost || (b.type === 'accommodation' ? 12000 : b.type === 'transportation' ? 4500 : 2500),
      isSynthetic: false
    }));
  }

  // If 0 bookings exist, synthesize destination-specific core itinerary nodes
  return [
    {
      _id: 'syn_trans_1',
      description: `${dest} Airport & Harbor Express Transfer`,
      type: 'transportation',
      location: `${dest} Transit Terminal`,
      total_cost: 4800,
      isSynthetic: true
    },
    {
      _id: 'syn_hotel_1',
      description: `${dest} Beachfront Resort & Villa Stay`,
      type: 'accommodation',
      location: `${dest} Central Bay`,
      total_cost: 16500,
      isSynthetic: true
    },
    {
      _id: 'syn_act_1',
      description: `${dest} Coastal Excursion & Island Tour`,
      type: 'activity',
      location: `${dest} Marine Sanctuary`,
      total_cost: 5400,
      isSynthetic: true
    },
    {
      _id: 'syn_meal_1',
      description: `${dest} Sunset Grill & Heritage Dining`,
      type: 'meal',
      location: `${dest} Promenade`,
      total_cost: 3200,
      isSynthetic: true
    },
    {
      _id: 'syn_trans_2',
      description: `${dest} Local Inter-Zone Shuttle & Van`,
      type: 'transportation',
      location: `${dest} North Corridor`,
      total_cost: 2100,
      isSynthetic: true
    }
  ];
}

/**
 * Generate realistic geographic coordinate offsets around destination center
 */
function getOffsetCoordinates(centerCoords, index, total = 5) {
  const lat = centerCoords?.lat || 19.0760;
  const lon = centerCoords?.lon || 72.8777;

  // Angles distributed evenly (0, 72, 144, 216, 288 deg)
  const angle = (index * (360 / total) + 25) * (Math.PI / 180);
  const distance = 0.012 + (index % 3) * 0.008; // ~1.3km to 2.8km offset

  return {
    lat: lat + Math.sin(angle) * distance,
    lon: lon + Math.cos(angle) * (distance * 1.15)
  };
}

/**
 * Deterministic Physics & Cascading Graph Engine (Reliable Heuristic Simulator)
 */
function computeDeterministicImpact(trip, rawBookings, participants, weatherSnapshot, scenarioParams = null, socialSignals = null, centerCoords = null) {
  const isSimulation = !!scenarioParams;
  const rain = scenarioParams ? Number(scenarioParams.rainfallMm || 0) : Number(weatherSnapshot?.rainfall_1h || weatherSnapshot?.rainfallMm || 0);
  const wind = scenarioParams ? Number(scenarioParams.windKph || 0) : Number(weatherSnapshot?.wind_speed || 0);
  const tempDelta = scenarioParams ? Number(scenarioParams.tempDeltaCelsius || 0) : 0;
  const stormDuration = scenarioParams ? Number(scenarioParams.stormDurationHours || 0) : (rain > 20 ? 6 : 0);
  const isFlooded = scenarioParams ? (scenarioParams.floodRisk === true || rain > 120) : (rain > 40);
  const isExtremeHeat = scenarioParams ? (scenarioParams.extremeHeat === true || ((weatherSnapshot?.temp || 28) + tempDelta > 40)) : false;

  const totalParticipants = participants?.length || 4;
  const bookings = normalizeTripBookings(trip, rawBookings);

  let maxRisk = 12;
  let riskSum = 0;

  const entities = bookings.map((b, index) => {
    const bType = (b.type || 'other').toLowerCase();
    const bName = b.description || `Booking #${index + 1}`;
    const bCost = b.total_cost || 3000;
    const bLocation = b.location || trip.destination || 'Destination';

    let riskScore = 15;
    let riskLevel = 'low';
    let directEffect = 'Standard operating conditions expected; schedule normal.';
    const cascadingEffects = [];
    let recommendedAction = 'Maintain planned schedule; monitor local forecasts.';
    let prob = 0.12;
    let confLow = 0.08;
    let confHigh = 0.22;
    let costImpact = 0;

    // 1. Transportation
    if (bType === 'transportation') {
      if (isFlooded || rain > 150 || wind > 100) {
        riskScore = 96;
        riskLevel = 'critical';
        directEffect = `Critical corridor waterlogging (>45cm) & high wind squall (${wind}km/h). Airport/jetty access halted.`;
        cascadingEffects.push('Flight departures delayed 3–5 hours or diverted to secondary hubs.');
        cascadingEffects.push('Airport taxi & boat transfer surcharges surge +250% on open routes.');
        cascadingEffects.push('Delayed arrival breaks hotel check-in buffer and cancels scheduled evening tour.');
        recommendedAction = 'Pre-book express rail/ferry backup or claim bad-weather airline rebooking waiver.';
        prob = 0.95;
        confLow = 0.89;
        confHigh = 0.99;
        costImpact = Math.round(bCost * 0.45 + 3500);
      } else if (rain > 50 || wind > 45 || stormDuration > 8) {
        riskScore = 74;
        riskLevel = 'high';
        directEffect = `Heavy precipitation (${rain}mm) and gusty winds causing 45–75 min surface transit delays.`;
        cascadingEffects.push('Connecting transfer schedule compressed by 1.5 hours.');
        cascadingEffects.push('Increased risk of tarmac baggage loading hold-ups.');
        recommendedAction = 'Depart for departure terminal 90 minutes earlier than normal buffer.';
        prob = 0.78;
        confLow = 0.70;
        confHigh = 0.86;
        costImpact = Math.round(bCost * 0.25 + 1200);
      } else if (rain > 15 || wind > 25) {
        riskScore = 48;
        riskLevel = 'medium';
        directEffect = 'Moderate rainfall with wet road conditions and mild traffic slowdown.';
        cascadingEffects.push('Surface transit buffer extended by ~20 minutes.');
        recommendedAction = 'Keep digital boarding passes ready and monitor airline/ferry status.';
        prob = 0.45;
        confLow = 0.35;
        confHigh = 0.55;
        costImpact = 500;
      }
    }
    // 2. Activities & Excursions
    else if (bType === 'activity') {
      const isWaterOrOutdoor = !bName.toLowerCase().includes('indoor') && !bName.toLowerCase().includes('museum');
      if (isFlooded || rain > 100 || wind > 60) {
        riskScore = 92;
        riskLevel = 'critical';
        directEffect = 'Hazardous outdoor conditions; marine/adventure activity suspended by local coast guard.';
        cascadingEffects.push('Operator issuing mandatory weather cancellation notice.');
        cascadingEffects.push('Crew itinerary left with empty 4-hour slot; requires indoor backup venue.');
        cascadingEffects.push('Triggers 100% group ticket refund & payment ledger adjustment.');
        recommendedAction = 'Initiate instant full refund dispute and shift crew to sheltered cultural gallery.';
        prob = 0.96;
        confLow = 0.91;
        confHigh = 0.99;
        costImpact = bCost;
      } else if (rain > 35 || wind > 35 || isExtremeHeat) {
        riskScore = 70;
        riskLevel = 'high';
        directEffect = isExtremeHeat ? 'Dangerous heat index (>42°C); outdoor physical excursion poses heat stroke risk.' : 'Slippery trails & rough sea swells degrade activity safety.';
        cascadingEffects.push('Viewpoint photography & snorkeling visibility degraded by 80%.');
        cascadingEffects.push('Participants likely to request early departure or partial reschedule.');
        recommendedAction = 'Reschedule to early morning slot or indoor interactive exhibition.';
        prob = 0.72;
        confLow = 0.62;
        confHigh = 0.82;
        costImpact = Math.round(bCost * 0.5);
      } else if (rain > 10) {
        riskScore = 42;
        riskLevel = 'medium';
        directEffect = 'Passing showers; outdoor paths moderately wet.';
        cascadingEffects.push('Waterproof rain ponchos/gear required for comfort.');
        recommendedAction = 'Carry waterproof jackets and verify operator departures.';
        prob = 0.40;
        confLow = 0.30;
        confHigh = 0.50;
        costImpact = 0;
      }
    }
    // 3. Accommodation
    else if (bType === 'accommodation') {
      if (isFlooded || rain > 180) {
        riskScore = 84;
        riskLevel = 'high';
        directEffect = 'Property access road submerged; exterior beach/pool facilities closed.';
        cascadingEffects.push('Guests unable to check in on time due to localized waterlogging.');
        cascadingEffects.push('Hotel kitchen operating on limited emergency power generator.');
        recommendedAction = 'Contact concierge to secure high-clearance shuttle transfer and room readiness.';
        prob = 0.86;
        confLow = 0.76;
        confHigh = 0.93;
        costImpact = 2500;
      } else if (rain > 60 || wind > 50) {
        riskScore = 54;
        riskLevel = 'medium';
        directEffect = 'Balcony areas restricted due to squall wind gusts.';
        cascadingEffects.push('High occupancy demand for indoor common areas and room service.');
        recommendedAction = 'Confirm early check-in guarantee to avoid waiting in crowded lobby.';
        prob = 0.52;
        confLow = 0.42;
        confHigh = 0.64;
        costImpact = 800;
      }
    }
    // 4. Meals & Dining
    else if (bType === 'meal') {
      if (isFlooded || rain > 120) {
        riskScore = 80;
        riskLevel = 'high';
        directEffect = 'Venue delivery bottlenecks and outdoor terrace closure.';
        cascadingEffects.push('Delayed travel party risks forfeiting table reservation deposit.');
        cascadingEffects.push('Alternative dining spots within walking distance inaccessible.');
        recommendedAction = 'Call venue to postpone reservation by 2 hours or switch to resort dining.';
        prob = 0.82;
        confLow = 0.72;
        confHigh = 0.90;
        costImpact = Math.round(bCost * 0.35);
      } else if (rain > 40) {
        riskScore = 46;
        riskLevel = 'medium';
        directEffect = 'Patio seating moved indoors; dining room capacity constrained.';
        cascadingEffects.push('Expected 20-min wait time despite advance table reservation.');
        recommendedAction = 'Reconfirm indoor seating preference with restaurant manager.';
        prob = 0.44;
        confLow = 0.34;
        confHigh = 0.56;
        costImpact = 0;
      }
    }
    // 5. General Nodes
    else {
      if (isFlooded || rain > 100) {
        riskScore = 66;
        riskLevel = 'high';
        directEffect = 'General logistics and venue access impaired by storm conditions.';
        cascadingEffects.push('Participant arrival times desynchronized.');
        recommendedAction = 'Review cancellation terms and maintain backup indoor agenda.';
        prob = 0.65;
        confLow = 0.55;
        confHigh = 0.75;
        costImpact = 1000;
      }
    }

    riskSum += riskScore;
    if (riskScore > maxRisk) maxRisk = riskScore;

    // Attach distinct offset coordinates so all pins display on Leaflet map
    const coords = getOffsetCoordinates(centerCoords, index, bookings.length);

    return {
      bookingId: b._id,
      bookingName: bName,
      type: bType,
      location: bLocation,
      coordinates: coords,
      riskLevel,
      riskScore,
      directEffect,
      cascadingEffects: cascadingEffects.length > 0 ? cascadingEffects : ['Minor schedule adjustments only.'],
      recommendedAction,
      probabilityOfImpact: prob,
      confidenceInterval: [confLow, confHigh],
      affectedParticipants: Math.min(totalParticipants, Math.max(1, Math.round(totalParticipants * prob))),
      estimatedCostImpact: costImpact,
      isSynthetic: !!b.isSynthetic
    };
  });

  // Overall Risk Computation
  const avgRisk = entities.length > 0 ? Math.round(riskSum / entities.length) : 20;
  const overallRiskScore = Math.min(100, Math.round((maxRisk * 0.65) + (avgRisk * 0.35)));
  const twinState = overallRiskScore > 70 ? 'critical' : overallRiskScore > 38 ? 'degraded' : 'normal';

  // Sequential Propagation Chain
  const propagationChain = [];
  if (rain > 100 || isFlooded || wind > 80) {
    propagationChain.push(`Atmospheric Influx: Heavy Rainfall (${rain}mm) & Wind Peak (${wind}km/h) for ${stormDuration}h`);
    propagationChain.push('Hydro-Dynamic Trigger: Surface Runoff & Arterial Inundation (>40cm waterlogging)');
    propagationChain.push('Primary Bottleneck: Airport & Harbor Ferry Hub Paralysis (Delays ~2–4h)');
    propagationChain.push('Secondary Cascade: Delayed Group Check-in & Outdoor Excursion Suspension');
    propagationChain.push(`Tertiary Financial Ripple: Emergency Cab Surges + ₹${entities.reduce((s, e) => s + e.estimatedCostImpact, 0).toLocaleString()} in Refund Claims`);
  } else if (rain > 35 || wind > 35) {
    propagationChain.push(`Weather Event: Moderate Showers (${rain}mm) & Gusts (${wind}km/h)`);
    propagationChain.push('Direct Impact: Traffic Deceleration & Wet Tarmac Conditions');
    propagationChain.push('Cascading Effect: Outdoor Activities Rescheduled & Added Transit Buffers');
    propagationChain.push('Actionable Resolution: Automatic Itinerary Recalibration via Digital Twin');
  } else {
    propagationChain.push('Atmospheric Status: Mild / Favorable Weather Conditions');
    propagationChain.push('System Dynamics: All itinerary nodes operating at nominal capacity');
    propagationChain.push('Recommendation: Normal travel flow maintained without intervention');
  }

  const narrativeSummary = isSimulation
    ? `**Counterfactual What-If Simulation (${rain}mm Rain, Wind ${wind}km/h, Duration ${stormDuration}h):** System state shifted to **${twinState.toUpperCase()}** (Risk Index: ${overallRiskScore}/100). The simulated atmospheric shock directly impacts transit links and outdoor activities, resulting in an estimated ₹${entities.reduce((s, e) => s + e.estimatedCostImpact, 0).toLocaleString()} in cascading delay surcharges and refund liabilities.`
    : `**Live Digital Twin Diagnostics:** Current weather in ${trip.destination || 'trip area'} indicates **${twinState.toUpperCase()}** operational posture (Risk Index: ${overallRiskScore}/100). ${entities.filter(e => e.riskLevel === 'high' || e.riskLevel === 'critical').length} nodes have active risk flags with an uncertainty band of [${Math.min(...entities.map(e => e.confidenceInterval[0])) * 100}%, ${Math.max(...entities.map(e => e.confidenceInterval[1])) * 100}%].`;

  return {
    overallRiskScore,
    twinState,
    weatherSnapshot: {
      temp: (weatherSnapshot?.temp || 28) + tempDelta,
      condition: scenarioParams ? (rain > 80 ? 'Heavy Rain' : wind > 50 ? 'Gale Storm' : 'Moderate') : (weatherSnapshot?.condition || 'Clear'),
      rainfallMm: rain,
      windKph: wind,
      stormDurationHours: stormDuration,
      floodRisk: isFlooded,
      extremeHeat: isExtremeHeat,
      alerts: weatherSnapshot?.alerts || []
    },
    entities,
    propagationChain,
    narrativeSummary,
    generatedAt: new Date().toISOString(),
    isSimulation,
    simulationParams: scenarioParams || null,
    totalEstimatedCostImpact: entities.reduce((sum, e) => sum + (e.estimatedCostImpact || 0), 0)
  };
}

/**
 * AI-Enhanced Digital Twin Reasoner using Groq / LLM
 */
async function callGroqDigitalTwin(trip, normalizedBookings, participants, weatherSnapshot, scenarioParams, socialSignals, centerCoords) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const models = ['openai/gpt-oss-120b', 'llama-3.3-70b-specdec', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b'];
  const isSim = !!scenarioParams;

  const promptPayload = {
    trip: {
      name: trip.name,
      destination: trip.destination,
      startDate: trip.start_date,
      endDate: trip.end_date,
      participantsCount: participants.length || 4
    },
    weather: scenarioParams ? {
      isSimulation: true,
      rainfall_mm: scenarioParams.rainfallMm,
      temp_delta: scenarioParams.tempDeltaCelsius,
      storm_duration_hours: scenarioParams.stormDurationHours,
      wind_kph: scenarioParams.windKph,
      flood_risk: scenarioParams.floodRisk,
      extreme_heat: scenarioParams.extremeHeat
    } : {
      isSimulation: false,
      current_temp: weatherSnapshot?.temp,
      condition: weatherSnapshot?.condition,
      rainfall_1h_mm: weatherSnapshot?.rainfall_1h || weatherSnapshot?.rainfallMm || 0,
      wind_speed_kmh: weatherSnapshot?.wind_speed || 0,
      alerts: weatherSnapshot?.alerts || []
    },
    socialSignals: socialSignals ? {
      overallSentiment: socialSignals.overallSentiment,
      emergingConditions: socialSignals.emergingConditions
    } : null,
    bookings: normalizedBookings.map(b => ({
      id: b._id,
      description: b.description,
      type: b.type,
      location: b.location,
      cost: b.total_cost
    }))
  };

  const systemPrompt = `You are the AI Digital Twin Engine for NexusTrip (TripLedger).
You simulate how weather events cascade through a travel itinerary, modeling secondary and tertiary ripple effects (e.g. rain -> road waterlog -> missed flight -> late hotel checkin fee -> cancelled tour).
You MUST return strictly a JSON object with this exact schema:
{
  "overallRiskScore": 0 to 100 (integer),
  "twinState": "normal" | "degraded" | "critical",
  "narrativeSummary": "2-3 sentences explaining the overarching cascading dynamic",
  "propagationChain": [
    "Step 1: Atmospheric event trigger",
    "Step 2: Physical infrastructure impact",
    "Step 3: Primary booking delay/failure",
    "Step 4: Cascading ripple to secondary bookings",
    "Step 5: Group financial & schedule consequence"
  ],
  "entities": [
    {
      "bookingId": "string matching booking id",
      "bookingName": "string",
      "type": "accommodation" | "transportation" | "activity" | "meal" | "other",
      "riskLevel": "low" | "medium" | "high" | "critical",
      "riskScore": 0 to 100 (integer),
      "directEffect": "1 concise sentence on direct weather impact",
      "cascadingEffects": ["string describing cascade 1", "string describing cascade 2"],
      "recommendedAction": "1 high-leverage mitigation action",
      "probabilityOfImpact": 0.0 to 1.0 (float),
      "confidenceInterval": [float, float],
      "affectedParticipants": integer,
      "estimatedCostImpact": integer in INR
    }
  ]
}`;

  // 1. Try OpenRouter if API key is present
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const orModel = process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash-lite';
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
          'X-Title': 'NexusTrip Digital Twin',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: orModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze the travel digital twin impact for this trip context and return valid JSON:\n${JSON.stringify(promptPayload, null, 2)}` }
          ],
          temperature: 0.3,
          max_tokens: 2500,
          response_format: { type: 'json_object' }
        })
      });

      if (response.ok) {
        const json = await response.json();
        const raw = json?.choices?.[0]?.message?.content;
        const parsed = extractJsonFromText(raw);

        if (parsed && Array.isArray(parsed.entities) && parsed.entities.length > 0) {
          parsed.isSimulation = isSim;
          parsed.simulationParams = scenarioParams || null;
          parsed.generatedAt = new Date().toISOString();
          parsed.source = `OpenRouter (${orModel})`;
          parsed.weatherSnapshot = weatherSnapshot;
          parsed.totalEstimatedCostImpact = parsed.entities.reduce((s, e) => s + (Number(e.estimatedCostImpact) || 0), 0);

          parsed.entities.forEach((ent, idx) => {
            ent.coordinates = getOffsetCoordinates(centerCoords, idx, parsed.entities.length);
          });

          return parsed;
        }
      }
    } catch (orErr) {
      console.warn('[DigitalTwinService] OpenRouter failed, falling back to Groq:', orErr.message);
    }
  }

  // 2. Try Groq AI models with max_tokens
  for (const model of ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b']) {
    try {
      const groq = new Groq({ apiKey });
      const completion = await groq.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze the travel digital twin impact for this trip context and return valid JSON:\n${JSON.stringify(promptPayload, null, 2)}` }
        ]
      });

      const raw = completion.choices?.[0]?.message?.content;
      const parsed = extractJsonFromText(raw);

      if (parsed && Array.isArray(parsed.entities) && parsed.entities.length > 0) {
        parsed.isSimulation = isSim;
        parsed.simulationParams = scenarioParams || null;
        parsed.generatedAt = new Date().toISOString();
        parsed.source = `Groq AI (${model})`;
        parsed.weatherSnapshot = weatherSnapshot;
        parsed.totalEstimatedCostImpact = parsed.entities.reduce((s, e) => s + (Number(e.estimatedCostImpact) || 0), 0);

        // Assign geospatial offset coordinates
        parsed.entities.forEach((ent, idx) => {
          ent.coordinates = getOffsetCoordinates(centerCoords, idx, parsed.entities.length);
        });

        return parsed;
      }
    } catch (err) {
      console.warn(`[DigitalTwinService] Groq model ${model} failed:`, err.message);
    }
  }

  return null;
}

/**
 * Main function: Get or Compute Digital Twin State
 */
async function getDigitalTwinImpact(tripId) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new Error('Trip not found');

  const [rawBookings, participants] = await Promise.all([
    Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } }),
    Participant.find({ trip_id: tripId, status: { $ne: 'removed' } })
  ]);

  const primaryLocation = trip.destination || (rawBookings[0]?.location) || 'Mumbai';

  // Fetch Live Weather & Social Signals in parallel
  const [weatherRes, socialRes] = await Promise.all([
    getLiveWeather(primaryLocation),
    getSocialSignals(primaryLocation)
  ]);

  const centerCoords = weatherRes?.coordinates || await getCoordinates(primaryLocation);
  const normalizedBookings = normalizeTripBookings(trip, rawBookings);

  const weatherSnapshot = weatherRes?.weather?.current || {
    temp: 28,
    condition: 'Clear',
    rainfall_1h: 0,
    wind_speed: 15,
    alerts: []
  };

  // Try AI Reasoner first
  const aiResult = await callGroqDigitalTwin(trip, normalizedBookings, participants, weatherSnapshot, null, socialRes, centerCoords);
  if (aiResult) {
    aiResult.tripDestinationCoords = centerCoords;
    aiResult.socialSnapshot = socialRes;
    return aiResult;
  }

  // Fallback to Deterministic Physics & Cascading Graph Engine
  const heuristicResult = computeDeterministicImpact(trip, normalizedBookings, participants, weatherSnapshot, null, socialRes, centerCoords);
  heuristicResult.tripDestinationCoords = centerCoords;
  heuristicResult.socialSnapshot = socialRes;
  return heuristicResult;
}

/**
 * Run Counterfactual What-If Simulation
 */
async function simulateWhatIf(tripId, scenarioParams) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new Error('Trip not found');

  const [rawBookings, participants] = await Promise.all([
    Booking.find({ trip_id: tripId, status: { $ne: 'cancelled' } }),
    Participant.find({ trip_id: tripId, status: { $ne: 'removed' } })
  ]);

  const primaryLocation = scenarioParams.location || trip.destination || (rawBookings[0]?.location) || 'Mumbai';
  const coords = await getCoordinates(primaryLocation);
  const normalizedBookings = normalizeTripBookings(trip, rawBookings);

  const baseWeather = {
    temp: 28,
    condition: scenarioParams.rainfallMm > 80 ? 'Heavy Rain' : scenarioParams.windKph > 50 ? 'Gale Storm' : 'Moderate',
    rainfall_1h: Number(scenarioParams.rainfallMm || 0),
    wind_speed: Number(scenarioParams.windKph || 0),
    alerts: scenarioParams.floodRisk ? [{
      sender: 'What-If Simulation Engine',
      event: 'Simulated Inundation / Storm Override Active',
      start: new Date(),
      end: new Date(Date.now() + 86400000),
      description: `Scenario parameters: Precipitation ${scenarioParams.rainfallMm}mm, Storm Duration ${scenarioParams.stormDurationHours}h, Wind ${scenarioParams.windKph}km/h.`,
      severity: 'extreme'
    }] : []
  };

  // Try AI Reasoner for simulation
  const aiResult = await callGroqDigitalTwin(trip, normalizedBookings, participants, baseWeather, scenarioParams, null, coords);
  if (aiResult) {
    aiResult.tripDestinationCoords = coords;
    return aiResult;
  }

  // Fallback to Deterministic Heuristic Engine
  const heuristicResult = computeDeterministicImpact(trip, normalizedBookings, participants, baseWeather, scenarioParams, null, coords);
  heuristicResult.tripDestinationCoords = coords;
  return heuristicResult;
}

module.exports = {
  getDigitalTwinImpact,
  simulateWhatIf,
  normalizeTripBookings
};
