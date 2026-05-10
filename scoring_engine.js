/**
 * scoring_engine.js
 * Mauritius Resort Finder — Core Intelligence Module v1.0.0
 *
 * Stateless, deterministic scoring pipeline for Mauritius luxury resort ranking.
 * Accepts raw hotel records, produces persona-adjusted ranked arrays.
 *
 * Architecture position: Foundation layer. No upstream dependencies.
 * Downstream consumers: explanation_engine.js, block_assembler.js
 *
 * Design invariants:
 *   - Pure functions only. No side effects. No mutations of input.
 *   - Same input always produces identical output (deterministic).
 *   - No explanation generation. No UI logic. No formatting.
 *   - No external API calls. Runs entirely from input data.
 *
 * Score scales:
 *   - Input dimension scores:  0–10  (Airtable schema)
 *   - Intermediate normalized: 0–1   (internal only)
 *   - All output scores:       0–100 (human-readable)
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VERSIONING
// ─────────────────────────────────────────────────────────────────────────────

const SCORE_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// SCORING CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base dimension weights. Must sum to exactly 1.0.
 * These are the default weights before persona multipliers are applied.
 */
const BASE_DIMENSION_WEIGHTS = Object.freeze({
  overall_rating:   0.30,
  location_score:   0.20,
  amenity_score:    0.20,
  brand_score:      0.15,
  value_score:      0.10,
  affiliate_weight: 0.05,
});

/**
 * Blend ratio for final score composition.
 * IntentScore (persona-adjusted) dominates because persona fit
 * is the primary differentiator for a traveler-intent platform.
 */
const BLEND_BASE   = 0.35;
const BLEND_INTENT = 0.65;

/**
 * Bayesian confidence constants.
 * C: minimum review count before a hotel's raw rating is fully trusted.
 * M: prior mean — the expected rating for a hotel with no review history.
 */
const BAYESIAN_C = 50;    // reviews needed to "trust" rating fully
const BAYESIAN_M = 7.5;   // prior mean on 0–10 scale

/**
 * Blending ratio for Bayesian rating into overall_rating.
 * We use 70% editorial overall_rating (Airtable curated) and
 * 30% Bayesian-adjusted guest avg_rating (volume-weighted).
 */
const OVERALL_EDITORIAL_WEIGHT = 0.70;
const OVERALL_BAYESIAN_WEIGHT  = 0.30;

/**
 * Maximum affiliate commission rate considered "full value" for scoring.
 * Rates above this ceiling are treated as ceiling.
 * Example: a 15% commission hotel scores 10/10 on affiliate dimension.
 */
const MAX_AFFILIATE_COMMISSION = 0.15;

/**
 * Maximum amenity boost in raw points (sum of individual amenity values).
 * Applied before conversion to IntentScore points.
 */
const MAX_AMENITY_BOOST_RAW = 5.0;

/**
 * Maximum amenity boost added to IntentScore (0–100 scale).
 * A hotel with perfect amenity alignment gets +10 points.
 */
const MAX_AMENITY_BOOST_POINTS = 10.0;

/**
 * Minimum data completeness required for a hotel to appear in ranked output.
 * Hotels below this threshold are excluded with status 'insufficient_data'.
 */
const MIN_COMPLETENESS_PERCENT = 60;

/**
 * Maximum score delta (FinalRankingScore) allowed for a commission-aware swap.
 * Hotels more than 3 points apart are never swapped regardless of commission.
 */
const MAX_COMMISSION_SWAP_DELTA = 3.0;

/**
 * Tier boundaries for FinalRankingScore.
 * Commission-aware swaps are only permitted within the same tier.
 */
const SCORE_TIERS = Object.freeze([
  { tier: 1, min: 80,  label: 'exceptional'  },
  { tier: 2, min: 65,  label: 'strong'        },
  { tier: 3, min: 50,  label: 'adequate'      },
  { tier: 4, min: 0,   label: 'below_average' },
]);

// ─────────────────────────────────────────────────────────────────────────────
// FIELD DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Required fields. Hotel is 'invalid' if any of these are absent/null.
 */
const REQUIRED_FIELDS = Object.freeze([
  'hotel_id',
  'hotel_name',
  'overall_rating',
  'location_score',
  'amenity_score',
  'brand_score',
  'value_score',
  'review_count',
  'avg_rating',
]);

/**
 * Optional fields. Counted toward data completeness but not required.
 */
const OPTIONAL_FIELDS = Object.freeze([
  'affiliate_commission_rate',
  'amenities',
  'region',
  'price_per_night_usd',
  'star_rating',
  'property_type',
]);

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────
//
// Each persona defines:
//   dimension_weights  — multipliers on BASE_DIMENSION_WEIGHTS; result is renormalized
//   amenity_boosts     — { amenity_key: points } added if hotel.amenities[key] === true
//   exclusion_rules    — array of (hotel) => boolean functions; true = EXCLUDE this hotel
//   min_scores         — { field: number } minimum score thresholds to qualify
//
// Adding a new persona: add an entry here. No other code changes required.
// ─────────────────────────────────────────────────────────────────────────────

