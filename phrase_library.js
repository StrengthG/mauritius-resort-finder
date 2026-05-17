/**
 * phrase_library.js
 * Mauritius Resort Finder — Explanation Engine, Module 1 of 4
 * Version: 1.0.0
 *
 * Single source of all text-generating functions used in explanation generation.
 * This module holds no business logic and makes no decisions.
 * It is a structured lookup system: given (dimension, type, score_band, context),
 * return the single most contextually appropriate PhraseEntry, or null.
 *
 * Architecture position: Layer 3 — Explanation Engine foundation.
 * Upstream: explanation_engine.js (calls PhraseLibrary.get)
 * Downstream: hallucination_guard.js (validates rendered phrases via claim_source_field)
 * No dependencies on any other intelligence module.
 *
 * Design invariants:
 *   - Template functions are pure: (hotel) => string | null. No side effects.
 *   - requires[] declares every hotel field the template reads. Incomplete list = audit failure.
 *   - Missing required fields are suppressed by the CALLER — never produce fallback text.
 *   - produces_claim: true requires a non-null claim_source_field, always.
 *   - Boot-time validation throws if the registry has schema violations. The app must not start.
 *   - Same inputs always produce identical outputs (deterministic).
 *
 * Score band mapping (0–100 scale):
 *   '90-100'  →  ≥ 90          (exceptional)
 *   '80-89'   →  80–89.99      (strong)
 *   '70-79'   →  70–79.99      (good)
 *   '60-69'   →  60–69.99      (adequate)
 *   '50-59'   →  50–59.99      (below average)
 *   '35-49'   →  35–49.99      (weak)
 *   '0-34'    →  0–34.99       (very weak)
 *
 * HotelRecord shape (bound, post-DataBinder):
 *   hotel_id, name, region, brand, brand_tier,
 *   rank, final_ranking_score, base_score, intent_score,
 *   score_breakdown: { overall_score, location_score, amenity_score, brand_score, value_score, affiliate_score },
 *   all_persona_scores: { honeymoon, luxury, family, wellness, remote_work, value_luxury },
 *   avg_rating (0–5), review_count,
 *   amenity_flags: { beachfront, has_spa, spa_award_rated, private_pool_villa, kids_club,
 *                    all_inclusive, adults_only, overwater_bungalow, butler_service,
 *                    high_speed_wifi, dedicated_workspace, long_stay_rates,
 *                    restaurant_count, pool_count },
 *   avg_nightly_rate, avg_nightly_rate_currency,
 *   affiliate_score, has_active_affiliate,
 *   data_completeness_pct, score_version, confidence, badge
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PHRASE_LIBRARY_VERSION = '1.0.0';

/** Valid dimension keys. Must match scoring_engine.js dimension names (translated to 0–100 scale). */
const DIMENSION_KEYS = Object.freeze([
  'overall_score',
  'location_score',
  'amenity_score',
  'brand_score',
  'value_score',
]);

/** Valid phrase type keys. */
const PHRASE_TYPES = Object.freeze([
  'strength',
  'weakness',
  'fit_positive',
  'fit_negative',
  'tradeoff',
]);

/** Valid score bands. Non-overlapping, collectively exhaustive from 0–100. */
const SCORE_BANDS = Object.freeze([
  '90-100',
  '80-89',
  '70-79',
  '60-69',
  '50-59',
  '35-49',
  '0-34',
]);

/** Valid claim types for hallucination_guard compatibility. */
const CLAIM_TYPES = Object.freeze([
  'numeric',
  'boolean',
  'comparative',
  'descriptive',
]);

/** Valid persona keys (mirrors scoring_engine.js PERSONA_CONFIGS). */
const PERSONA_KEYS = Object.freeze([
  'honeymoon',
  'luxury',
  'family',
  'wellness',
  'remote_work',
  'value_luxury',
  'budget',
]);

/**
 * Review volume tier thresholds.
 * Used to classify hotels by review confidence in context matching.
 */
