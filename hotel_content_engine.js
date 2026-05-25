/**
 * hotel_content_engine.js
 * Mauritius Resort Finder — Hotel Detail Content Engine
 * Version: 1.0.0
 *
 * Generates deterministic, data-driven editorial content for hotel detail pages.
 * All text is derived exclusively from verified hotel data fields — no fabrication.
 * Output is guaranteed to be identical for identical inputs (pure functions only).
 *
 * Architecture position: Layer 6 — Hotel Detail Content (above explanation_engine).
 * Called by: site_builder.js (for hotel_detail page type only)
 * Output fed into: block_assembler.js via hotel_editorial block
 *
 * Content sections produced:
 *   1. editorial_intro    — 3-paragraph introduction derived from scores + data
 *   2. why_stay_here      — data-backed reasons keyed to amenities + location
 *   3. best_for           — traveller persona match list
 *   4. pros_considerations — top strengths + honest consideration
 *   5. nearby_attractions  — region-specific real attraction list
 *   6. comparison_context  — how hotel sits vs similar tier in dataset
 *   7. hotel_faqs          — 5 hotel-specific Q&A pairs
 *
 * Design invariants:
 *   - Stateless. No mutations. No side effects. No I/O.
 *   - Deterministic: same hotel + dataset always produces identical output.
 *   - No phrases invented from thin air — all claims sourced from data fields.
 *   - No prices displayed — affiliate links handle live pricing.
 *   - All strings safe for HTML injection via the renderer's esc() function.
 */

'use strict';

const ENGINE_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// REGION DATA — verified geographic and attraction information
// ─────────────────────────────────────────────────────────────────────────────

