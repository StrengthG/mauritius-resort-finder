/**
 * functions/api/chat.js
 * Big Dodo — Cloudflare Pages Function
 *
 * Route: POST /api/chat
 *
 * Receives a chat message from the Big Dodo widget, selects relevant hotel
 * context from the embedded data, and calls the Claude API to produce a
 * structured JSON response with an answer and (optionally) hotel recommendations.
 *
 * Environment secrets (set via Cloudflare dashboard):
 *   ANTHROPIC_API_KEY — required
 *
 * Environment variables (set in wrangler.toml or dashboard):
 *   ALLOWED_ORIGIN — defaults to https://mauritiusresortfinder.com
 */

import { HOTELS } from './_hotel_data.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://mauritiusresortfinder.com',
  'https://www.mauritiusresortfinder.com',
];

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 900;
const MAX_MESSAGE_LENGTH = 600;
const MAX_HISTORY_TURNS = 6;
const MAX_HOTELS_IN_CONTEXT = 9;

const SYSTEM_PROMPT = `You are Big Dodo, the AI concierge for Mauritius Resort Finder — an independent, data-backed luxury hotel review platform.

Your mission: help travelers choose the best resort in Mauritius, using only the verified hotel data provided to you.

RULES (follow strictly):
1. Use ONLY the hotel data in the user's message context. Never invent facts.
2. If the answer is not supported by the data, say exactly: "I don't know based on the information currently available to me."
3. Never fabricate amenities, prices, policies, or reviews.
4. Be warm, professional, and concise — no more than 3 short paragraphs.
5. When recommending hotels, explain the specific reason using the data.
6. Include booking links only when a hotel has one in the data.
7. When booking links are included, add the affiliate disclosure.
8. Never pressure, use urgency language, or make exaggerated claims.
9. If multiple hotels fit, recommend up to 3 — the ones best supported by data.
10. Think step by step before answering.

RESPONSE FORMAT — return valid JSON only, no extra text:
{
  "answer": "Natural language response (2–4 sentences)",
  "recommendedHotels": [
    {
      "name": "Hotel Name",
      "region": "Region",
      "score": 9.1,
      "reason": "One specific reason from the data",
      "bookingUrl": "https://expedia.com/affiliate/..."
    }
  ],
  "confidence": "high|medium|low",
  "affiliateDisclosure": "Booking links may earn us a commission at no extra cost to you."
}

Notes:
- Use an empty array [] for recommendedHotels when no hotel is relevant.
- Omit affiliateDisclosure when recommendedHotels is empty.
- confidence is "high" when data directly answers the question, "medium" when partially, "low" when you must infer.`;

// ─── Intent & retrieval ───────────────────────────────────────────────────────

const INTENT_KEYWORDS = {
  honeymoon:  ['honeymoon', 'couple', 'romantic', 'romance', 'anniversary', 'intimate', 'adults only', 'adult only', 'couples'],
  family:     ['family', 'kids', 'children', 'child', 'kid', 'toddler', 'babies'],
  wellness:   ['spa', 'wellness', 'yoga', 'ayurvedic', 'health', 'relax', 'retreat', 'massage', 'detox'],
  beach:      ['beach', 'lagoon', 'snorkel', 'swim', 'ocean', 'sea', 'water', 'reef', 'coral'],
  value:      ['budget', 'value', 'affordable', 'cheap', 'price', 'cost', 'money', 'inexpensive', 'best deal'],
  remote:     ['work', 'wifi', 'remote', 'digital nomad', 'laptop', 'business', 'workcation', 'wi-fi', 'internet'],
  luxury:     ['luxury', 'five star', '5 star', 'ultra luxury', 'exclusive', 'premium', 'opulent', 'lavish'],
  golf:       ['golf', 'golf course', 'golfer'],
  diving:     ['diving', 'snorkel', 'underwater', 'reef'],
  private:    ['private', 'secluded', 'quiet', 'remote', 'isolated', 'peaceful'],
};

const REGION_MAP = {
  'grand baie':           'Grand Baie',
  'belle mare':           'Belle Mare',
  'cap malheureux':       'Cap Malheureux',
  'beau champ':           'Beau Champ',
  'blue bay':             'Blue Bay',
  'balaclava':            'Balaclava',
  'flic en flac':         'Flic En Flac',
  'bel ombre':            'Bel Ombre',
  'palmar':               'Palmar',
  'chemin grenier':       'Chemin Grenier',
  'poste de flacq':       'Poste de Flacq',
  'grand gaube':          'Grand Gaube',
  'port louis':           'Port Louis',
  'trou d eau douce':     "Trou d'Eau Douce",
  'trou deau douce':      "Trou d'Eau Douce",
  'grand river':          'Grand River South East',
  'pointe aux piments':   'Pointe Aux Piments',
  'plaine magnien':       'Plaine Magnien',
};

function detectRegion(query) {
  const q = query.toLowerCase().replace(/['']/g, '');
  for (const [key, canonical] of Object.entries(REGION_MAP)) {
    if (q.includes(key)) return canonical;
  }
  return null;
}

function detectIntents(query) {
  const q = query.toLowerCase();
  const matched = [];
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some(k => q.includes(k))) matched.push(intent);
  }
  return matched;
}

