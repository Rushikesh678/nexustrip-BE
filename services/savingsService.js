/**
 * AI Group Savings Recommendation Service
 * Leverages OpenRouter small/cheap LLM (e.g. google/gemini-2.0-flash-lite-001 or llama-3.2-3b)
 * to provide hyper-localized, actionable money-saving advice for group travelers based on booking locations.
 * Includes graceful fallback to Groq and smart local heuristic engine.
 */

const { Groq } = require('groq-sdk');

// In-memory cache for savings recommendations to avoid redundant API calls: key -> { data, timestamp }
const recommendationsCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours cache to prevent unnecessary API pings

/**
 * Clean LLM response string to extract pure JSON
 */
function extractJsonFromText(rawText) {
  if (!rawText) return null;
  let cleaned = rawText.trim();
  // Strip markdown code fences ```json ... ```
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // If there's surrounding text, attempt to locate the outermost { ... }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const sub = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(sub);
      } catch (subErr) {
        console.warn('[SavingsService]: Failed to parse extracted substring as JSON:', subErr.message);
      }
    }
  }
  return null;
}

/**
 * Call OpenRouter API with a cheap/small model
 */
async function callOpenRouter(location, tripContext = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash-lite';
  const siteUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const siteName = 'NexusTrip';

  const systemPrompt = `You are an expert travel budget consultant specializing in group trips. 
Given a specific city, destination, or booking location, generate realistic, highly actionable, local money-saving recommendations for a group.
Your advice must be specific to the culture, local transit options, dining norms, booking habits, and local tourist traps of that destination.
Focus on:
1. Transport hacks (e.g. scooter rentals, shared van, metro cards vs expensive union cabs)
2. Food & dining (e.g. authentic local thali/shack spots vs tourist club cover charges)
3. Accommodation & activities (e.g. combo activity tickets, private villa splitting vs separate rooms)
4. Local insider secrets specific to that region.

Strictly return a JSON object with this exact structure:
{
  "location": "${location}",
  "headline": "Punchy 1-sentence headline for saving in this location",
  "estimatedTotalSavings": "e.g. ₹5,000 - ₹9,000",
  "tips": [
    {
      "category": "Transport" | "Accommodation" | "Food & Dining" | "Activities" | "Local Secrets",
      "title": "Short catchy title",
      "savingEstimate": "e.g. Save ~30% (₹2,500)",
      "advice": "2 concise sentences of specific local advice for this city/region."
    }
  ]
}`;

  const userPrompt = `How can a group of travelers save money when booking accommodations, transit, and activities in or around "${location}"? 
Group size: ${tripContext.participantsCount || 4} people.
Currency: ${tripContext.currency || 'INR'}.
Generate 3 to 4 distinct, hyper-relevant money saving recommendations. Return only JSON.`;

  try {
    console.log(`[SavingsService]: Calling OpenRouter (${model}) for location "${location}"...`);
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': siteUrl,
        'X-Title': siteName,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[SavingsService]: OpenRouter responded with status ${response.status}: ${errText}`);
      return null;
    }

    const json = await response.json();
    const rawContent = json?.choices?.[0]?.message?.content;
    const parsed = extractJsonFromText(rawContent);
    if (parsed && Array.isArray(parsed.tips) && parsed.tips.length > 0) {
      parsed.source = 'openrouter';
      parsed.model = model;
      return parsed;
    }
  } catch (err) {
    console.error('[SavingsService]: OpenRouter fetch error:', err.message);
  }
  return null;
}

/**
 * Fallback to Groq API if OpenRouter key is not set or fails
 */
async function callGroqFallback(location, tripContext = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const modelsToTry = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

  for (const model of modelsToTry) {
    try {
      console.log(`[SavingsService]: Calling AI fallback (${model}) for "${location}"...`);
      const groq = new Groq({ apiKey });
      const completion = await groq.chat.completions.create({
        model,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert travel budget consultant for group trips. Generate realistic, highly actionable, local money-saving recommendations for the location. Return strictly JSON:
{
  "location": "${location}",
  "headline": "Brief catchy summary",
  "estimatedTotalSavings": "e.g. ₹4,000 - ₹8,000",
  "tips": [
    {
      "category": "Transport" | "Accommodation" | "Food & Dining" | "Activities" | "Local Secrets",
      "title": "Short title",
      "savingEstimate": "e.g. Save ~25% (₹2,000)",
      "advice": "Specific local advice for this city/region."
    }
  ]
}`
          },
          {
            role: 'user',
            content: `Provide top money-saving tips for a group trip in "${location}". Group size: ${tripContext.participantsCount || 4}, currency: ${tripContext.currency || 'INR'}. Output valid JSON.`
          }
        ]
      });

      const content = completion.choices?.[0]?.message?.content;
      const parsed = extractJsonFromText(content);
      if (parsed && Array.isArray(parsed.tips) && parsed.tips.length > 0) {
        parsed.source = 'groq-ai';
        parsed.model = model;
        return parsed;
      }
    } catch (err) {
      console.warn(`[SavingsService]: Model ${model} failed: ${err.message}. Trying next...`);
    }
  }
  return null;
}