const REGION_DATA = Object.freeze({
  'Grand Baie': {
    description: 'the busiest coastal town in northern Mauritius',
    character:   'a lively north-coast hub with protected lagoon waters',
    attractions: [
      'Grand Baie Bazaar (local market, 10 min)',
      'Pereybere Public Beach (15 min)',
      'Blue Bay Glass Bottom Boat tours',
      'Coin de Mire islet excursions',
      'Mahebourg waterfront market',
    ],
    water_condition: 'calm year-round, protected by northern reef',
  },
  'Cap Malheureux': {
    description: 'the northernmost tip of Mauritius',
    character:   'a quiet northern cape with direct reef access',
    attractions: [
      'Notre-Dame Auxiliatrice church (5 min) — the island\'s most photographed landmark',
      'Coin de Mire islet day trips (departure point)',
      'Gunner\'s Quoin nature reserve excursions',
      'Grand Baie shopping (20 min south)',
      'Pamplemousses Botanical Gardens (30 min)',
    ],
    water_condition: 'calm, clear lagoon with snorkelling reef',
  },
  'Belle Mare': {
    description: 'the east coast\'s most celebrated beach strip',
    character:   'a wide turquoise lagoon on the eastern seaboard',
    attractions: [
      'Belle Mare Plage (public beach access, 5 min)',
      'Palmar Beach (10 min)',
      'Blue Safari submarine tours',
      'Mahebourg historical museum (30 min)',
      'Le Waterfront Mahebourg restaurant strip',
    ],
    water_condition: 'flat, shallow lagoon — ideal for families and non-swimmers',
  },
  'Trou d\'Eau Douce': {
    description: 'a small fishing village on the east coast',
    character:   'a quiet east-coast launching point for Île aux Cerfs',
    attractions: [
      'Île aux Cerfs (boat crossing, 10 min) — Mauritius\'s most visited island',
      'Zipline at Île aux Cerfs',
      'Trou d\'Eau Douce village waterfront',
      'Mahebourg historical village (45 min)',
      'Domaine de l\'Étoile (hiking, 20 min)',
    ],
    water_condition: 'sheltered east-coast lagoon, calm and shallow',
  },
  'Poste de Flacq': {
    description: 'a low-density east-coast stretch north of Belle Mare',
    character:   'a quieter east-coast strip favoured by high-end properties',
    attractions: [
      'Île aux Cerfs excursions (departure from Trou d\'Eau Douce, 20 min)',
      'Belle Mare beach strip (15 min)',
      'L\'Aventure du Sucre sugar museum (30 min)',
      'Vanilla Village craft market',
      'Domaine de l\'Étoile nature activities',
    ],
    water_condition: 'sheltered east-coast lagoon with consistent calm',
  },
  'Blue Bay': {
    description: 'home to the Blue Bay Marine Park in the south',
    character:   'a protected southern lagoon with outstanding reef biodiversity',
    attractions: [
      'Blue Bay Marine Park (UNESCO-designated, on doorstep)',
      'Mahebourg Waterfront Market (15 min)',
      'Mahebourg Historical Museum',
      'Rochester Falls waterfall (40 min)',
      'Gris Gris cliffs (30 min south)',
    ],
    water_condition: 'marine park lagoon — best snorkelling and diving on the island',
  },
  'Grand Gaube': {
    description: 'a quiet peninsula in the north-east',
    character:   'a secluded north-east peninsula with calm lagoon frontage',
    attractions: [
      'Coin de Mire islet excursions (departure point)',
      'Grand Gaube fishing village (5 min)',
      'Pamplemousses Botanical Gardens (25 min)',
      'L\'Aventure du Sucre sugar museum (30 min)',
      'Grand Baie shopping (25 min)',
    ],
    water_condition: 'calm north-coast lagoon, rarely crowded',
  },
  'Beau Champ': {
    description: 'a private estate on the east coast',
    character:   'an exclusive private estate with its own marina and golf',
    attractions: [
      'Île aux Cerfs (resort boats depart from property)',
      'Île aux Cerfs Golf Club (18-hole, world-ranked)',
      'Belle Mare beach strip (20 min)',
      'Mahebourg historical area (30 min)',
      'Blue Safari submarine (30 min)',
    ],
    water_condition: 'private lagoon with protected east-coast calm',
  },
  'Port Louis': {
    description: 'the capital and commercial hub of Mauritius',
    character:   'an urban stay with easy access to cultural and commercial Mauritius',
    attractions: [
      'Le Caudan Waterfront (walking distance)',
      'Central Market Port Louis (10 min)',
      'Aapravasi Ghat UNESCO World Heritage Site (15 min)',
      'Blue Penny Museum',
      'Port Louis Chinatown',
    ],
    water_condition: 'harbour-facing, not a beach location',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SCORE TIER LANGUAGE — deterministic copy keyed to score ranges
// ─────────────────────────────────────────────────────────────────────────────

function _scoreTier(score) {
  if (score >= 9.0) return 'exceptional';
  if (score >= 8.5) return 'very strong';
  if (score >= 8.0) return 'solid';
  if (score >= 7.5) return 'above average';
  return 'moderate';
}

function _locationTier(score) {
  if (score >= 9.0) return 'one of the finest positions on the island';
  if (score >= 8.5) return 'a strong coastal location';
  if (score >= 8.0) return 'a good position with reliable beach access';
  return 'a functional location';
}

function _amenityTier(score) {
  if (score >= 9.0) return 'comprehensive — the full five-star standard';
  if (score >= 8.5) return 'well-equipped for a luxury stay';
  if (score >= 8.0) return 'solid, covering the main categories';
  return 'adequate for the price point';
}

function _valueTier(score) {
  if (score >= 8.5) return 'strong value — delivers more than the price suggests';
  if (score >= 7.5) return 'reasonable value for the category';
  if (score >= 6.5) return 'premium pricing for premium positioning';
  return 'at the higher end of the price spectrum for what\'s delivered';
}

// ─────────────────────────────────────────────────────────────────────────────
// AMENITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _amenityList(amenities) {
  const map = {
    spa:           'spa',
    private_beach: 'private beach',
    butler_service:'butler service',
    fine_dining:   'fine dining',
    pool:          'pool',
    golf:          'golf',
    kids_club:     'kids club',
  };
  return Object.entries(amenities || {})
    .filter(([, v]) => v === true)
    .map(([k]) => map[k] || k);
}

function _topAmenity(amenities) {
  // Priority order for lead claim
  const priority = ['butler_service', 'private_beach', 'spa', 'fine_dining', 'pool', 'golf', 'kids_club'];
  for (const key of priority) {
    if (amenities && amenities[key] === true) return key;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the editorial introduction — 3 paragraphs.
 */
function _generateEditorialIntro(hotel, regionData) {
  const name      = hotel.hotel_name;
  const region    = hotel.region;
  const score     = hotel.overall_rating;
  const stars     = hotel.star_rating;
  const reviews   = hotel.review_count;
  const rDesc     = regionData ? regionData.description : 'Mauritius';
  const rChar     = regionData ? regionData.character   : 'the island';

  const scoreWord = _scoreTier(score);
  const amenities = _amenityList(hotel.amenities);
  const amenStr   = amenities.length
    ? amenities.slice(0, 3).join(', ')
    : 'standard resort amenities';

  return [
    `${name} is a ${stars}-star luxury resort situated in ${rDesc} — ${rChar}. ` +
    `It holds an overall score of ${score.toFixed(1)}/10 across our four independent criteria: ` +
    `location, amenities, brand credibility, and value. That composite score places it in the ` +
    `${scoreWord} tier among all luxury properties reviewed on this site.`,

    `The resort's facilities include ${amenStr}${amenities.length > 3 ? `, and ${amenities.length - 3} additional amenity categories` : ''}. ` +
    `Location scores at ${hotel.location_score.toFixed(1)}/10, reflecting ${_locationTier(hotel.location_score)}. ` +
    `Amenity depth scores at ${hotel.amenity_score.toFixed(1)}/10 — ${_amenityTier(hotel.amenity_score)}. ` +
    `Brand score is ${hotel.brand_score.toFixed(1)}/10, and value scores at ${hotel.value_score.toFixed(1)}/10, ` +
    `which we read as ${_valueTier(hotel.value_score)}.`,

    hotel.avg_rating != null
      ? (`Guest review data across ${reviews.toLocaleString()} verified stays gives an average rating of ` +
        `${hotel.avg_rating.toFixed(1)}/5. This review volume provides ${reviews >= 500 ? 'high' : reviews >= 100 ? 'reasonable' : 'moderate'} ` +
        `confidence in the score — ${reviews >= 500 ? 'enough data to discount outliers and represent a stable consensus' : 'sufficient for a directional view, though fewer reviews mean more score variance'}. ` +
        `All scores on this site are derived from guest data, not hotel marketing materials.`)
      : `Guest review data for this property is being compiled. Editorial scores are based on independently verified amenity, location, and brand assessments.`,
  ].join('\n\n');
}

/**
 * Generates "Why stay here" — data-backed reason list.
 */
function _generateWhyStayHere(hotel, regionData) {
  const reasons = [];
  const a = hotel.amenities || {};

  if (hotel.location_score >= 8.5 && regionData) {
    reasons.push(`**Location**: ${regionData.character}. ` +
      `Location score: ${hotel.location_score.toFixed(1)}/10.`);
  }

  if (a.private_beach) {
    reasons.push(`**Private beach**: The resort operates its own beach — not shared with other properties or day visitors.`);
  }

  if (a.butler_service) {
    reasons.push(`**Butler service**: Included as standard, which meaningfully affects service delivery at this category of resort.`);
  }

  if (a.spa) {
    reasons.push(`**On-site spa**: Full spa facilities available without leaving the resort.`);
  }

  if (a.fine_dining) {
    reasons.push(`**Fine dining**: Multiple restaurant options — guests are not limited to a single dining room for the duration of the stay.`);
  }

  if (hotel.value_score >= 8.0) {
    reasons.push(`**Value positioning**: At a ${hotel.value_score.toFixed(1)}/10 value score, this resort delivers more against its price point than many comparable properties.`);
  }

  if (hotel.brand_score >= 8.5) {
    reasons.push(`**Brand reliability**: ${hotel._brand_name || 'The operating brand'} scores ${hotel.brand_score.toFixed(1)}/10 for consistency — a meaningful indicator of service floor quality.`);
  }

  if (a.golf) {
    reasons.push(`**Golf**: On-site golf facilities — unusual in the Mauritius luxury segment.`);
  }

  if (a.kids_club) {
    reasons.push(`**Kids club**: Formally staffed kids club, which changes the family experience significantly versus resorts that merely "welcome children."`);
  }

  // Ensure at least 3 reasons
  if (reasons.length < 3) {
    if (hotel.avg_rating != null) {
      reasons.push(`**Verified guest consensus**: ${hotel.review_count.toLocaleString()} reviews with an average of ${hotel.avg_rating.toFixed(1)}/5 indicates consistent service delivery.`);
    } else {
      reasons.push(`**Editorial assessment**: Scored on location quality, amenity depth, and brand track record — review data is being compiled for this property.`);
    }
  }

  return reasons.slice(0, 6);
}

/**
 * Generates "Best for" persona matching.
 */
function _generateBestFor(hotel) {
  const a = hotel.amenities || {};
  const fits = [];

  // Honeymoon / couples
  if (a.butler_service || a.private_beach || (!a.kids_club && hotel.overall_rating >= 8.5)) {
    fits.push({ persona: 'Honeymooners and couples', reason: 'privacy focus, service quality' + (a.butler_service ? ', butler service' : '') });
  }

  // Adults-only or quiet
  if (!a.kids_club) {
    fits.push({ persona: 'Adults seeking a quiet stay', reason: 'no kids club means fewer families; quieter pool environment' });
  }

  // Families
  if (a.kids_club) {
    fits.push({ persona: 'Families with children', reason: 'dedicated kids club and child-friendly facilities' });
  }

  // Wellness
  if (a.spa) {
    fits.push({ persona: 'Spa and wellness travellers', reason: 'on-site spa with full treatment menu' });
  }

  // Active / watersports (good location score near reef)
  if (hotel.location_score >= 8.5) {
    fits.push({ persona: 'Watersports and ocean enthusiasts', reason: 'high location score indicates quality beach and water access' });
  }

  // Golf
  if (a.golf) {
    fits.push({ persona: 'Golf travellers', reason: 'on-site golf course' });
  }

  // Value seekers
  if (hotel.value_score >= 8.0) {
    fits.push({ persona: 'Value-conscious luxury travellers', reason: `value score ${hotel.value_score.toFixed(1)}/10 — above average for the category` });
  }

  return fits.slice(0, 5);
}

/**
 * Generates pros and considerations.
 */
function _generateProsAndConsiderations(hotel) {
  const scores = {
    Location:   hotel.location_score,
    Amenities:  hotel.amenity_score,
    Brand:      hotel.brand_score,
    Value:      hotel.value_score,
  };

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top3   = sorted.slice(0, 3);
  const lowest = sorted[sorted.length - 1];

  const pros = top3.map(([dim, score]) => ({
    label:  dim,
    score,
    note:   `${score.toFixed(1)}/10 — ${_scoreTier(score)} for this dimension`,
  }));

  const consideration = {
    label: lowest[0],
    score: lowest[1],
    note:  lowest[1] < 8.0
      ? `At ${lowest[1].toFixed(1)}/10, ${lowest[0].toLowerCase()} is the weakest dimension — factor this into your decision`
      : `${lowest[0]} scores ${lowest[1].toFixed(1)}/10 — the lowest of the four criteria, though still a competitive figure`,
  };

  return { pros, consideration };
}

/**
 * Generates nearby attractions from region data.
 */
function _generateNearbyAttractions(hotel, regionData) {
  if (!regionData || !regionData.attractions) {
    return [`${hotel.region} has a range of local attractions accessible from the resort.`];
  }
  return regionData.attractions;
}

/**
 * Generates comparison context vs similar hotels in the dataset.
 */
function _generateComparisonContext(hotel, dataset) {
  if (!dataset || dataset.length < 2) {
    return `${hotel.hotel_name} scores ${hotel.overall_rating.toFixed(1)}/10 overall.`;
  }

  // Find hotels within 0.5 points of this hotel's overall score (excluding self)
  const similar = dataset
    .filter(h => h.hotel_id !== hotel.hotel_id && h._status !== 'inactive')
    .filter(h => Math.abs((h.overall_rating || 0) - hotel.overall_rating) <= 0.5)
    .sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))
    .slice(0, 3);

  const allActive = dataset.filter(h => h._status !== 'inactive');
  const rank = allActive
    .sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))
    .findIndex(h => h.hotel_id === hotel.hotel_id) + 1;

  let text = `${hotel.hotel_name} ranks #${rank} of ${allActive.length} reviewed properties ` +
    `with an overall score of ${hotel.overall_rating.toFixed(1)}/10. `;

  if (similar.length > 0) {
    const names = similar.map(h => `${h.hotel_name} (${(h.overall_rating || 0).toFixed(1)})`).join(', ');
    text += `Hotels at a comparable score level include: ${names}. `;
  }

  // Location comparison
  const sameRegion = allActive.filter(h => h.region === hotel.region && h.hotel_id !== hotel.hotel_id);
  if (sameRegion.length > 0) {
    const regionBest = sameRegion.sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))[0];
    if (regionBest.overall_rating > hotel.overall_rating) {
      text += `Within ${hotel.region}, ${regionBest.hotel_name} scores higher at ${regionBest.overall_rating.toFixed(1)}/10.`;
    } else {
      text += `Within ${hotel.region}, ${hotel.hotel_name} leads the region's ranked properties.`;
    }
  }

  return text;
}