function scoreHotelRelevance(hotel, intents, region) {
  let score = 0;

  if (region && hotel.region === region) score += 8;

  for (const intent of intents) {
    score += 1;
    const a = hotel.amenities || {};
    switch (intent) {
      case 'honeymoon':
        if (a.private_beach || a.butler_service || a.private_pool) score += 4;
        if (a.spa) score += 2;
        if (a.adults_only) score += 3;
        break;
      case 'family':
        if (a.kids_club) score += 5;
        if (a.adults_only) score -= 8;
        if (a.pool) score += 1;
        break;
      case 'wellness':
        if (a.spa) score += 6;
        if (a.yoga) score += 3;
        if (a.gym) score += 1;
        break;
      case 'beach':
        if (a.private_beach) score += 5;
        if (a.water_sports) score += 2;
        break;
      case 'value':
        score += (hotel.value || 0) * 0.6;
        break;
      case 'remote':
        score += 2;
        break;
      case 'luxury':
        if ((hotel.overall || 0) >= 8.8) score += 4;
        if (a.butler_service) score += 3;
        break;
      case 'golf':
        if (a.golf) score += 8;
        break;
      case 'private':
        if (a.private_beach || a.private_pool || a.butler_service) score += 3;
        break;
    }
  }

  // Baseline boost from overall rating
  score += (hotel.overall || 0) * 0.5;

  return score;
}

function findRelevantHotels(query, pageContext) {
  const intents = detectIntents(query);
  const region  = detectRegion(query);

  const active = HOTELS.filter(h => h.link !== null || true); // include all active

  const scored = active.map(h => ({
    hotel: h,
    relevance: scoreHotelRelevance(h, intents, region),
  }));

  scored.sort((a, b) =>
    b.relevance - a.relevance ||
    (b.hotel.overall || 0) - (a.hotel.overall || 0)
  );

  return scored.slice(0, MAX_HOTELS_IN_CONTEXT).map(s => s.hotel);
}

function buildHotelContext(hotels) {
  return hotels.map(h => {
    const amenityList = h.amenities
      ? Object.entries(h.amenities)
          .filter(([, v]) => v === true)
          .map(([k]) => k.replace(/_/g, ' '))
          .join(', ')
      : 'not specified';

    const lines = [
      `${h.name} — ${h.region}`,
      `Score: ${h.overall}/10 (Location ${h.location} | Amenities ${h.amenity} | Brand ${h.brand} | Value ${h.value})`,
      `Amenities: ${amenityList}`,
      `Reviews: ${h.reviews} guest reviews, avg ${h.avgRating}/5`,
      h.price ? `Price: from ~$${h.price}/night` : null,
      h.link  ? `Booking link: ${h.link}` : 'No booking link available',
    ];

    return lines.filter(Boolean).join('\n');
  }).join('\n\n');
}

// ─── CORS helpers ─────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400, origin);
  }

  const { message, pageContext = {}, conversationHistory = [] } = body;

  // Validate message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return jsonResponse({ error: 'message is required.' }, 400, origin);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse({ error: 'Message too long (max 600 characters).' }, 400, origin);
  }

  // API key guard
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[Big Dodo] ANTHROPIC_API_KEY not configured');
    return jsonResponse({ error: 'Service unavailable.' }, 503, origin);
  }

  // Retrieve relevant hotel context
  const relevantHotels = findRelevantHotels(message, pageContext);
  const hotelContext   = buildHotelContext(relevantHotels);

  // Build conversation messages for Claude
  const messages = [];

  // Include sanitised history (last N turns)
  const history = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-MAX_HISTORY_TURNS * 2)
    : [];

  for (const turn of history) {
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    const content = String(turn.content || '').slice(0, 800);
    if (content.trim()) messages.push({ role: turn.role, content });
  }

  // Append current user message with hotel context
  messages.push({
    role: 'user',
    content: `Available hotel data:\n\n${hotelContext}\n\n---\n\nVisitor question: ${message.trim()}`,
  });

  // Call Claude
  let claudeResponse;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      console.error('[Big Dodo] Claude API error:', res.status, err);
      return jsonResponse({ error: 'AI service error. Please try again.' }, 502, origin);
    }

    claudeResponse = await res.json();

  } catch (err) {
    console.error('[Big Dodo] Fetch error:', err.message);
    return jsonResponse({ error: 'Network error calling AI service.' }, 502, origin);
  }

  // Extract text from Claude response
  const rawText = claudeResponse?.content?.[0]?.text || '';

  // Parse the JSON Claude returned
  let parsed;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch {
    // Fallback: return the raw text as the answer
    parsed = {
      answer:            rawText.trim() || "I don't know based on the information currently available to me.",
      recommendedHotels: [],
      confidence:        'low',
    };
  }

  // Sanitise output fields
  const result = {
    answer:            String(parsed.answer || '').slice(0, 1200),
    recommendedHotels: Array.isArray(parsed.recommendedHotels)
      ? parsed.recommendedHotels.slice(0, 3).map(h => ({
          name:       String(h.name       || ''),
          region:     String(h.region     || ''),
          score:      Number(h.score)     || 0,
          reason:     String(h.reason     || ''),
          bookingUrl: String(h.bookingUrl || ''),
        }))
      : [],
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
      ? parsed.confidence
      : 'medium',
  };

  if (result.recommendedHotels.length > 0) {
    result.affiliateDisclosure = 'Booking links may earn us a commission at no extra cost to you.';
  }

  return jsonResponse(result, 200, origin);
}