const PERSONA_CONFIGS = Object.freeze({

  honeymoon: {
    dimension_weights: {
      overall_rating:   1.2,
      location_score:   1.5,  // Romantic setting, beach proximity critical
      amenity_score:    1.3,
      brand_score:      1.1,
      value_score:      0.6,  // Honeymooners deprioritise price sensitivity
      affiliate_weight: 1.0,
    },
    amenity_boosts: {
      private_beach:    1.5,
      spa:              1.2,
      private_pool:     1.3,
      couples_dining:   1.0,
      butler_service:   0.8,
      sunset_views:     0.7,
      overwater_villa:  1.5,
    },
    exclusion_rules: [
      // Explicitly family-oriented hotels are not honeymoon destinations
      (hotel) => hotel.amenities?.adults_only === false && hotel.amenities?.family_kids_club === true,
    ],
    min_scores: {
      overall_rating: 7.0,
      location_score: 6.0,
    },
  },

  luxury: {
    dimension_weights: {
      overall_rating:   1.3,
      location_score:   1.1,
      amenity_score:    1.2,
      brand_score:      1.5,  // Brand prestige is the primary differentiator
      value_score:      0.5,  // Luxury travellers are not price-sensitive
      affiliate_weight: 1.0,
    },
    amenity_boosts: {
      butler_service:        1.5,
      private_pool:          1.2,
      fine_dining:           1.3,
      spa:                   1.0,
      private_beach:         1.1,
      helicopter_transfer:   0.8,
      overwater_villa:       1.2,
    },
    exclusion_rules: [
      // Minimum overall quality gate for luxury category
      (hotel) => hotel.overall_rating < 8.0,
    ],
    min_scores: {
      overall_rating: 8.0,
      brand_score:    7.0,
    },
  },

  family: {
    dimension_weights: {
      overall_rating:   1.0,
      location_score:   1.0,
      amenity_score:    1.5,  // Activities and facilities dominate
      brand_score:      0.8,
      value_score:      1.3,  // Families are more price-sensitive
      affiliate_weight: 1.0,
    },
    amenity_boosts: {
      kids_club:        1.8,
      family_pool:      1.5,
      childcare:        1.3,
      water_sports:     1.0,
      kids_dining:      0.8,
      babysitting:      0.7,
      playground:       0.6,
    },
    exclusion_rules: [
      // Adults-only properties excluded from family rankings
      (hotel) => hotel.amenities?.adults_only === true,
    ],
    min_scores: {
      amenity_score: 6.0,
    },
  },

  wellness: {
    dimension_weights: {
      overall_rating:   1.0,
      location_score:   1.2,
      amenity_score:    1.8,  // Spa/wellness facilities ARE the product
      brand_score:      0.7,
      value_score:      0.8,
      affiliate_weight: 1.0,
    },
    amenity_boosts: {
      spa:                  2.0,
      yoga:                 1.5,
      meditation:           1.3,
      healthy_dining:       1.2,
      fitness_centre:       1.0,
      wellness_programmes:  1.5,
      hydrotherapy:         1.0,
      naturopath:           0.8,
    },
    exclusion_rules: [
      // Hotel without spa cannot qualify as a wellness destination
      (hotel) => !hotel.amenities?.spa,
    ],
    min_scores: {
      amenity_score: 6.5,
    },
  },

  remote_work: {
    dimension_weights: {
      overall_rating:   0.9,
      location_score:   1.0,
      amenity_score:    1.4,  // Business-friendly amenities matter most
      brand_score:      0.8,
      value_score:      1.4,  // Long-stay cost sensitivity is high
      affiliate_weight: 1.0,
    },
    amenity_boosts: {
      high_speed_wifi:       2.0,
      dedicated_workspace:   1.8,
      co_working:            1.5,
      business_centre:       1.3,
      ergonomic_furniture:   1.0,
      meeting_rooms:         0.8,
      long_stay_discount:    1.2,
    },
    exclusion_rules: [
      // Cannot recommend a hotel confirmed to have no wifi
      (hotel) => hotel.amenities?.wifi_available === false,
    ],
    min_scores: {},
  },

  value_luxury: {
    dimension_weights: {
      overall_rating:   1.2,
      location_score:   1.1,
      amenity_score:    1.1,
      brand_score:      0.8,  // Brand prestige matters less for value seekers
      value_score:      2.0,  // Value is the defining dimension
      affiliate_weight: 1.0,
    },
    amenity_boosts: {
      all_inclusive:       1.5,
      breakfast_included:  1.2,
      free_water_sports:   1.0,
      free_shuttle:        0.8,
      happy_hour:          0.5,
      free_wifi:           0.6,
    },
    exclusion_rules: [],
    min_scores: {
      value_score: 6.0,
    },
  },

});