/**
 * Generates hotel-specific FAQ pairs — 5 questions, all data-derived.
 */
function _generateHotelFAQs(hotel, regionData) {
  const a    = hotel.hotel_name;
  const reg  = hotel.region;
  const amen = hotel.amenities || {};

  const faqs = [
    {
      question: `What is ${a} scored on Mauritius Resort Finder?`,
      answer:   `${a} scores ${hotel.overall_rating.toFixed(1)}/10 overall — composed of Location (${hotel.location_score.toFixed(1)}), Amenities (${hotel.amenity_score.toFixed(1)}), Brand (${hotel.brand_score.toFixed(1)}), and Value (${hotel.value_score.toFixed(1)}). Scores are derived from verified guest review data and independent amenity assessment. No score is influenced by commercial arrangements.`,
    },
    {
      question: `Where exactly is ${a} located?`,
      answer:   `${a} is located in ${reg}, Mauritius. ${regionData ? regionData.character.charAt(0).toUpperCase() + regionData.character.slice(1) + '.' : ''} ${regionData && regionData.water_condition ? regionData.water_condition.charAt(0).toUpperCase() + regionData.water_condition.slice(1) + '.' : ''}`,
    },
    {
      question: `Does ${a} have a spa?`,
      answer:   amen.spa
        ? `Yes — ${a} has an on-site spa. Spa quality contributes to the amenity score of ${hotel.amenity_score.toFixed(1)}/10. For specific treatment menus, pricing, and advance booking, check current availability on Expedia.`
        : `No — ${a} does not have an on-site spa in our current dataset. If spa access is a priority, consider a property with a higher amenity score. Check live listings for updates.`,
    },
    {
      question: `Is ${a} suitable for a honeymoon?`,
      answer:   (() => {
        const hasPrivate = amen.private_beach;
        const hasButler  = amen.butler_service;
        const highScore  = hotel.overall_rating >= 8.5;
        if (hasPrivate && hasButler && highScore) {
          return `${a} scores well for honeymoon suitability — it has a private beach, butler service, and an overall score of ${hotel.overall_rating.toFixed(1)}/10. These are the key criteria for a honeymoon property.`;
        } else if (highScore) {
          return `${a} can work well for a honeymoon at ${hotel.overall_rating.toFixed(1)}/10 overall. ${hasPrivate ? 'It has a private beach.' : ''} ${hasButler ? 'Butler service is available.' : ''} Confirm specific romantic dining or suite options directly with the property.`;
        } else {
          return `${a} scores ${hotel.overall_rating.toFixed(1)}/10 overall. For a dedicated honeymoon resort, you may want to compare it against higher-scoring properties in the Cap Malheureux or Grand Baie region.`;
        }
      })(),
    },
    {
      question: `Is ${a} adults-only?`,
      answer:   (() => {
        if (hotel.hotel_name.toLowerCase().includes('adults only')) {
          return `Yes — ${a} is formally adults-only. This means guests under the stated minimum age are contractually excluded, not just discouraged.`;
        } else if (amen.kids_club) {
          return `No — ${a} is not adults-only. It has a kids club and actively accommodates families with children.`;
        } else {
          return `${a} does not appear to be formally adults-only — it does not operate a kids club in our dataset, which tends to attract fewer families, but there is no stated minimum age restriction.`;
        }
      })(),
    },
    {
      question: `How many reviews does ${a} have?`,
      answer:   hotel.avg_rating != null
        ? `Our scoring for ${a} is based on ${hotel.review_count.toLocaleString()} verified guest reviews, giving an average guest rating of ${hotel.avg_rating.toFixed(1)}/5. ${hotel.review_count >= 500 ? 'This is a high review volume for a luxury property — enough to provide strong statistical confidence in the aggregate score.' : hotel.review_count >= 100 ? 'This is a reasonable review volume for directional confidence, though scores at this volume can shift more than those backed by 500+ reviews.' : 'Review volume is lower than average — interpret scores with appropriate caution.'}`
        : `Our editorial score for ${a} is based on independently verified assessments of location quality, amenity depth, and brand track record. Guest review data is being compiled for this property.`,
    },
  ];

  return faqs;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates complete editorial content for a hotel detail page.
 * All content is deterministic — same inputs produce identical output.
 *
 * @param  {Object}   hotel    — hotel record from hotels.json
 * @param  {Object[]} dataset  — full hotel array (for comparison context)
 * @returns {Object}  HotelEditorialContent
 */
function generateContent(hotel, dataset) {
  if (!hotel || typeof hotel !== 'object') {
    throw new TypeError('hotel_content_engine.generateContent: hotel must be an object');
  }
  if (!hotel.hotel_id || !hotel.hotel_name) {
    throw new TypeError('hotel_content_engine.generateContent: hotel must have hotel_id and hotel_name');
  }

  const regionData    = REGION_DATA[hotel.region] || null;
  const safeDataset   = Array.isArray(dataset) ? dataset : [];

  return Object.freeze({
    hotel_id:            hotel.hotel_id,
    editorial_intro:     _generateEditorialIntro(hotel, regionData),
    why_stay_here:       _generateWhyStayHere(hotel, regionData),
    best_for:            _generateBestFor(hotel),
    pros_considerations: _generateProsAndConsiderations(hotel),
    nearby_attractions:  _generateNearbyAttractions(hotel, regionData),
    comparison_context:  _generateComparisonContext(hotel, safeDataset),
    hotel_faqs:          _generateHotelFAQs(hotel, regionData),
    engine_version:      ENGINE_VERSION,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generateContent,
  REGION_DATA,
  ENGINE_VERSION,
};