const REVIEW_VOLUME_THRESHOLDS = Object.freeze({
  high:         200,   // ≥ 200 reviews
  medium:        50,   // 50–199
  low:           10,   // 10–49
  insufficient:   0,   // < 10 (prior dominates entirely)
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

class PhraseLibraryInitializationError extends Error {
  constructor(report) {
    super(`PhraseLibrary failed boot validation: ${report.errors.length} error(s). ` +
      report.errors.map(e => `[${e.phrase_id || e.key}] ${e.issue}`).join('; '));
    this.name  = 'PhraseLibraryInitializationError';
    this.report = report;
  }
}

class InvalidLookupKeyError extends Error {
  constructor(message, key) {
    super(`InvalidLookupKeyError: ${message}`);
    this.name = 'InvalidLookupKeyError';
    this.key  = key;
  }
}

class InvalidScoreBandError extends Error {
  constructor(band) {
    super(`InvalidScoreBandError: "${band}" is not a valid score band. Valid: ${SCORE_BANDS.join(', ')}`);
    this.name = 'InvalidScoreBandError';
  }
}

class InvalidDimensionError extends Error {
  constructor(dim) {
    super(`InvalidDimensionError: "${dim}" is not a valid dimension. Valid: ${DIMENSION_KEYS.join(', ')}`);
    this.name = 'InvalidDimensionError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a 0–100 score to its corresponding ScoreBand string.
 * Scores are clamped: < 0 → '0-34', > 100 → '90-100'.
 *
 * @param  {number} score
 * @returns {string} ScoreBand
 */
function _getScoreBand(score) {
  if (typeof score !== 'number' || isNaN(score)) return '0-34';
  if (score >= 90) return '90-100';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  if (score >= 60) return '60-69';
  if (score >= 50) return '50-59';
  if (score >= 35) return '35-49';
  return '0-34';
}

/**
 * Classifies review count into a review volume tier.
 *
 * @param  {number|null} reviewCount
 * @returns {'high'|'medium'|'low'|'insufficient'}
 */
function _getReviewVolumeTier(reviewCount) {
  if (!reviewCount || reviewCount < REVIEW_VOLUME_THRESHOLDS.low)       return 'insufficient';
  if (reviewCount < REVIEW_VOLUME_THRESHOLDS.medium)                     return 'low';
  if (reviewCount < REVIEW_VOLUME_THRESHOLDS.high)                       return 'medium';
  return 'high';
}

/**
 * Resolves a dot-notation path against a hotel record.
 * Returns undefined if any segment along the path is missing.
 *
 * @param  {string}  path  — e.g. 'amenity_flags.beachfront', 'score_breakdown.overall_score'
 * @param  {Object}  hotel
 * @returns {*}
 */
function _resolveField(path, hotel) {
  return path.split('.').reduce((obj, key) => {
    if (obj === null || obj === undefined) return undefined;
    return obj[key];
  }, hotel);
}

/**
 * Checks all required fields are present and non-null on the hotel record.
 * Returns array of missing field paths (empty array = all present).
 *
 * @param  {string[]} requires
 * @param  {Object}   hotel
 * @returns {string[]} missing paths
 */
function _checkRequires(requires, hotel) {
  return requires.filter(path => {
    const val = _resolveField(path, hotel);
    return val === undefined || val === null;
  });
}

/**
 * Scores how well a PhraseEntry's context_match aligns with a lookup context.
 * Returns 0–100. Higher = better match.
 *
 * Scoring rules:
 *   - For each key in context_match: +20 if lookup context contains same key with same value.
 *   - For each key in context_match: -5 if lookup context contains same key with different value.
 *   - For each key in context_match that is absent from lookup context: -3 (specificity penalty).
 *     This ensures the generic fallback (empty context_match, score = 0) is always preferred
 *     over a specific entry whose conditions were not requested.
 *   - Entries with empty context_match score 0 (generic fallback — wins over all unmatched specific entries).
 *
 * @param  {Object} entryContext  — the PhraseEntry's context_match
 * @param  {Object} lookupContext — the requested lookup context
 * @returns {number} match score 0–100
 */
function _scoreContextMatch(entryContext, lookupContext) {
  if (!entryContext || Object.keys(entryContext).length === 0) return 0;
  let score = 0;
  for (const [key, expectedVal] of Object.entries(entryContext)) {
    if (!(key in lookupContext)) {
      score -= 3;  // specificity penalty: entry declares a condition not present in the request
    } else if (lookupContext[key] === expectedVal) {
      score += 20; // exact match: this entry was designed for this context
    } else {
      score -= 5;  // conflict: entry requires a different value for this key
    }
  }
  return Math.max(-100, Math.min(score, 100));
}

/**
 * Formats a USD price for display. Returns null if value is not a valid positive number.
 *
 * @param  {number|null} value
 * @returns {string|null}
 */
function _formatUSD(value) {
  if (typeof value !== 'number' || isNaN(value) || value <= 0) return null;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Formats a numeric score to one decimal place for display.
 *
 * @param  {number} value
 * @returns {string}
 */
function _fmt1(value) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHRASE REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// Each PhraseEntry:
// {
//   phrase_id:          string,            — unique across entire registry
//   dimension:          DimensionKey,
//   type:               PhraseType,
//   score_band:         ScoreBand,
//   context_match:      Object,            — conditions for this variant (empty = generic)
//   template:           (hotel) => string | null,  — null = conditional suppression
//   requires:           string[],          — hotel field paths; missing → suppress
//   produces_claim:     boolean,
//   claim_source_field: string | null,
//   claim_type:         ClaimType,
// }
//
// ─────────────────────────────────────────────────────────────────────────────

const PHRASE_REGISTRY = [

  // ═══════════════════════════════════════════════════════════════════════════
  // DIMENSION: overall_score — STRENGTHS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'OS_STR_90_HIGH_REVIEW',
    dimension:          'overall_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      { review_volume_tier: 'high' },
    requires:           ['avg_rating', 'review_count', 'score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'avg_rating',
    claim_type:         'numeric',
    template: (h) => {
      const count   = h.review_count.toLocaleString('en-US');
      const rating  = _fmt1(h.avg_rating);
      const overall = Math.round(h.score_breakdown.overall_score);
      return `${rating}/5 guest average sustained across ${count} verified reviews (overall score: ${overall}/100) — ` +
        `statistical confidence is high; this review record ranks among the strongest in the Mauritius luxury inventory.`;
    },
  },

  {
    phrase_id:          'OS_STR_90_GENERIC',
    dimension:          'overall_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      {},
    requires:           ['score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'numeric',
    template: (h) => {
      const overall = Math.round(h.score_breakdown.overall_score);
      return `Overall quality score: ${overall}/100 — exceptional across all assessed dimensions. ` +
        `Exceeds the Mauritius luxury segment mean by a statistically significant margin.`;
    },
  },

  {
    phrase_id:          'OS_STR_80_HIGH_REVIEW',
    dimension:          'overall_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      { review_volume_tier: 'high' },
    requires:           ['avg_rating', 'review_count', 'score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'avg_rating',
    claim_type:         'numeric',
    template: (h) => {
      const count   = h.review_count.toLocaleString('en-US');
      const rating  = _fmt1(h.avg_rating);
      const overall = Math.round(h.score_breakdown.overall_score);
      return `${rating}/5 across ${count} verified reviews (overall score: ${overall}/100). ` +
        `Strong volume-backed rating — above the segment median with meaningful statistical confidence.`;
    },
  },

  {
    phrase_id:          'OS_STR_80_GENERIC',
    dimension:          'overall_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      {},
    requires:           ['score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'comparative',
    template: (h) => {
      const overall = Math.round(h.score_breakdown.overall_score);
      return `Overall score ${overall}/100 — above the Mauritius luxury segment median (~72). ` +
        `Consistent performance across editorial quality and guest experience benchmarks.`;
    },
  },

  {
    phrase_id:          'OS_STR_70_GENERIC',
    dimension:          'overall_score',
    type:               'strength',
    score_band:         '70-79',
    context_match:      {},
    requires:           ['score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'numeric',
    template: (h) => {
      const overall = Math.round(h.score_breakdown.overall_score);
      return `Overall score: ${overall}/100. Competent across assessed dimensions — no exceptional highs, ` +
        `but no critical failures. Meets the threshold for inclusion in ranked output.`;
    },
  },

  // ─── overall_score WEAKNESSES ─────────────────────────────────────────────

  {
    phrase_id:          'OS_WK_60_GENERIC',
    dimension:          'overall_score',
    type:               'weakness',
    score_band:         '60-69',
    context_match:      {},
    requires:           ['score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'comparative',
    template: (h) => {
      const overall = Math.round(h.score_breakdown.overall_score);
      return `Overall score ${overall}/100 — below the segment median (~72). ` +
        `Adequate performance, but at least one dimension underperforms peers by a measurable margin.`;
    },
  },

  {
    phrase_id:          'OS_WK_50_GENERIC',
    dimension:          'overall_score',
    type:               'weakness',
    score_band:         '50-59',
    context_match:      {},
    requires:           ['score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'comparative',
    template: (h) => {
      const overall = Math.round(h.score_breakdown.overall_score);
      return `Overall score of ${overall}/100 is in the below-average range for this inventory. ` +
        `Positioned for value-focused consideration — not appropriate as a prestige recommendation.`;
    },
  },

  {
    phrase_id:          'OS_WK_35_GENERIC',
    dimension:          'overall_score',
    type:               'weakness',
    score_band:         '35-49',
    context_match:      {},
    requires:           ['score_breakdown.overall_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'comparative',
    template: (h) => {
      const overall = Math.round(h.score_breakdown.overall_score);
      return `Overall score: ${overall}/100 — weak relative to the ranked inventory. ` +
        `One or more dimensions has a material quality deficit. Inclusion in results is ranked, not endorsed.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIMENSION: location_score — STRENGTHS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'LOC_STR_90_BEACHFRONT',
    dimension:          'location_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      { beachfront: true },
    requires:           ['score_breakdown.location_score', 'amenity_flags.beachfront', 'region'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.beachfront',
    claim_type:         'boolean',
    template: (h) => {
      const loc    = Math.round(h.score_breakdown.location_score);
      const region = h.region || 'coastal';
      return `Beachfront placement confirmed — direct sand access, no road crossing or shared pathway. ` +
        `Location score: ${loc}/100. ${region} positioning: ` +
        `${region.toLowerCase().includes('south') ? 'dramatic cliff-edged coastline with protected lagoon' :
          region.toLowerCase().includes('east')   ? 'calmer lagoon waters with consistent swimming conditions' :
          region.toLowerCase().includes('north')  ? 'accessible coastline, close to Port Louis infrastructure' :
          region.toLowerCase().includes('west')   ? 'sunset-facing exposure, known for clear evening light' :
          'assessed coastal position'}.`;
    },
  },

  {
    phrase_id:          'LOC_STR_90_GENERIC',
    dimension:          'location_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      {},
    requires:           ['score_breakdown.location_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.location_score',
    claim_type:         'numeric',
    template: (h) => {
      const loc = Math.round(h.score_breakdown.location_score);
      return `Location score: ${loc}/100. Top-tier coastal positioning within the Mauritius inventory — ` +
        `verified direct beach or lagoon access, minimal transfer time from SSR Airport.`;
    },
  },

  {
    phrase_id:          'LOC_STR_80_BEACHFRONT',
    dimension:          'location_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      { beachfront: true },
    requires:           ['score_breakdown.location_score', 'amenity_flags.beachfront'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.beachfront',
    claim_type:         'boolean',
    template: (h) => {
      const loc = Math.round(h.score_breakdown.location_score);
      return `Beachfront access confirmed. Location score ${loc}/100 — strong coastal position ` +
        `with reliable beach quality in its regional zone.`;
    },
  },

  {
    phrase_id:          'LOC_STR_80_GENERIC',
    dimension:          'location_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      {},
    requires:           ['score_breakdown.location_score', 'region'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.location_score',
    claim_type:         'numeric',
    template: (h) => {
      const loc    = Math.round(h.score_breakdown.location_score);
      const region = h.region || 'its coastal region';
      return `Location score ${loc}/100 — strong positioning within ${region}. ` +
        `Beach access quality is a net positive in the traveler experience profile.`;
    },
  },

  {
    phrase_id:          'LOC_STR_70_GENERIC',
    dimension:          'location_score',
    type:               'strength',
    score_band:         '70-79',
    context_match:      {},
    requires:           ['score_breakdown.location_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.location_score',
    claim_type:         'numeric',
    template: (h) => {
      const loc = Math.round(h.score_breakdown.location_score);
      return `Location score: ${loc}/100. Adequate coastal access — functional beach proximity ` +
        `without exceptional positioning advantages or disadvantages.`;
    },
  },

  // ─── location_score WEAKNESSES ────────────────────────────────────────────

  {
    phrase_id:          'LOC_WK_60_GENERIC',
    dimension:          'location_score',
    type:               'weakness',
    score_band:         '60-69',
    context_match:      {},
    requires:           ['score_breakdown.location_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.location_score',
    claim_type:         'comparative',
    template: (h) => {
      const loc = Math.round(h.score_breakdown.location_score);
      return `Location score ${loc}/100 — below segment median. Beach access quality or ` +
        `regional positioning is a relative disadvantage versus comparable properties.`;
    },
  },

  {
    phrase_id:          'LOC_WK_50_GENERIC',
    dimension:          'location_score',
    type:               'weakness',
    score_band:         '50-59',
    context_match:      {},
    requires:           ['score_breakdown.location_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.location_score',
    claim_type:         'comparative',
    template: (h) => {
      const loc = Math.round(h.score_breakdown.location_score);
      return `Location score: ${loc}/100. Weak coastal positioning for a beach-destination property. ` +
        `Expect limited private beach access, shared beach frontage, or inconvenient ground transfer.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIMENSION: amenity_score — STRENGTHS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'AME_STR_90_SPA_AWARD',
    dimension:          'amenity_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      { has_spa: true, spa_award_rated: true },
    requires:           ['score_breakdown.amenity_score', 'amenity_flags.has_spa', 'amenity_flags.spa_award_rated'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.spa_award_rated',
    claim_type:         'boolean',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score: ${ame}/100. Award-rated spa confirmed on property — ` +
        `a hard differentiator that directly signals elevated treatment standards and dedicated wellness infrastructure.`;
    },
  },

  {
    phrase_id:          'AME_STR_90_SPA',
    dimension:          'amenity_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      { has_spa: true },
    requires:           ['score_breakdown.amenity_score', 'amenity_flags.has_spa'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.has_spa',
    claim_type:         'boolean',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score: ${ame}/100. Full-service spa confirmed. ` +
        `Exceptional amenity breadth — multiple high-priority facilities verified across wellness, recreation, and dining.`;
    },
  },

  {
    phrase_id:          'AME_STR_90_PRIVATE_POOL',
    dimension:          'amenity_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      { private_pool_villa: true },
    requires:           ['score_breakdown.amenity_score', 'amenity_flags.private_pool_villa'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.private_pool_villa',
    claim_type:         'boolean',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score: ${ame}/100. Private plunge pool available in villa categories — ` +
        `a meaningful differentiator at the Mauritius luxury price point. Supported by further high-priority facility coverage.`;
    },
  },

  {
    phrase_id:          'AME_STR_90_GENERIC',
    dimension:          'amenity_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      {},
    requires:           ['score_breakdown.amenity_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.amenity_score',
    claim_type:         'numeric',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score: ${ame}/100. Top-tier facility profile across the assessed inventory — ` +
        `multiple high-priority amenities confirmed present and operational.`;
    },
  },

  {
    phrase_id:          'AME_STR_80_BUTLER',
    dimension:          'amenity_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      { butler_service: true },
    requires:           ['score_breakdown.amenity_score', 'amenity_flags.butler_service'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.butler_service',
    claim_type:         'boolean',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Butler service confirmed. Amenity score: ${ame}/100. Dedicated butler is a hard luxury differentiator ` +
        `associated with measurably higher guest satisfaction scores in the Mauritius segment.`;
    },
  },

  {
    phrase_id:          'AME_STR_80_GENERIC',
    dimension:          'amenity_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      {},
    requires:           ['score_breakdown.amenity_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.amenity_score',
    claim_type:         'numeric',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score: ${ame}/100. Strong facility profile — core high-priority amenities are present ` +
        `and verified. Above average for this price tier.`;
    },
  },

  {
    phrase_id:          'AME_STR_70_GENERIC',
    dimension:          'amenity_score',
    type:               'strength',
    score_band:         '70-79',
    context_match:      {},
    requires:           ['score_breakdown.amenity_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.amenity_score',
    claim_type:         'numeric',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score: ${ame}/100. Adequate facility coverage — core amenities present ` +
        `without standout differentiators. Functional rather than exceptional.`;
    },
  },

  // ─── amenity_score WEAKNESSES ─────────────────────────────────────────────

  {
    phrase_id:          'AME_WK_60_NO_SPA',
    dimension:          'amenity_score',
    type:               'weakness',
    score_band:         '60-69',
    context_match:      { has_spa: false },
    requires:           ['score_breakdown.amenity_score', 'amenity_flags.has_spa'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.has_spa',
    claim_type:         'boolean',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `No spa confirmed on property. Amenity score: ${ame}/100 — ` +
        `the absence of spa facilities is a meaningful gap for wellness or honeymoon travel intent.`;
    },
  },

  {
    phrase_id:          'AME_WK_60_GENERIC',
    dimension:          'amenity_score',
    type:               'weakness',
    score_band:         '60-69',
    context_match:      {},
    requires:           ['score_breakdown.amenity_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.amenity_score',
    claim_type:         'comparative',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score ${ame}/100 — below the segment median. One or more high-priority facilities ` +
        `(spa, private beach, pool variety, butler service) are absent or below standard.`;
    },
  },

  {
    phrase_id:          'AME_WK_50_GENERIC',
    dimension:          'amenity_score',
    type:               'weakness',
    score_band:         '50-59',
    context_match:      {},
    requires:           ['score_breakdown.amenity_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.amenity_score',
    claim_type:         'comparative',
    template: (h) => {
      const ame = Math.round(h.score_breakdown.amenity_score);
      return `Amenity score: ${ame}/100 — weak relative to the luxury tier. ` +
        `Facility gaps are material; not recommended for travelers whose itinerary is anchored in on-property amenities.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIMENSION: brand_score — STRENGTHS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'BRD_STR_90_NAMED',
    dimension:          'brand_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      { brand_tier: 5 },
    requires:           ['score_breakdown.brand_score', 'brand'],
    produces_claim:     true,
    claim_source_field: 'brand',
    claim_type:         'descriptive',
    template: (h) => {
      const brd  = Math.round(h.score_breakdown.brand_score);
      const name = h.brand || 'Brand';
      return `Brand score: ${brd}/100. ${name} — tier-1 brand positioning. ` +
        `Service consistency infrastructure, dispute resolution track record, and loyalty program depth ` +
        `are established data points. Less review-by-review variance than independent properties.`;
    },
  },

  {
    phrase_id:          'BRD_STR_90_GENERIC',
    dimension:          'brand_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      {},
    requires:           ['score_breakdown.brand_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.brand_score',
    claim_type:         'numeric',
    template: (h) => {
      const brd = Math.round(h.score_breakdown.brand_score);
      return `Brand score: ${brd}/100. Top-tier brand positioning — a statistically meaningful signal ` +
        `of service consistency and operational standards in the Mauritius luxury segment.`;
    },
  },

  {
    phrase_id:          'BRD_STR_80_GENERIC',
    dimension:          'brand_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      {},
    requires:           ['score_breakdown.brand_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.brand_score',
    claim_type:         'numeric',
    template: (h) => {
      const brd = Math.round(h.score_breakdown.brand_score);
      return `Brand score ${brd}/100 — strong brand positioning. Established service standards, ` +
        `loyalty program eligibility, and a consistent review profile across comparable locations.`;
    },
  },

  {
    phrase_id:          'BRD_STR_70_GENERIC',
    dimension:          'brand_score',
    type:               'strength',
    score_band:         '70-79',
    context_match:      {},
    requires:           ['score_breakdown.brand_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.brand_score',
    claim_type:         'comparative',
    template: (h) => {
      const brd = Math.round(h.score_breakdown.brand_score);
      return `Brand score: ${brd}/100. Recognised upper-mid tier brand — consistent standards, ` +
        `though without the differentiated positioning of a tier-1 brand.`;
    },
  },

  // ─── brand_score WEAKNESSES ───────────────────────────────────────────────

  {
    phrase_id:          'BRD_WK_60_GENERIC',
    dimension:          'brand_score',
    type:               'weakness',
    score_band:         '60-69',
    context_match:      {},
    requires:           ['score_breakdown.brand_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.brand_score',
    claim_type:         'comparative',
    template: (h) => {
      const brd = Math.round(h.score_breakdown.brand_score);
      return `Brand score ${brd}/100 — lower-tier or independent brand. ` +
        `Service consistency evidence is thinner; fewer cross-property data points for predictive quality assessment.`;
    },
  },

  {
    phrase_id:          'BRD_WK_50_GENERIC',
    dimension:          'brand_score',
    type:               'weakness',
    score_band:         '50-59',
    context_match:      {},
    requires:           ['score_breakdown.brand_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.brand_score',
    claim_type:         'comparative',
    template: (h) => {
      const brd = Math.round(h.score_breakdown.brand_score);
      return `Brand score: ${brd}/100. Limited brand infrastructure — accountability mechanisms ` +
        `are weaker than established chain properties at this price point.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIMENSION: value_score — STRENGTHS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'VAL_STR_90_PRICED',
    dimension:          'value_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      {},
    requires:           ['score_breakdown.value_score', 'avg_nightly_rate'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'comparative',
    template: (h) => {
      const val   = Math.round(h.score_breakdown.value_score);
      const price = _formatUSD(h.avg_nightly_rate);
      const priceStr = price ? ` at ~USD ${price}/night` : '';
      return `Value score: ${val}/100${priceStr}. ` +
        `Exceptional price-to-quality ratio — one of the strongest value signals in the Mauritius luxury inventory. ` +
        `Assessed against direct comparable properties in the same coastal region and service tier.`;
    },
  },

  {
    phrase_id:          'VAL_STR_90_NO_PRICE',
    dimension:          'value_score',
    type:               'strength',
    score_band:         '90-100',
    context_match:      {},
    requires:           ['score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'comparative',
    template: (h) => {
      const val = Math.round(h.score_breakdown.value_score);
      return `Value score: ${val}/100 — exceptional price-to-quality ratio relative to direct competitors ` +
        `in the Mauritius luxury segment. Pricing data not available for inline display; confirm with property.`;
    },
  },

  {
    phrase_id:          'VAL_STR_80_PRICED',
    dimension:          'value_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      {},
    requires:           ['score_breakdown.value_score', 'avg_nightly_rate'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'comparative',
    template: (h) => {
      const val   = Math.round(h.score_breakdown.value_score);
      const price = _formatUSD(h.avg_nightly_rate);
      const priceStr = price ? ` at ~USD ${price}/night` : '';
      return `Value score: ${val}/100${priceStr}. Above-average price-to-quality ratio — ` +
        `strong output per dollar spent relative to comparable properties in this tier.`;
    },
  },

  {
    phrase_id:          'VAL_STR_80_ALL_INCLUSIVE',
    dimension:          'value_score',
    type:               'strength',
    score_band:         '80-89',
    context_match:      { all_inclusive: true },
    requires:           ['score_breakdown.value_score', 'amenity_flags.all_inclusive'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.all_inclusive',
    claim_type:         'boolean',
    template: (h) => {
      const val = Math.round(h.score_breakdown.value_score);
      return `All-inclusive option confirmed. Value score: ${val}/100 — ` +
        `bundled pricing reduces variable spend and enables accurate pre-departure budget forecasting.`;
    },
  },

  {
    phrase_id:          'VAL_STR_70_GENERIC',
    dimension:          'value_score',
    type:               'strength',
    score_band:         '70-79',
    context_match:      {},
    requires:           ['score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'numeric',
    template: (h) => {
      const val = Math.round(h.score_breakdown.value_score);
      return `Value score: ${val}/100. Pricing broadly in line with what the property delivers — ` +
        `no significant over- or under-pricing signal against the segment benchmark.`;
    },
  },

  // ─── value_score WEAKNESSES ───────────────────────────────────────────────

  {
    phrase_id:          'VAL_WK_60_PRICED',
    dimension:          'value_score',
    type:               'weakness',
    score_band:         '60-69',
    context_match:      {},
    requires:           ['score_breakdown.value_score', 'avg_nightly_rate'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'comparative',
    template: (h) => {
      const val   = Math.round(h.score_breakdown.value_score);
      const price = _formatUSD(h.avg_nightly_rate);
      const priceStr = price ? ` at ~USD ${price}/night` : '';
      return `Value score ${val}/100${priceStr} — below segment median. ` +
        `Price-to-quality ratio is a relative weakness; comparable alternatives deliver similar quality at lower cost.`;
    },
  },

  {
    phrase_id:          'VAL_WK_60_GENERIC',
    dimension:          'value_score',
    type:               'weakness',
    score_band:         '60-69',
    context_match:      {},
    requires:           ['score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'comparative',
    template: (h) => {
      const val = Math.round(h.score_breakdown.value_score);
      return `Value score ${val}/100 — below the segment median. ` +
        `Price premium over quality delivered is measurable relative to comparable properties.`;
    },
  },

  {
    phrase_id:          'VAL_WK_50_GENERIC',
    dimension:          'value_score',
    type:               'weakness',
    score_band:         '50-59',
    context_match:      {},
    requires:           ['score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'comparative',
    template: (h) => {
      const val = Math.round(h.score_breakdown.value_score);
      return `Value score: ${val}/100. Material price premium over quality delivered. ` +
        `Budget-sensitive travelers should model alternatives before committing.`;
    },
  },

  {
    phrase_id:          'VAL_WK_35_GENERIC',
    dimension:          'value_score',
    type:               'weakness',
    score_band:         '35-49',
    context_match:      {},
    requires:           ['score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.value_score',
    claim_type:         'comparative',
    template: (h) => {
      const val = Math.round(h.score_breakdown.value_score);
      return `Value score: ${val}/100 — poor price-to-quality ratio relative to this inventory. ` +
        `Not recommended for cost-aware travel; brand or location premium is the primary justification for pricing.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FIT PHRASES — POSITIVE
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'FIT_POS_HONEYMOON',
    dimension:          'amenity_score',
    type:               'fit_positive',
    score_band:         '70-79',
    context_match:      { persona: 'honeymoon' },
    requires:           ['all_persona_scores.honeymoon', 'amenity_flags'],
    produces_claim:     true,
    claim_source_field: 'all_persona_scores.honeymoon',
    claim_type:         'numeric',
    template: (h) => {
      const score   = Math.round(h.all_persona_scores.honeymoon);
      const flags   = h.amenity_flags || {};
      const signals = [];
      if (flags.beachfront)         signals.push('private beach access');
      if (flags.has_spa)            signals.push('spa on property');
      if (flags.private_pool_villa) signals.push('in-villa plunge pool');
      if (flags.butler_service)     signals.push('butler service');
      if (flags.overwater_bungalow) signals.push('overwater bungalow category');
      const signalStr = signals.length > 0
        ? ` — supported by ${signals.join(', ')}`
        : '';
      return `Honeymoon intent score: ${score}/100${signalStr}. ` +
        `${score >= 65 ? 'Above threshold for positive honeymoon positioning.' : 'Below the 65-point threshold for a primary honeymoon recommendation.'}`;
    },
  },

  {
    phrase_id:          'FIT_POS_FAMILY',
    dimension:          'amenity_score',
    type:               'fit_positive',
    score_band:         '70-79',
    context_match:      { persona: 'family', kids_club: true },
    requires:           ['all_persona_scores.family', 'amenity_flags.kids_club'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.kids_club',
    claim_type:         'boolean',
    template: (h) => {
      const score = Math.round(h.all_persona_scores.family);
      return `Kids club confirmed on property — a core qualification for family ranking. ` +
        `Family intent score: ${score}/100. ` +
        `${score >= 65 ? 'Above threshold for primary family positioning.' : 'Directional family fit — below the 65-point primary recommendation threshold.'}`;
    },
  },

  {
    phrase_id:          'FIT_POS_WELLNESS',
    dimension:          'amenity_score',
    type:               'fit_positive',
    score_band:         '70-79',
    context_match:      { persona: 'wellness', has_spa: true },
    requires:           ['all_persona_scores.wellness', 'amenity_flags.has_spa'],
    produces_claim:     true,
    claim_source_field: 'all_persona_scores.wellness',
    claim_type:         'numeric',
    template: (h) => {
      const score    = Math.round(h.all_persona_scores.wellness);
      const awardStr = h.amenity_flags?.spa_award_rated ? ' (award-rated)' : '';
      return `Spa confirmed${awardStr}. Wellness intent score: ${score}/100. ` +
        `${score >= 65 ? 'Qualifies for positive wellness positioning.' : 'Directional wellness fit only — additional spa depth would strengthen placement.'}`;
    },
  },

  {
    phrase_id:          'FIT_POS_LUXURY',
    dimension:          'brand_score',
    type:               'fit_positive',
    score_band:         '80-89',
    context_match:      { persona: 'luxury' },
    requires:           ['all_persona_scores.luxury', 'score_breakdown.brand_score'],
    produces_claim:     true,
    claim_source_field: 'all_persona_scores.luxury',
    claim_type:         'numeric',
    template: (h) => {
      const score = Math.round(h.all_persona_scores.luxury);
      const brd   = Math.round(h.score_breakdown.brand_score);
      const butlerStr = h.amenity_flags?.butler_service ? ' + butler service' : '';
      return `Luxury intent score: ${score}/100. Brand score: ${brd}/100${butlerStr}. ` +
        `${score >= 65 ? 'Confirmed luxury-tier positioning.' : 'Below the 65-point luxury threshold — positioned in the upper-mid segment rather than true luxury.'}`;
    },
  },

  {
    phrase_id:          'FIT_POS_REMOTE_WORK',
    dimension:          'amenity_score',
    type:               'fit_positive',
    score_band:         '70-79',
    context_match:      { persona: 'remote_work', high_speed_wifi: true },
    requires:           ['all_persona_scores.remote_work', 'amenity_flags.high_speed_wifi'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.high_speed_wifi',
    claim_type:         'boolean',
    template: (h) => {
      const score     = Math.round(h.all_persona_scores.remote_work);
      const workspace = h.amenity_flags?.dedicated_workspace
        ? 'Dedicated workspace confirmed.'
        : 'No dedicated workspace verified — common areas only.';
      return `High-speed WiFi confirmed. ${workspace} ` +
        `Remote work intent score: ${score}/100.`;
    },
  },

  {
    phrase_id:          'FIT_POS_VALUE_LUXURY',
    dimension:          'value_score',
    type:               'fit_positive',
    score_band:         '70-79',
    context_match:      { persona: 'value_luxury' },
    requires:           ['all_persona_scores.value_luxury', 'score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'all_persona_scores.value_luxury',
    claim_type:         'numeric',
    template: (h) => {
      const score     = Math.round(h.all_persona_scores.value_luxury);
      const val       = Math.round(h.score_breakdown.value_score);
      const aiStr     = h.amenity_flags?.all_inclusive ? ' All-inclusive option available.' : '';
      return `Value-luxury intent score: ${score}/100. Value score: ${val}/100.${aiStr} ` +
        `${score >= 65 ? 'Strong value-luxury positioning.' : 'Directional value-luxury fit — pricing pressure is a consideration.'}`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FIT PHRASES — NEGATIVE
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'FIT_NEG_HONEYMOON_FAMILY_PROPERTY',
    dimension:          'amenity_score',
    type:               'fit_negative',
    score_band:         '50-59',
    context_match:      { persona: 'honeymoon', kids_club: true },
    requires:           ['all_persona_scores.honeymoon', 'amenity_flags.kids_club'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.kids_club',
    claim_type:         'boolean',
    template: (h) => {
      const score = Math.round(h.all_persona_scores.honeymoon);
      return `Kids club on property reduces exclusivity appeal for couple-focused travel. ` +
        `Honeymoon intent score: ${score}/100 — below the 65-point threshold for positive honeymoon positioning.`;
    },
  },

  {
    phrase_id:          'FIT_NEG_FAMILY_ADULTS_ONLY',
    dimension:          'amenity_score',
    type:               'fit_negative',
    score_band:         '0-34',
    context_match:      { persona: 'family', adults_only: true },
    requires:           ['amenity_flags.adults_only'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.adults_only',
    claim_type:         'boolean',
    template: (h) => {
      return `Adults-only designation confirmed. This property is excluded from the family ranking by design. ` +
        `No children can be accommodated. Not a directional fit — a hard exclusion.`;
    },
  },

  {
    phrase_id:          'FIT_NEG_WELLNESS_NO_SPA',
    dimension:          'amenity_score',
    type:               'fit_negative',
    score_band:         '0-34',
    context_match:      { persona: 'wellness', has_spa: false },
    requires:           ['amenity_flags.has_spa'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.has_spa',
    claim_type:         'boolean',
    template: (h) => {
      return `No spa confirmed on property. A hotel without spa facilities cannot qualify as a wellness destination ` +
        `under this ranking system — the spa is a hard requirement, not a weighted signal.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TRADEOFF PHRASES
  // ═══════════════════════════════════════════════════════════════════════════

  {
    phrase_id:          'TRD_BRAND_PREMIUM_VALUE',
    dimension:          'value_score',
    type:               'tradeoff',
    score_band:         '50-59',
    context_match:      { brand_tier: 5 },
    requires:           ['name', 'score_breakdown.brand_score', 'score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.brand_score',
    claim_type:         'comparative',
    template: (h) => {
      const brd = Math.round(h.score_breakdown.brand_score);
      const val = Math.round(h.score_breakdown.value_score);
      return `Brand premium trade-off at ${h.name || 'this property'}: high brand score (${brd}/100) ` +
        `carries a price overhead that depresses value score (${val}/100). ` +
        `The cost of brand infrastructure and consistency guarantees is explicit here.`;
    },
  },

  {
    phrase_id:          'TRD_ADULTS_ONLY_EXCLUSION',
    dimension:          'amenity_score',
    type:               'tradeoff',
    score_band:         '70-79',
    context_match:      { adults_only: true },
    requires:           ['amenity_flags.adults_only'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.adults_only',
    claim_type:         'boolean',
    template: (h) => {
      return `Adults-only designation: a deliberate quality trade-off. ` +
        `Elevated atmosphere and exclusivity for couples; absolute exclusion for families. ` +
        `This is a positioning decision by the property, not a data gap.`;
    },
  },

  {
    phrase_id:          'TRD_REMOTE_LOCATION_SECLUSION',
    dimension:          'location_score',
    type:               'tradeoff',
    score_band:         '60-69',
    context_match:      {},
    requires:           ['region'],
    produces_claim:     true,
    claim_source_field: 'region',
    claim_type:         'descriptive',
    template: (h) => {
      const region = h.region || 'this region';
      return `${region} location trades accessibility for seclusion. ` +
        `Transfer from SSR Airport: 45–75 minutes typical, route-dependent. ` +
        `Seclusion is the product — not an inconvenience to compensate for.`;
    },
  },

  {
    phrase_id:          'TRD_ALL_INCLUSIVE_DINING',
    dimension:          'value_score',
    type:               'tradeoff',
    score_band:         '80-89',
    context_match:      { all_inclusive: true },
    requires:           ['amenity_flags.all_inclusive'],
    produces_claim:     true,
    claim_source_field: 'amenity_flags.all_inclusive',
    claim_type:         'boolean',
    template: (h) => {
      return `All-inclusive structure: full cost transparency vs. dining exploration trade-off. ` +
        `Reduces off-property dining incentive and per-meal spend variability. ` +
        `Optimal for travelers who value budget predictability; suboptimal for food-driven itineraries.`;
    },
  },

  {
    phrase_id:          'TRD_HIGH_QUALITY_BUDGET',
    dimension:          'value_score',
    type:               'tradeoff',
    score_band:         '50-59',
    context_match:      {},
    requires:           ['name', 'score_breakdown.overall_score', 'score_breakdown.value_score'],
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'comparative',
    template: (h) => {
      const overall = Math.round(h.score_breakdown.overall_score);
      const val     = Math.round(h.score_breakdown.value_score);
      return `${h.name || 'This property'} delivers quality (overall score: ${overall}/100) ` +
        `but value score (${val}/100) signals a price premium that budget-aware travelers should model explicitly. ` +
        `Comparable quality exists at lower price points in this inventory.`;
    },
  },

];

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY INDEX
// Builds a lookup map at initialization for O(1) bucket access.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal index: { [dimension]: { [type]: PhraseEntry[] } }
 * Populated once at module initialization by _buildIndex().
 * @type {Object}
 */
let _INDEX = null;

/**
 * Builds the internal registry index from the flat PHRASE_REGISTRY array.
 * Groups entries by dimension → type buckets for fast lookup.
 *
 * @returns {Object} index
 */
function _buildIndex() {
  const index = {};
  for (const entry of PHRASE_REGISTRY) {
    if (!index[entry.dimension])       index[entry.dimension] = {};
    if (!index[entry.dimension][entry.type]) index[entry.dimension][entry.type] = [];
    index[entry.dimension][entry.type].push(entry);
  }
  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates every PhraseEntry in the registry against the schema contract.
 *
 * Checks performed:
 *   - phrase_id is a non-empty unique string
 *   - dimension is a valid DimensionKey
 *   - type is a valid PhraseType
 *   - score_band is a valid ScoreBand
 *   - context_match is a plain object
 *   - requires is a non-empty array of strings
 *   - template is a function
 *   - produces_claim: true requires a non-null claim_source_field
 *   - claim_type is a valid ClaimType
 *
 * @returns {{ valid: boolean, errors: Object[], warnings: Object[], entry_count: number }}
 * @throws  {PhraseLibraryInitializationError} if any errors are found
 */
function validateLibrary() {
  const report   = { errors: [], warnings: [], entry_count: PHRASE_REGISTRY.length };
  const seenIds  = new Set();

  for (const entry of PHRASE_REGISTRY) {
    const id = entry.phrase_id || '(no phrase_id)';

    // phrase_id: unique, non-empty string
    if (typeof entry.phrase_id !== 'string' || entry.phrase_id.trim() === '') {
      report.errors.push({ phrase_id: id, issue: 'phrase_id must be a non-empty string' });
    } else if (seenIds.has(entry.phrase_id)) {
      report.errors.push({ phrase_id: id, issue: `Duplicate phrase_id: "${entry.phrase_id}"` });
    } else {
      seenIds.add(entry.phrase_id);
    }

    // dimension
    if (!DIMENSION_KEYS.includes(entry.dimension)) {
      report.errors.push({ phrase_id: id, issue: `Invalid dimension: "${entry.dimension}"` });
    }

    // type
    if (!PHRASE_TYPES.includes(entry.type)) {
      report.errors.push({ phrase_id: id, issue: `Invalid type: "${entry.type}"` });
    }

    // score_band
    if (!SCORE_BANDS.includes(entry.score_band)) {
      report.errors.push({ phrase_id: id, issue: `Invalid score_band: "${entry.score_band}"` });
    }

    // context_match: plain object
    if (typeof entry.context_match !== 'object' || entry.context_match === null || Array.isArray(entry.context_match)) {
      report.errors.push({ phrase_id: id, issue: 'context_match must be a plain object' });
    }

    // requires: non-empty array of strings
    if (!Array.isArray(entry.requires) || entry.requires.length === 0) {
      report.errors.push({ phrase_id: id, issue: 'requires must be a non-empty array' });
    } else {
      for (const req of entry.requires) {
        if (typeof req !== 'string' || req.trim() === '') {
          report.errors.push({ phrase_id: id, issue: `requires contains invalid entry: ${JSON.stringify(req)}` });
        }
      }
    }

    // template: function
    if (typeof entry.template !== 'function') {
      report.errors.push({ phrase_id: id, issue: 'template must be a function' });
    }

    // produces_claim → claim_source_field required
    if (entry.produces_claim === true && !entry.claim_source_field) {
      report.errors.push({ phrase_id: id, issue: 'produces_claim=true requires a non-null claim_source_field' });
    }

    // claim_type
    if (!CLAIM_TYPES.includes(entry.claim_type)) {
      report.errors.push({ phrase_id: id, issue: `Invalid claim_type: "${entry.claim_type}"` });
    }
  }

  if (report.errors.length > 0) {
    throw new PhraseLibraryInitializationError(report);
  }

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

// Run validation and build index immediately on require().
// Application must not start if validation fails.
(function _init() {
  validateLibrary();  // throws on any schema violation
  _INDEX = _buildIndex();
})();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Primary selector. Returns the single most contextually appropriate PhraseEntry
 * for the given lookup key, or null if no matching entry exists.
 *
 * Selection algorithm:
 *   1. Filter registry by (dimension, type, score_band).
 *   2. For each candidate, compute context match score via _scoreContextMatch().
 *   3. Return the highest-scoring candidate.
 *   4. On ties, return the first encountered (registry ordering is authoritative).
 *   5. If no candidates exist, return null.
 *
 * The caller is responsible for:
 *   - Calling _checkRequires() before executing the template
 *   - Handling null return (no fallback text is ever provided here)
 *
 * @param  {{ dimension: string, type: string, score_band: string, context: Object }} key
 * @returns {Object|null} PhraseEntry or null
 * @throws  {InvalidDimensionError}   if dimension is invalid
 * @throws  {InvalidScoreBandError}   if score_band is invalid
 * @throws  {InvalidLookupKeyError}   if key is missing required fields
 */
function get(key) {
  if (!key || typeof key !== 'object') {
    throw new InvalidLookupKeyError('key must be a plain object', key);
  }
  const { dimension, type, score_band, context = {} } = key;

  if (!dimension)  throw new InvalidLookupKeyError('key.dimension is required', key);
  if (!type)       throw new InvalidLookupKeyError('key.type is required', key);
  if (!score_band) throw new InvalidLookupKeyError('key.score_band is required', key);

  if (!DIMENSION_KEYS.includes(dimension)) throw new InvalidDimensionError(dimension);
  if (!SCORE_BANDS.includes(score_band))   throw new InvalidScoreBandError(score_band);

  // Bucket lookup — O(1)
  const bucket = (_INDEX[dimension] && _INDEX[dimension][type]) ? _INDEX[dimension][type] : [];

  // Filter to matching score_band, then rank by context match score
  const candidates = bucket.filter(e => e.score_band === score_band);
  if (candidates.length === 0) return null;

  let best      = null;
  let bestScore = -Infinity;

  for (const entry of candidates) {
    const matchScore = _scoreContextMatch(entry.context_match, context);
    if (matchScore > bestScore) {
      bestScore = matchScore;
      best      = entry;
    }
  }

  return best;
}

/**
 * Returns ALL PhraseEntry objects that match (dimension, type, score_band),
 * regardless of context. Used when variant sets are needed, or for testing.
 *
 * @param  {string} dimension
 * @param  {string} type
 * @param  {string} score_band
 * @returns {Object[]} array of PhraseEntry (may be empty)
 */
function getAll(dimension, type, score_band) {
  if (!DIMENSION_KEYS.includes(dimension)) throw new InvalidDimensionError(dimension);
  if (!SCORE_BANDS.includes(score_band))   throw new InvalidScoreBandError(score_band);

  const bucket = (_INDEX[dimension] && _INDEX[dimension][type]) ? _INDEX[dimension][type] : [];
  return bucket.filter(e => e.score_band === score_band);
}

/**
 * Returns the list of hotel field paths declared in a PhraseEntry's requires array.
 * Provided for use by HallucinationGuard to pre-check field availability.
 *
 * @param  {Object} entry — PhraseEntry
 * @returns {string[]}
 */
function getDependencies(entry) {
  if (!entry || !Array.isArray(entry.requires)) return [];
  return entry.requires.slice();
}

/**
 * Executes a PhraseEntry's template against a hotel record.
 *
 * Performs requires[] check before calling template.
 * Returns a PhraseResult object for every call — never throws, never swallows.
 *
 * @param  {Object} entry — PhraseEntry
 * @param  {Object} hotel — bound HotelRecord
 * @returns {{
 *   phrase_id:         string,
 *   rendered_text:     string|null,
 *   injected_values:   Object,
 *   suppressed:        boolean,
 *   suppression_reason: string|null,
 *   produces_claim:    boolean,
 *   claim_source_field: string|null,
 *   claim_type:        string,
 * }}
 */
function execute(entry, hotel) {
  const injectedValues = {};

  // Capture required field values for audit trail
  for (const path of (entry.requires || [])) {
    injectedValues[path] = _resolveField(path, hotel);
  }

  // Requires check — any missing field suppresses
  const missing = _checkRequires(entry.requires || [], hotel);
  if (missing.length > 0) {
    return {
      phrase_id:          entry.phrase_id,
      rendered_text:      null,
      injected_values:    injectedValues,
      suppressed:         true,
      suppression_reason: `Missing required field(s): ${missing.join(', ')}`,
      produces_claim:     entry.produces_claim,
      claim_source_field: entry.claim_source_field,
      claim_type:         entry.claim_type,
    };
  }

  // Execute template
  let renderedText = null;
  let suppressionReason = null;

  try {
    renderedText = entry.template(hotel);
    // Template may return null for value-conditional suppression
    if (renderedText === null) {
      suppressionReason = 'Template returned null — value-based conditional suppression';
    }
  } catch (err) {
    suppressionReason = `Template execution error: ${err.message}`;
  }

  return {
    phrase_id:          entry.phrase_id,
    rendered_text:      renderedText,
    injected_values:    injectedValues,
    suppressed:         renderedText === null,
    suppression_reason: suppressionReason,
    produces_claim:     entry.produces_claim,
    claim_source_field: entry.claim_source_field,
    claim_type:         entry.claim_type,
  };
}

/**
 * Convenience wrapper: given a lookup key and hotel, selects the best matching
 * PhraseEntry and executes it immediately.
 *
 * Returns null if no matching phrase exists (not found, not suppressed).
 * Returns a PhraseResult if a phrase was found (check .suppressed for execution status).
 *
 * @param  {Object} key   — PhraseLookupKey
 * @param  {Object} hotel — bound HotelRecord
 * @returns {Object|null} PhraseResult or null
 */
function getAndExecute(key, hotel) {
  const entry = get(key);
  if (!entry) return null;
  return execute(entry, hotel);
}

/**
 * Converts a 0–100 score to a ScoreBand string.
 * Exposed for use by explanation_engine.js when constructing lookup keys.
 *
 * @param  {number} score
 * @returns {string} ScoreBand
 */
function getScoreBand(score) {
  return _getScoreBand(score);
}

/**
 * Classifies a review count into a volume tier string.
 * Exposed for use by explanation_engine.js when constructing lookup context.
 *
 * @param  {number|null} reviewCount
 * @returns {'high'|'medium'|'low'|'insufficient'}
 */
function getReviewVolumeTier(reviewCount) {
  return _getReviewVolumeTier(reviewCount);
}

/**
 * Returns a snapshot of the registry for debugging and audit purposes.
 * Does not expose internal index structure — only the flat registry array.
 *
 * @returns {{ entry_count: number, phrase_ids: string[], version: string }}
 */
function getRegistryInfo() {
  return {
    entry_count: PHRASE_REGISTRY.length,
    phrase_ids:  PHRASE_REGISTRY.map(e => e.phrase_id),
    version:     PHRASE_LIBRARY_VERSION,
    dimensions:  DIMENSION_KEYS.slice(),
    types:       PHRASE_TYPES.slice(),
    score_bands: SCORE_BANDS.slice(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Primary API ────────────────────────────────────────────────────────────
  get,
  getAll,
  execute,
  getAndExecute,
  getDependencies,

  // ── Utility (for explanation_engine.js key construction) ──────────────────
  getScoreBand,
  getReviewVolumeTier,

  // ── Introspection / audit ──────────────────────────────────────────────────
  getRegistryInfo,
  validateLibrary,

  // ── Constants (for downstream module validation) ───────────────────────────
  PHRASE_LIBRARY_VERSION,
  DIMENSION_KEYS,
  PHRASE_TYPES,
  SCORE_BANDS,
  CLAIM_TYPES,
  PERSONA_KEYS,
  REVIEW_VOLUME_THRESHOLDS,

  // ── Error types (for instanceof checks in callers) ─────────────────────────
  PhraseLibraryInitializationError,
  InvalidLookupKeyError,
  InvalidScoreBandError,
  InvalidDimensionError,
};