/**
 * Dynamic Smart Local Generator (Heuristic Fallback if offline or no keys configured)
 */
function getSmartLocalRecommendations(location, tripContext = {}) {
  const loc = (location || '').toLowerCase();
  const currency = tripContext.currency === 'USD' ? '$' : '₹';
  const mult = tripContext.currency === 'USD' ? 0.015 : 1;

  if (loc.includes('goa')) {
    return {
      location,
      headline: 'Goa Coastal Group Savings Blueprint',
      estimatedTotalSavings: `${currency}${Math.round(6500 * mult).toLocaleString()} - ${currency}${Math.round(11000 * mult).toLocaleString()}`,
      source: 'smart-heuristic',
      tips: [
        {
          category: 'Transport',
          title: 'Rent Self-Drive Thar / Scooters over Cabs',
          savingEstimate: `Save ~${currency}${Math.round(3500 * mult).toLocaleString()} total`,
          advice: 'Goa local taxi unions charge high non-metered flat fares. Renting 2-3 scooters at ₹350/day or a self-drive 7-seater van from Thivim/Madgaon station cuts group transit costs by 65%.'
        },
        {
          category: 'Food & Dining',
          title: 'Beach Shacks & Thali Spots over High-End Clubs',
          savingEstimate: `Save ~${currency}${Math.round(2000 * mult).toLocaleString()}/day`,
          advice: 'Avoid heavy cover charges at commercial clubs in Baga. Authentic beach shacks in Ashvem and local legends like Ritz Classic or Anand Seafood offer delicious Goan fish thalis at a fraction of the cost.'
        },
        {
          category: 'Activities',
          title: 'Negotiate Beach Water Sports in Combo Bundles',
          savingEstimate: `Save ~${currency}${Math.round(1500 * mult).toLocaleString()} per person`,
          advice: 'Never purchase individual jet-ski or parasailing tickets. Approach beach operators at Calangute/Morjim as a group and negotiate a 5-in-1 adventure combo for 35% discount.'
        },
        {
          category: 'Accommodation',
          title: 'Private Villa with Kitchen in North/South Goa',
          savingEstimate: `Save ~25% vs 3+ hotel rooms`,
          advice: 'A 3-4 bedroom private pool villa in Assagao or Benaulim split across 4-6 members provides privacy, free breakfast self-cooking, and significantly lower cost per person.'
        }
      ]
    };
  }

  if (loc.includes('manali') || loc.includes('himachal') || loc.includes('kasol')) {
    return {
      location,
      headline: 'Himalayan Mountain Saver Guide',
      estimatedTotalSavings: `${currency}${Math.round(5000 * mult).toLocaleString()} - ${currency}${Math.round(9000 * mult).toLocaleString()}`,
      source: 'smart-heuristic',
      tips: [
        {
          category: 'Transport',
          title: 'Shared Innova/Bolero for Rohtang & Solang Valley',
          savingEstimate: `Save ~${currency}${Math.round(2500 * mult).toLocaleString()}`,
          advice: 'Book a full-day private utility vehicle directly with the local union stand 1 day prior, avoiding hotel tour desk markups of up to 40%.'
        },
        {
          category: 'Accommodation',
          title: 'Traditional Homestay or Wooden Chalet in Old Manali',
          savingEstimate: `Save ~30% vs Mall Road hotels`,
          advice: 'Old Manali and Naggar offer scenic apple-orchard homestays that cost less than commercial hotels on the Mall Road and include home-cooked group meals.'
        },
        {
          category: 'Activities',
          title: 'Self-Guided Treks over Commercial Tour Agencies',
          savingEstimate: `Save ~${currency}${Math.round(1800 * mult).toLocaleString()} per person`,
          advice: 'Popular trails like Jogini Waterfall and Lamadugh are well-marked. Doing these self-guided saves high agency guide fees.'
        }
      ]
    };
  }

  if (loc.includes('phuket') || loc.includes('thailand') || loc.includes('bangkok')) {
    return {
      location,
      headline: 'Thailand Group Adventure Savings Guide',
      estimatedTotalSavings: `${currency}${Math.round(7000 * mult).toLocaleString()} - ${currency}${Math.round(12000 * mult).toLocaleString()}`,
      source: 'smart-heuristic',
      tips: [
        {
          category: 'Transport',
          title: 'GrabVan / Bolt Van Group Booking',
          savingEstimate: 'Save ~40% vs airport taxi counters',
          advice: 'Airport taxi counters charge high tourist rates. Use the Bolt or Grab app to book a 6-passenger van directly to Patong/Kata beach.'
        },
        {
          category: 'Activities',
          title: 'Direct Pier Booking for Island Catamaran & Speedboats',
          savingEstimate: 'Save ~30% on Phi Phi / James Bond tours',
          advice: 'Avoid hotel tour desks. Head directly to Chalong Pier in the evening or book group island tours on local peer portals for group discounts.'
        },
        {
          category: 'Food & Dining',
          title: 'Night Markets & Local Food Courts',
          savingEstimate: 'Save ~50% on group dining',
          advice: 'Eat at Phuket Weekend Market or Malin Plaza. Fresh pad thai, seafood skewers, and mango sticky rice cost 4x less than beachfront tourist restaurants.'
        }
      ]
    };
  }

  // Universal smart fallback for any city/location
  return {
    location,
    headline: `Smart Group Savings Blueprint for ${location}`,
    estimatedTotalSavings: `${currency}${Math.round(4500 * mult).toLocaleString()} - ${currency}${Math.round(8000 * mult).toLocaleString()}`,
    source: 'smart-heuristic',
    tips: [
      {
        category: 'Transport',
        title: 'Group Ride Hailing & Transit Passes',
        savingEstimate: `Save ~${currency}${Math.round(2000 * mult).toLocaleString()}`,
        advice: `For travel around ${location}, booking XL group rides or day transit passes is up to 35% cheaper than hailing multiple separate autos or standard taxis.`
      },
      {
        category: 'Accommodation',
        title: 'Entire Home / Apartment Split with Kitchen',
        savingEstimate: 'Save ~20-30% per person',
        advice: `Booking a 2-3 bedroom furnished apartment or homestay in ${location} allows the group to split costs efficiently and prepare breakfast together.`
      },
      {
        category: 'Activities',
        title: 'Book Group Passes in Advance',
        savingEstimate: `Save ~${currency}${Math.round(1500 * mult).toLocaleString()}`,
        advice: `Most museums, adventure operators, and viewpoints in ${location} offer group ticket discounts (usually 10-25% off) when booked 48 hours ahead.`
      },
      {
        category: 'Food & Dining',
        title: 'Family-Style Shared Dining at Top-Rated Local Gems',
        savingEstimate: 'Save ~15-20% per meal',
        advice: `Order large shared platters or family-style entrees at authentic neighborhood restaurants instead of individual dining at tourist-centric venues.`
      }
    ]
  };
}

/**
 * Main function: Get savings recommendations for a given location
 */
async function getSavingsRecommendations(location, tripContext = {}, forceRefresh = false) {
  if (!location || typeof location !== 'string' || !location.trim()) {
    return null;
  }

  const cleanLocation = location.trim();
  const cacheKey = `${cleanLocation.toLowerCase()}_${tripContext.currency || 'INR'}`;

  // Check cache
  if (!forceRefresh && recommendationsCache.has(cacheKey)) {
    const cached = recommendationsCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.data, cached: true };
    }
  }

  // 1. Try OpenRouter (Small/cheap model specified by user)
  let result = await callOpenRouter(cleanLocation, tripContext);

  // 2. Try Groq fallback if OpenRouter key not present or failed
  if (!result) {
    result = await callGroqFallback(cleanLocation, tripContext);
  }

  // 3. Fallback to smart heuristic generator
  if (!result) {
    result = getSmartLocalRecommendations(cleanLocation, tripContext);
  }

  // Save to cache
  if (result) {
    recommendationsCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });
  }

  return result;
}

module.exports = {
  getSavingsRecommendations
};