// ─────────────────────────────────────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a single hotel record against the required schema.
 *
 * @param  {*}      hotel — untrusted input
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateHotel(hotel) {
  const errors   = [];
  const warnings = [];

  if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)) {
    return { valid: false, errors: ['Hotel record must be a plain object'], warnings: [] };
  }

  // Required field presence
  for (const field of REQUIRED_FIELDS) {
    if (hotel[field] === undefined || hotel[field] === null) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // Stop early if any required fields are absent — further checks would throw
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // hotel_id: non-empty string
  if (typeof hotel.hotel_id !== 'string' || hotel.hotel_id.trim() === '') {
    errors.push('"hotel_id" must be a non-empty string');
  }

  // hotel_name: non-empty string
  if (typeof hotel.hotel_name !== 'string' || hotel.hotel_name.trim() === '') {
    errors.push('"hotel_name" must be a non-empty string');
  }

  // Numeric range checks for rating/score fields (expected 0–10)
  const scoreFields = {
    overall_rating: [0, 10],
    location_score: [0, 10],
    amenity_score:  [0, 10],
    brand_score:    [0, 10],
    value_score:    [0, 10],
    avg_rating:     [0, 10],
  };
  for (const [field, [lo, hi]] of Object.entries(scoreFields)) {
    const v = hotel[field];
    if (typeof v !== 'number' || isNaN(v)) {
      errors.push(`"${field}" must be a number, received: ${JSON.stringify(v)}`);
    } else if (v < lo || v > hi) {
      errors.push(`"${field}" out of range [${lo}, ${hi}]: ${v}`);
    }
  }

  // review_count: non-negative integer
  const rc = hotel.review_count;
  if (typeof rc !== 'number' || isNaN(rc) || rc < 0) {
    errors.push(`"review_count" must be a non-negative number, received: ${JSON.stringify(rc)}`);
  } else {
    if (!Number.isInteger(rc)) {
      warnings.push('"review_count" should be an integer; fractional value will be floored');
    }
    if (rc === 0) {
      warnings.push('"review_count" is 0 — Bayesian prior will dominate rating adjustment');
    }
  }

  // Optional fields — warn on bad type, do not error
  if (hotel.affiliate_commission_rate !== undefined && hotel.affiliate_commission_rate !== null) {
    const acr = hotel.affiliate_commission_rate;
    if (typeof acr !== 'number' || isNaN(acr) || acr < 0 || acr > 1) {
      warnings.push('"affiliate_commission_rate" should be a number between 0 and 1');
    }
  }
  if (hotel.amenities !== undefined && hotel.amenities !== null) {
    if (typeof hotel.amenities !== 'object' || Array.isArray(hotel.amenities)) {
      warnings.push('"amenities" should be a plain object of { key: boolean } pairs');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Computes data completeness as a percentage of all tracked fields that are
 * present and non-null. Hotels below MIN_COMPLETENESS_PERCENT are excluded.
 *
 * @param  {Object} hotel
 * @returns {number} percentage 0–100
 */
function computeDataCompleteness(hotel) {
  const allFields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
  let filled = 0;
  for (const field of allFields) {
    const v = hotel[field];
    if (v !== undefined && v !== null && v !== '') {
      filled++;
    }
  }
  return _roundTo((filled / allFields.length) * 100, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// BAYESIAN RATING ADJUSTMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies Bayesian average smoothing to a hotel's guest rating.
 * Prevents low-review-count hotels from dominating rankings with extreme ratings.
 *
 * Formula: bayesian = (n × r + C × m) / (n + C)
 *
 *   n — review count
 *   r — raw average rating (0–10)
 *   C — BAYESIAN_C (confidence threshold; 50 reviews)
 *   m — BAYESIAN_M (prior mean; 7.5)
 *
 * Behaviour:
 *   - 0 reviews  → returns exactly m (pure prior)
 *   - 50 reviews → returns midpoint between r and m
 *   - 500+ reviews → very close to r (prior has minimal influence)
 *
 * @param  {number} reviewCount
 * @param  {number} avgRating  — raw guest average (0–10)
 * @returns {number}            — Bayesian-adjusted rating (0–10)
 */
function computeBayesianRating(reviewCount, avgRating) {
  const n = Math.max(0, Math.floor(reviewCount || 0));
  const r = (typeof avgRating === 'number' && !isNaN(avgRating)) ? avgRating : BAYESIAN_M;
  return _roundTo((n * r + BAYESIAN_C * BAYESIAN_M) / (n + BAYESIAN_C), 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a value on a [0, scale] range to [0, 1].
 * Values below 0 clamp to 0; values above scale clamp to 1.
 *
 * @param  {number} value
 * @param  {number} [scale=10]
 * @returns {number}
 */
function _normalizeScore(value, scale = 10) {
  if (typeof value !== 'number' || isNaN(value)) return 0;
  return Math.max(0, Math.min(value / scale, 1));
}

/**
 * Converts an affiliate commission rate (0–1) to a 0–10 score.
 * No affiliate relationship → 0. MAX_AFFILIATE_COMMISSION → 10.
 *
 * @param  {number|undefined} commissionRate
 * @returns {number} affiliate score 0–10
 */
function _computeAffiliateScore(commissionRate) {
  if (typeof commissionRate !== 'number' || isNaN(commissionRate) || commissionRate <= 0) {
    return 0;
  }
  return Math.min(commissionRate / MAX_AFFILIATE_COMMISSION, 1) * 10;
}

/**
 * Rounds a number to N decimal places.
 * Uses factor-based rounding to mitigate floating-point imprecision.
 *
 * @param  {number} num
 * @param  {number} decimals
 * @returns {number}
 */
function _roundTo(num, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/**
 * Returns the scoring tier for a FinalRankingScore.
 *
 * Tier 1 — exceptional   (≥ 80)
 * Tier 2 — strong        (≥ 65)
 * Tier 3 — adequate      (≥ 50)
 * Tier 4 — below_average (< 50)
 *
 * @param  {number} score — 0–100
 * @returns {{ tier: number, label: string }}
 */
function getTier(score) {
  for (const entry of SCORE_TIERS) {
    if (score >= entry.min) {
      return { tier: entry.tier, label: entry.label };
    }
  }
  return { tier: 4, label: 'below_average' };
}

/**
 * Computes the raw dimension scores object (normalized 0–1) for a hotel.
 * This object is used by both BaseScore and IntentScore computations.
 *
 * @param  {Object} hotel
 * @param  {number} bayesianRating — precomputed Bayesian-adjusted rating (0–10)
 * @returns {Object} { overall_rating, location_score, amenity_score, brand_score, value_score, affiliate_weight }
 */
function _computeRawDimensionScores(hotel, bayesianRating) {
  const blendedOverall = (hotel.overall_rating * OVERALL_EDITORIAL_WEIGHT)
                       + (bayesianRating       * OVERALL_BAYESIAN_WEIGHT);
  const affiliateScore = _computeAffiliateScore(hotel.affiliate_commission_rate);

  return {
    overall_rating:   _normalizeScore(blendedOverall),
    location_score:   _normalizeScore(hotel.location_score),
    amenity_score:    _normalizeScore(hotel.amenity_score),
    brand_score:      _normalizeScore(hotel.brand_score),
    value_score:      _normalizeScore(hotel.value_score),
    affiliate_weight: _normalizeScore(affiliateScore),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE SCORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes BaseScore using fixed BASE_DIMENSION_WEIGHTS.
 * Persona-agnostic. Represents overall hotel quality across all traveler types.
 *
 * BaseScore = Σ (normalized_dimension × base_weight) × 100
 *
 * @param  {Object} hotel          — validated hotel record
 * @param  {number} bayesianRating — precomputed Bayesian-adjusted rating
 * @returns {{
 *   base_score:        number,   // 0–100
 *   dimension_scores:  Object,   // each dimension on 0–10 scale for readability
 *   bayesian_rating:   number,   // 0–10
 * }}
 */
function computeBaseScore(hotel, bayesianRating) {
  const raw = _computeRawDimensionScores(hotel, bayesianRating);

  const baseScore = (
    raw.overall_rating   * BASE_DIMENSION_WEIGHTS.overall_rating   +
    raw.location_score   * BASE_DIMENSION_WEIGHTS.location_score   +
    raw.amenity_score    * BASE_DIMENSION_WEIGHTS.amenity_score    +
    raw.brand_score      * BASE_DIMENSION_WEIGHTS.brand_score      +
    raw.value_score      * BASE_DIMENSION_WEIGHTS.value_score      +
    raw.affiliate_weight * BASE_DIMENSION_WEIGHTS.affiliate_weight
  ) * 100;

  // Return dimension_scores on 0–10 scale (raw × 10) for downstream readability
  return {
    base_score: _roundTo(baseScore, 4),
    dimension_scores: {
      overall_rating:   _roundTo(raw.overall_rating   * 10, 4),
      location_score:   _roundTo(raw.location_score   * 10, 4),
      amenity_score:    _roundTo(raw.amenity_score    * 10, 4),
      brand_score:      _roundTo(raw.brand_score      * 10, 4),
      value_score:      _roundTo(raw.value_score      * 10, 4),
      affiliate_weight: _roundTo(raw.affiliate_weight * 10, 4),
    },
    bayesian_rating: _roundTo(bayesianRating, 4),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies persona multipliers to BASE_DIMENSION_WEIGHTS, then renormalizes
 * so the resulting weights still sum to 1.0.
 *
 * This preserves the weighting architecture: the multipliers shift emphasis
 * without inflating or deflating the scoring scale.
 *
 * @param  {string} persona
 * @returns {Object} normalized persona dimension weights (sum = 1.0)
 */
function computePersonaWeights(persona) {
  const config = PERSONA_CONFIGS[persona];
  if (!config) throw new TypeError(`Unknown persona: "${persona}". Valid: ${Object.keys(PERSONA_CONFIGS).join(', ')}`);

  const multipliers = config.dimension_weights;
  const rawWeights  = {};
  for (const [dim, baseWeight] of Object.entries(BASE_DIMENSION_WEIGHTS)) {
    rawWeights[dim] = baseWeight * (multipliers[dim] !== undefined ? multipliers[dim] : 1.0);
  }

  const total = Object.values(rawWeights).reduce((s, w) => s + w, 0);
  // Guard: if all multipliers somehow reduced every weight to zero, dividing
  // by total would produce NaN and silently corrupt every downstream score.
  if (total === 0) {
    throw new RangeError(
      `computePersonaWeights: total weight is zero for persona "${persona}". ` +
      'Check that dimension_weights multipliers are not all zero.',
    );
  }
  const normalized = {};
  for (const [dim, w] of Object.entries(rawWeights)) {
    normalized[dim] = w / total;
  }
  return normalized;
}

/**
 * Computes the amenity boost for a hotel under a specific persona.
 *
 * Each matching amenity contributes its configured boost value.
 * Total is capped at MAX_AMENITY_BOOST_RAW to prevent gaming.
 *
 * @param  {Object} hotel
 * @param  {string} persona
 * @returns {number} raw boost total (0 to MAX_AMENITY_BOOST_RAW)
 */
function computeAmenityBoost(hotel, persona) {
  const config   = PERSONA_CONFIGS[persona];
  const amenities = (typeof hotel.amenities === 'object' && hotel.amenities !== null)
    ? hotel.amenities
    : {};

  let total = 0;
  for (const [key, boostValue] of Object.entries(config.amenity_boosts || {})) {
    if (amenities[key] === true) {
      total += boostValue;
    }
  }
  return Math.min(total, MAX_AMENITY_BOOST_RAW);
}

/**
 * Checks whether a hotel passes all exclusion rules and minimum score
 * thresholds for a persona.
 *
 * @param  {Object} hotel
 * @param  {string} persona
 * @returns {{ passes: boolean, reason: string|null }}
 */
function checkPersonaExclusions(hotel, persona) {
  const config = PERSONA_CONFIGS[persona];

  for (let i = 0; i < config.exclusion_rules.length; i++) {
    try {
      if (config.exclusion_rules[i](hotel)) {
        return {
          passes: false,
          reason: `Failed exclusion rule #${i + 1} for persona "${persona}"`,
        };
      }
    } catch (_) {
      // Exclusion rule threw (e.g. accessing amenities on null). Treat as non-excluded.
    }
  }

  for (const [field, minScore] of Object.entries(config.min_scores || {})) {
    const val = hotel[field];
    if (typeof val === 'number' && !isNaN(val) && val < minScore) {
      return {
        passes: false,
        reason: `"${field}" score ${val} is below persona minimum of ${minScore} for "${persona}"`,
      };
    }
  }

  return { passes: true, reason: null };
}

/**
 * Computes IntentScore: the persona-adjusted relevance score for a hotel.
 *
 * IntentScore = (persona-weighted dimension sum × 100) + amenity boost points
 *             = capped at 100
 *
 * Amenity boost conversion: raw_boost (0–5) → points (0–10) via × 2 multiplier.
 *
 * @param  {Object} hotel
 * @param  {string} persona
 * @param  {number} bayesianRating — precomputed
 * @returns {number} IntentScore 0–100
 */
function computeIntentScore(hotel, persona, bayesianRating) {
  const personaWeights = computePersonaWeights(persona);
  const raw            = _computeRawDimensionScores(hotel, bayesianRating);

  let weightedScore = 0;
  for (const [dim, weight] of Object.entries(personaWeights)) {
    weightedScore += (raw[dim] || 0) * weight;
  }

  const intentBase   = weightedScore * 100;
  const rawBoost     = computeAmenityBoost(hotel, persona);
  const boostPoints  = rawBoost * (MAX_AMENITY_BOOST_POINTS / MAX_AMENITY_BOOST_RAW);
  const intentScore  = Math.min(intentBase + boostPoints, 100);

  return _roundTo(intentScore, 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL RANKING SCORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blends BaseScore and IntentScore into FinalRankingScore.
 *
 * FinalRankingScore = BaseScore × 0.35 + IntentScore × 0.65
 *
 * IntentScore dominates because the platform is traveler-intent-first:
 * the right hotel for this persona matters more than generic quality.
 *
 * @param  {number} baseScore    — 0–100
 * @param  {number} intentScore  — 0–100
 * @returns {number}              — 0–100
 */
function computeFinalRankingScore(baseScore, intentScore) {
  return _roundTo((baseScore * BLEND_BASE) + (intentScore * BLEND_INTENT), 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMISSION-AWARE POSITION ADJUSTMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies a single commission-aware position swap after scoring.
 *
 * Rules (all must be satisfied for a swap to occur):
 *   1. Adjacent hotels must be in the same scoring tier.
 *   2. Score delta between adjacent hotels must be ≤ MAX_COMMISSION_SWAP_DELTA (3 pts).
 *   3. The lower-ranked hotel must have a higher affiliate commission rate.
 *   4. Maximum one swap per ranking operation.
 *
 * This means affiliate commission can move a hotel at most ±1 position,
 * only within its tier, and only if the quality difference is negligible.
 * It never corrupts rankings across meaningful quality boundaries.
 *
 * @param  {Object[]} rankedHotels — already sorted by FinalRankingScore (descending)
 * @returns {Object[]} adjusted array (new array; input not mutated)
 */
function applyCommissionAdjustment(rankedHotels) {
  const hotels   = rankedHotels.slice(); // shallow copy — do not mutate input
  let swapMade   = false;

  for (let i = 0; i < hotels.length - 1 && !swapMade; i++) {
    const current = hotels[i];
    const next    = hotels[i + 1];

    const currentTier = getTier(current.scores.final_ranking_score).tier;
    const nextTier    = getTier(next.scores.final_ranking_score).tier;
    if (currentTier !== nextTier) continue;

    const delta           = Math.abs(current.scores.final_ranking_score - next.scores.final_ranking_score);
    if (delta > MAX_COMMISSION_SWAP_DELTA) continue;

    const currentCommission = current.hotel.affiliate_commission_rate || 0;
    const nextCommission    = next.hotel.affiliate_commission_rate    || 0;
    if (nextCommission <= currentCommission) continue;

    // Perform swap — annotate both entries
    hotels[i]     = { ...next,    commission_adjusted: true,  original_rank: i + 2 };
    hotels[i + 1] = { ...current, commission_adjusted: false, original_rank: i + 1 };
    swapMade      = true;
  }

  return hotels;
}

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC SORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sorts scored hotel results deterministically.
 *
 * Sort order (evaluated in sequence):
 *   1. final_ranking_score — descending  (primary: best hotel first)
 *   2. base_score          — descending  (tiebreaker: inherent quality)
 *   3. hotel_id            — ascending   (lexicographic; guarantees identical output
 *                                         for identical input regardless of JS engine)
 *
 * @param  {Object[]} scoredHotels
 * @returns {Object[]} new sorted array
 */
function _deterministicSort(scoredHotels) {
  return scoredHotels.slice().sort((a, b) => {
    // 1. Final ranking score (descending)
    const fDiff = b.scores.final_ranking_score - a.scores.final_ranking_score;
    if (fDiff !== 0) return fDiff;

    // 2. Base score (descending)
    const bDiff = b.scores.base_score - a.scores.base_score;
    if (bDiff !== 0) return bDiff;

    // 3. Hotel ID (ascending lexicographic) — deterministic tiebreaker
    return a.hotel_id < b.hotel_id ? -1 : a.hotel_id > b.hotel_id ? 1 : 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE HOTEL SCORER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scores a single hotel for a given persona.
 *
 * Returns a ScoredHotel object regardless of outcome.
 * Check `result.scored` to determine if the hotel qualified.
 *
 * @param  {*}      hotel   — raw hotel record (untrusted)
 * @param  {string} persona
 * @returns {ScoredHotel}
 */
function scoreHotel(hotel, persona) {
  if (!PERSONA_CONFIGS[persona]) {
    throw new TypeError(`scoreHotel: unknown persona "${persona}". Valid: ${Object.keys(PERSONA_CONFIGS).join(', ')}`);
  }

  // ── 1. Validate input ────────────────────────────────────────────────────
  const validation = validateHotel(hotel);
  if (!validation.valid) {
    return {
      hotel_id:   hotel?.hotel_id   || null,
      hotel_name: hotel?.hotel_name || null,
      persona,
      status:     'invalid',
      scored:     false,
      errors:     validation.errors,
      warnings:   validation.warnings,
      scores:     null,
      dimension_scores: null,
      tier:       null,
      completeness_percent: null,
      commission_adjusted: false,
      original_rank: null,
      score_version: SCORE_VERSION,
      hotel,
    };
  }

  // ── 2. Data completeness gate ─────────────────────────────────────────────
  const completeness = computeDataCompleteness(hotel);
  if (completeness < MIN_COMPLETENESS_PERCENT) {
    return {
      hotel_id:   hotel.hotel_id,
      hotel_name: hotel.hotel_name,
      persona,
      status:     'insufficient_data',
      scored:     false,
      errors:     [`Data completeness ${completeness}% is below minimum ${MIN_COMPLETENESS_PERCENT}%`],
      warnings:   validation.warnings,
      scores:     null,
      dimension_scores: null,
      tier:       null,
      completeness_percent: completeness,
      commission_adjusted: false,
      original_rank: null,
      score_version: SCORE_VERSION,
      hotel,
    };
  }

  // ── 3. Persona exclusion gate ─────────────────────────────────────────────
  const exclusion = checkPersonaExclusions(hotel, persona);
  if (!exclusion.passes) {
    return {
      hotel_id:   hotel.hotel_id,
      hotel_name: hotel.hotel_name,
      persona,
      status:     'excluded',
      scored:     false,
      errors:     [exclusion.reason],
      warnings:   validation.warnings,
      scores:     null,
      dimension_scores: null,
      tier:       null,
      completeness_percent: completeness,
      commission_adjusted: false,
      original_rank: null,
      score_version: SCORE_VERSION,
      hotel,
    };
  }

  // ── 4. Compute scores ─────────────────────────────────────────────────────
  const bayesianRating = computeBayesianRating(hotel.review_count, hotel.avg_rating);
  const { base_score, dimension_scores } = computeBaseScore(hotel, bayesianRating);
  const intent_score   = computeIntentScore(hotel, persona, bayesianRating);
  const final_ranking_score = computeFinalRankingScore(base_score, intent_score);
  const tier           = getTier(final_ranking_score);

  return {
    hotel_id:   hotel.hotel_id,
    hotel_name: hotel.hotel_name,
    persona,
    status:     'scored',
    scored:     true,
    errors:     [],
    warnings:   validation.warnings,
    scores: {
      base_score,
      intent_score,
      final_ranking_score,
      bayesian_rating: _roundTo(bayesianRating, 4),
    },
    dimension_scores,
    tier,
    completeness_percent: completeness,
    commission_adjusted: false,
    original_rank: null,
    score_version: SCORE_VERSION,
    hotel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RANKING FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scores and ranks an array of hotels for a given traveler persona.
 *
 * Pipeline:
 *   1. Validate each hotel
 *   2. Score each hotel (BaseScore + IntentScore → FinalRankingScore)
 *   3. Filter out non-scored hotels (invalid / insufficient_data / excluded)
 *   4. Sort deterministically (FinalRankingScore → BaseScore → hotel_id)
 *   5. Assign rank numbers
 *   6. Apply commission-aware position adjustment (optional; default: true)
 *   7. Re-assign final rank numbers
 *
 * @param  {Array}  hotels  — raw hotel records from Airtable or JSON
 * @param  {string} persona — one of: honeymoon, luxury, family, wellness, remote_work, value_luxury
 * @param  {Object} [options]
 * @param  {boolean} [options.includeExcluded=false]          — include non-scored hotels in output
 * @param  {boolean} [options.applyCommissionAdjustment=true] — allow single commission-aware swap
 *
 * @returns {RankingResult}
 */
function rankHotels(hotels, persona, options = {}) {
  // ── Guard inputs ──────────────────────────────────────────────────────────
  if (!Array.isArray(hotels)) {
    throw new TypeError('rankHotels: first argument must be an array of hotel records');
  }
  if (!PERSONA_CONFIGS[persona]) {
    throw new TypeError(`rankHotels: unknown persona "${persona}". Valid: ${Object.keys(PERSONA_CONFIGS).join(', ')}`);
  }

  const {
    includeExcluded           = false,
    applyCommissionAdjustment = true,
  } = options;

  // ── Score all ─────────────────────────────────────────────────────────────
  const allResults = hotels.map((h) => scoreHotel(h, persona));

  const scored   = allResults.filter((r) => r.scored === true);
  const rejected = allResults.filter((r) => r.scored !== true);

  // ── Sort deterministically ────────────────────────────────────────────────
  const sorted = _deterministicSort(scored);

  // ── Assign initial ranks ──────────────────────────────────────────────────
  const ranked = sorted.map((result, i) => ({
    ...result,
    rank:          i + 1,
    original_rank: i + 1,
  }));

  // ── Commission-aware adjustment ───────────────────────────────────────────
  const adjusted = applyCommissionAdjustment
    ? applyCommissionAdjustment_(ranked)
    : ranked;

  // ── Final rank assignment ─────────────────────────────────────────────────
  const finalRanked = adjusted.map((result, i) => ({
    ...result,
    rank: i + 1,
  }));

  return {
    persona,
    ranked_hotels:   finalRanked,
    rejected_hotels: includeExcluded ? rejected : [],
    summary: {
      total_input:       hotels.length,
      total_scored:      scored.length,
      total_excluded:    rejected.filter((r) => r.status === 'excluded').length,
      total_insufficient: rejected.filter((r) => r.status === 'insufficient_data').length,
      total_invalid:     rejected.filter((r) => r.status === 'invalid').length,
      score_version:     SCORE_VERSION,
    },
    score_version: SCORE_VERSION,
  };
}

// Internal alias to avoid name collision with option parameter
const applyCommissionAdjustment_ = applyCommissionAdjustment;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns array of valid persona keys. Used by downstream modules for validation.
 * @returns {string[]}
 */
function getPersonas() {
  return Object.keys(PERSONA_CONFIGS);
}

/**
 * Returns a snapshot of the scoring configuration.
 * Used for audit trails, score version control, and debug output.
 * @returns {Object}
 */
function getScoringConfig() {
  return {
    score_version:            SCORE_VERSION,
    base_dimension_weights:   { ...BASE_DIMENSION_WEIGHTS },
    blend_base:               BLEND_BASE,
    blend_intent:             BLEND_INTENT,
    bayesian_c:               BAYESIAN_C,
    bayesian_m:               BAYESIAN_M,
    max_affiliate_commission: MAX_AFFILIATE_COMMISSION,
    max_amenity_boost_points: MAX_AMENITY_BOOST_POINTS,
    min_completeness_percent: MIN_COMPLETENESS_PERCENT,
    max_commission_swap_delta: MAX_COMMISSION_SWAP_DELTA,
    personas:                 Object.keys(PERSONA_CONFIGS),
    tier_boundaries:          SCORE_TIERS.map((t) => ({ ...t })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Primary API ────────────────────────────────────────────────────────────
  rankHotels,
  scoreHotel,

  // ── Atomic functions (exported for unit testing) ───────────────────────────
  validateHotel,
  computeDataCompleteness,
  computeBayesianRating,
  computeBaseScore,
  computePersonaWeights,
  computeAmenityBoost,
  checkPersonaExclusions,
  computeIntentScore,
  computeFinalRankingScore,
  applyCommissionAdjustment,
  getTier,

  // ── Config accessors ───────────────────────────────────────────────────────
  getPersonas,
  getScoringConfig,

  // ── Constants (for downstream modules) ────────────────────────────────────
  SCORE_VERSION,
  BASE_DIMENSION_WEIGHTS,
  PERSONA_CONFIGS,
  BAYESIAN_C,
  BAYESIAN_M,
  BLEND_BASE,
  BLEND_INTENT,
  MIN_COMPLETENESS_PERCENT,
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPE DOCUMENTATION
// ─────────────────────────────────────────────────────────────────────────────
//
// HotelRecord (input):
// {
//   hotel_id:                 string,   // REQUIRED — unique identifier
//   hotel_name:               string,   // REQUIRED
//   overall_rating:           number,   // REQUIRED — 0–10 editorial score
//   location_score:           number,   // REQUIRED — 0–10
//   amenity_score:            number,   // REQUIRED — 0–10
//   brand_score:              number,   // REQUIRED — 0–10
//   value_score:              number,   // REQUIRED — 0–10
//   review_count:             number,   // REQUIRED — integer ≥ 0
//   avg_rating:               number,   // REQUIRED — 0–10 guest average
//   affiliate_commission_rate: number,  // optional — 0–1 (e.g. 0.08 = 8%)
//   amenities:                Object,   // optional — { key: boolean }
//   region:                   string,   // optional
//   price_per_night_usd:      number,   // optional
//   star_rating:              number,   // optional
//   property_type:            string,   // optional
// }
//
// ScoredHotel (output from scoreHotel):
// {
//   hotel_id:            string,
//   hotel_name:          string,
//   persona:             string,
//   status:              'scored' | 'invalid' | 'insufficient_data' | 'excluded',
//   scored:              boolean,
//   errors:              string[],
//   warnings:            string[],
//   scores: {
//     base_score:            number,  // 0–100
//     intent_score:          number,  // 0–100
//     final_ranking_score:   number,  // 0–100
//     bayesian_rating:       number,  // 0–10
//   } | null,
//   dimension_scores: {
//     overall_rating:   number,  // 0–10
//     location_score:   number,
//     amenity_score:    number,
//     brand_score:      number,
//     value_score:      number,
//     affiliate_weight: number,
//   } | null,
//   tier:                { tier: number, label: string } | null,
//   completeness_percent: number | null,
//   commission_adjusted:  boolean,
//   original_rank:        number | null,
//   rank:                 number,        // set by rankHotels
//   score_version:        string,
//   hotel:                HotelRecord,   // reference to original input
// }
//
// RankingResult (output from rankHotels):
// {
//   persona:          string,
//   ranked_hotels:    ScoredHotel[],   // sorted, ranked, scored only
//   rejected_hotels:  ScoredHotel[],   // empty unless includeExcluded = true
//   summary: {
//     total_input:        number,
//     total_scored:       number,
//     total_excluded:     number,
//     total_insufficient: number,
//     total_invalid:      number,
//     score_version:      string,
//   },
//   score_version: string,
// }
