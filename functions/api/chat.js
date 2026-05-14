/**
 * functions/api/chat.js
 * Big Dodo — Cloudflare Pages Function
 *
 * Route: POST /api/chat
 *
 * Uses Cloudflare Workers AI (free) — no external API key required.
 * Enable the AI binding in the Cloudflare dashboard:
 *   Pages → Settings → Functions → AI Bindings → Add → variable name: AI
 */

import { HOTELS } from './_hotel_data.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://mauritiusresortfinder.com',
  'https://www.mauritiusresortfinder.com',
];

// Cloudflare Workers AI model — free, capable, fast
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const MAX_MESSAGE_LENGTH = 600;
const MAX_HISTORY_TURNS  = 6;
const MAX_HOTELS_CONTEXT = 9;

const SYSTEM_PROMPT = `You are Big Dodo, the AI concierge for Mauritius Resort Finder — an independent luxury hotel review platform.

Your job: help travelers choose the best resort in Mauritius using only the verified hotel data provided to you.

STRICT RULES:
1. Use ONLY the hotel data given in the user message. Never invent facts.
2. If the answer is not in the data, say: "I don't know based on the information currently available to me."
3. Never fabricate amenities, prices, or policies.
4. Be warm, professional, and concise — 2 to 4 sentences maximum.
5. When recommending hotels, give one specific reason from the data.
6. When including booking links, always note they may earn a commission.
7. Never pressure the user or make exaggerated claims.
8. Recommend at most 3 hotels per response.

You MUST respond with ONLY valid JSON — no extra text before or after. Use this exact format:
{
  "answer": "your response here",
  "recommendedHotels": [
    {
      "name": "Hotel Name",
      "region": "Region",
      "score": 9.1,
      "reason": "one specific reason from the data",
      "bookingUrl": "https://expedia.com/affiliate/..."
    }
  ],
  "confidence": "high"
}

Rules for the JSON:
- recommendedHotels can be an empty array [] if no hotel is relevant.
- confidence must be "high", "medium", or "low".
- Only include bookingUrl if the hotel data shows one.
- Do not include affiliateDisclosure in the JSON — it is added automatically.`;

// ─── Intent detection & hotel retrieval ──────────────────────────────────────

const INTENTS = {
  honeymoon:  ['honeymoon', 'couple', 'romantic', 'romance', 'anniversary', 'intimate', 'adults only', 'couples'],
  family:     ['family', 'kids', 'children', 'child', 'kid', 'toddler'],
  wellness:   ['spa', 'wellness', 'yoga', 'ayurvedic', 'health', 'massage', 'retreat'],
  beach:      ['beach', 'lagoon', 'snorkel', 'swim', 'ocean', 'sea', 'reef'],
  value:      ['budget', 'value', 'affordable', 'cheap', 'price', 'cost', 'best deal', 'money'],
  remote:     ['work', 'wifi', 'remote', 'digital nomad', 'laptop', 'workcation'],
  luxury:     ['luxury', 'five star', '5 star', 'exclusive', 'premium', 'opulent'],
  golf:       ['golf'],
  private:    ['private', 'secluded', 'quiet', 'isolated', 'peaceful'],
};

const REGIONS = {
  'grand baie':         'Grand Baie',
  'belle mare':         'Belle Mare',
  'cap malheureux':     'Cap Malheureux',
  'beau champ':         'Beau Champ',
  'blue bay':           'Blue Bay',
  'balaclava':          'Balaclava',
  'flic en flac':       'Flic En Flac',
  'bel ombre':          'Bel Ombre',
  'palmar':             'Palmar',
  'chemin grenier':     'Chemin Grenier',
  'poste de flacq':     'Poste de Flacq',
  'grand gaube':        'Grand Gaube',
  'port louis':         'Port Louis',
  'trou d eau douce':   "Trou d'Eau Douce",
  'grand river':        'Grand River South East',
  'pointe aux piments': 'Pointe Aux Piments',
};

function detectIntents(q) {
  const lower = q.toLowerCase();
  return Object.entries(INTENTS)
    .filter(([, kws]) => kws.some(k => lower.includes(k)))
    .map(([intent]) => intent);
}

function detectRegion(q) {
  const lower = q.toLowerCase().replace(/['']/g, '');
  for (const [key, name] of Object.entries(REGIONS)) {
    if (lower.includes(key)) return name;
  }
  return null;
}

function relevanceScore(hotel, intents, region) {
  let score = 0;
  const a = hotel.amenities || {};

  if (region && hotel.region === region) score += 8;

  for (const intent of intents) {
    score += 1;
    if (intent === 'honeymoon' && (a.private_beach || a.butler_service || a.private_pool)) score += 4;
    if (intent === 'honeymoon' && a.adults_only)  score += 3;
    if (intent === 'honeymoon' && a.spa)          score += 2;
    if (intent === 'family'    && a.kids_club)    score += 5;
    if (intent === 'family'    && a.adults_only)  score -= 8;
    if (intent === 'wellness'  && a.spa)          score += 6;
    if (intent === 'wellness'  && a.yoga)         score += 3;
    if (intent === 'beach'     && a.private_beach)score += 5;
    if (intent === 'beach'     && a.water_sports) score += 2;
    if (intent === 'value')                       score += (hotel.value || 0) * 0.6;
    if (intent === 'luxury'    && (hotel.overall || 0) >= 8.8) score += 4;
    if (intent === 'luxury'    && a.butler_service) score += 3;
    if (intent === 'golf'      && a.golf)         score += 8;
    if (intent === 'private'   && (a.private_beach || a.private_pool)) score += 3;
  }

  score += (hotel.overall || 0) * 0.5;
  return score;
}

function pickHotels(query) {
  const intents = detectIntents(query);
  const region  = detectRegion(query);

  return HOTELS
    .map(h => ({ h, s: relevanceScore(h, intents, region) }))
    .sort((a, b) => b.s - a.s || (b.h.overall || 0) - (a.h.overall || 0))
    .slice(0, MAX_HOTELS_CONTEXT)
    .map(x => x.h);
}

function formatHotels(hotels) {
  return hotels.map(h => {
    const amenList = h.amenities
      ? Object.entries(h.amenities).filter(([, v]) => v === true).map(([k]) => k.replace(/_/g, ' ')).join(', ')
      : 'not listed';
    return [
      `${h.name} (${h.region}) — Score: ${h.overall}/10`,
      `Scores: Location ${h.location} | Amenities ${h.amenity} | Brand ${h.brand} | Value ${h.value}`,
      `Amenities: ${amenList}`,
      `Reviews: ${h.reviews} reviews, avg ${h.avgRating}/5`,
      h.price ? `Price: from ~$${h.price}/night` : null,
      h.link  ? `Booking: ${h.link}` : 'No booking link',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

// ─── CORS ────────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResp(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin') || '') });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';

  // Parse body
  let body;
  try { body = await request.json(); }
  catch { return jsonResp({ error: 'Invalid JSON.' }, 400, origin); }

  const { message, pageContext = {}, conversationHistory = [] } = body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return jsonResp({ error: 'message is required.' }, 400, origin);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResp({ error: 'Message too long.' }, 400, origin);
  }

  // AI binding check
  if (!env.AI) {
    console.error('[Big Dodo] AI binding not configured');
    return jsonResp({
      answer: "I'm not fully set up yet — the AI binding is missing. Please check the Cloudflare Pages settings.",
      recommendedHotels: [],
      confidence: 'low',
    }, 200, origin);
  }

  // Build context
  const hotels      = pickHotels(message);
  const hotelBlock  = formatHotels(hotels);

  // Build message list for the model
  const history = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-MAX_HISTORY_TURNS * 2)
    : [];

  const messages = [];
  for (const turn of history) {
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    const content = String(turn.content || '').slice(0, 600);
    if (content.trim()) messages.push({ role: turn.role, content });
  }

  messages.push({
    role: 'user',
    content: `Hotel data:\n\n${hotelBlock}\n\n---\n\nQuestion: ${message.trim()}`,
  });

  // Call Cloudflare Workers AI
  let aiResult;
  try {
    aiResult = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 800,
      temperature: 0.3,
    });
  } catch (err) {
    console.error('[Big Dodo] AI error:', err.message);
    return jsonResp({ error: 'AI service error. Please try again.' }, 502, origin);
  }

  // Extract text (Workers AI returns { response: "..." })
  const rawText = (aiResult && aiResult.response) ? aiResult.response : '';

  // Parse JSON from the model response
  let parsed;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch {
    parsed = {
      answer:            rawText.trim() || "I don't know based on the information currently available to me.",
      recommendedHotels: [],
      confidence:        'low',
    };
  }

  // Sanitise and return
  const result = {
    answer: String(parsed.answer || '').slice(0, 1200),
    recommendedHotels: Array.isArray(parsed.recommendedHotels)
      ? parsed.recommendedHotels.slice(0, 3).map(h => ({
          name:       String(h.name       || ''),
          region:     String(h.region     || ''),
          score:      Number(h.score)     || 0,
          reason:     String(h.reason     || ''),
          bookingUrl: String(h.bookingUrl || ''),
        }))
      : [],
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
  };

  if (result.recommendedHotels.length > 0) {
    result.affiliateDisclosure = 'Booking links may earn us a commission at no extra cost to you.';
  }

  return jsonResp(result, 200, origin);
}
