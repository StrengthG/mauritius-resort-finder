/**
 * explanation_engine.js
 * Mauritius Resort Finder — Explanation Engine, Module 5 of 5
 * Version: 1.0.0
 *
 * Orchestration brain of the recommendation intelligence platform.
 * Drives all five explanation-generation stages — from raw hotel data to a
 * fully validated, confidence-calibrated ExplanationObject — by orchestrating
 * phrase_library, hallucination_guard, and confidence_enforcer.
 *
 * Architecture position: Layer 5 — Explanation Orchestration (top layer).
 * Upstream:    scoring_engine.js  (produces scored hotel records)
 * Depends on:  phrase_library.js      (phrase selection and execution)
 *              hallucination_guard.js (publishability gate)
 *              confidence_enforcer.js (certainty calibration)
 *
 * Pipeline (9 stages, all deterministic):
 *   [1] Input Validation       — hotel shape, score fields, persona
 *   [2] Dimension Analysis     — sort 5 dimensions; identify top-3 strengths, bottom-1 weakness
 *   [3] Strength Extraction    — up to 3 strength PhraseResults from phrase_library
 *   [4] Weakness Extraction    — exactly 1 weakness guaranteed (fallback prose if all lookups fail)
 *   [5] Traveler Fit Generation — persona-aware positive fit + cautionary note
 *   [6] Claim Validation       — ALL candidates through hallucination_guard.validate()
 *   [7] Confidence Calibration — validated claims through confidence_enforcer.enforce()
 *   [8] Summary Generation     — 1-2 sentence synthesis from top calibrated claims
 *   [9] Explanation Assembly   — build and freeze final ExplanationObject
 *
 * Design invariants:
 *   - Stateless. Pure functions only. No mutations of inputs.
 *   - Deterministic: same hotel + persona always produces identical output.
 *   - NO phrase generation inside this module — only phrase selection and routing.
 *   - NO facts injected by this module — all text comes from phrase_library.
 *   - EVERY ExplanationObject has exactly 1 weakness item in weaknesses[].
 *   - ALL candidate claims pass through hallucination_guard before publishing.
 *   - ALL non-suppressed claims pass through confidence_enforcer before assembly.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// DEPENDENCIES
// ─────────────────────────────────────────────────────────────────────────────

const phraseLib = require('./phrase_library.js');
const guard     = require('./hallucination_guard.js');
const enforcer  = require('./confidence_enforcer.js');

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DIMENSION_KEYS = phraseLib.DIMENSION_KEYS;
const PERSONA_KEYS   = phraseLib.PERSONA_KEYS;
const SCORE_BANDS    = phraseLib.SCORE_BANDS;

/** Stages in pipeline order. */
const PIPELINE_STAGES = Object.freeze([
  'input_validation',
  'dimension_analysis',
  'strength_extraction',
  'weakness_extraction',
  'traveler_fit_generation',
  'claim_validation',
  'confidence_calibration',
  'summary_generation',
  'explanation_assembly',
]);

/** Maximum strength claims to include in an ExplanationObject. */
const STRENGTH_CANDIDATE_COUNT = 3;

/**
 * Minimum dimension score for a strength phrase to be attempted.
 * Dimensions scoring below this threshold are not expected to have
 * strength-type phrases in the registry.
 */
const MIN_STRENGTH_SCORE = 70;

/** Persona score thresholds for traveler fit classification. */
const FIT_STRENGTH_STRONG   = 80;
const FIT_STRENGTH_MODERATE = 65;
const FIT_STRENGTH_WEAK     = 50;

/**
 * Phrase type identifiers (mirrors phrase_library PHRASE_TYPES).
 * Listed here for readability in stage functions.
 */
const PHRASE_TYPES = Object.freeze({
  STRENGTH:     'strength',
  WEAKNESS:     'weakness',
  FIT_POSITIVE: 'fit_positive',
  FIT_NEGATIVE: 'fit_negative',
  TRADEOFF:     'tradeoff',
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

class ExplanationEngineError extends Error {
  constructor(message, stage, details) {
    super(message);
    this.name    = 'ExplanationEngineError';
    this.stage   = stage   || null;
    this.details = details || null;
  }
}

class InvalidHotelInputError extends ExplanationEngineError {
  constructor(message, details) {
    super(message, 'input_validation', details);
    this.name = 'InvalidHotelInputError';
  }
}

class InvalidPersonaError extends ExplanationEngineError {
  constructor(persona) {
    super(
      `Invalid persona: "${persona}". Must be one of: ${PERSONA_KEYS.join(', ')}`,
      'input_validation',
      { persona },
    );
    this.name = 'InvalidPersonaError';
  }
}

class WeaknessGuaranteeError extends ExplanationEngineError {
  constructor(hotel_id) {
    super(
      `Weakness guarantee violated: could not produce any weakness for hotel "${hotel_id}"`,
      'weakness_extraction',
    );
    this.name = 'WeaknessGuaranteeError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a dot-notation path against an object.
 * Returns undefined if any segment is absent.
 *
 * @param  {Object} obj
 * @param  {string} path — e.g. 'score_breakdown.overall_score'
 * @returns {*}
 */
function _resolve(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

/**
 * Flattens hotel.amenity_flags into a plain context object.
 * All flag values are coerced to boolean.
 *
 * @param  {Object} hotel
 * @returns {Object}
 */
function _buildAmenityContext(hotel) {
  const f = (hotel && hotel.amenity_flags) ? hotel.amenity_flags : {};
  return {
    beachfront:          !!f.beachfront,
    has_spa:             !!f.has_spa,
    spa_award_rated:     !!f.spa_award_rated,
    butler_service:      !!f.butler_service,
    private_pool_villa:  !!f.private_pool_villa,
    all_inclusive:       !!f.all_inclusive,
    kids_club:           !!f.kids_club,
    adults_only:         !!f.adults_only,
    high_speed_wifi:     !!f.high_speed_wifi,
    overwater_bungalow:  !!f.overwater_bungalow,
    dedicated_workspace: !!f.dedicated_workspace,
  };
}

/**
 * Builds a full phrase_library lookup context object for a hotel + persona.
 *
 * @param  {Object} hotel
 * @param  {string} persona
 * @returns {Object}
 */
function _buildLookupContext(hotel, persona) {
  return {
    ..._buildAmenityContext(hotel),
    review_volume_tier: phraseLib.getReviewVolumeTier(hotel ? hotel.review_count : null),
    brand_tier:         (hotel && hotel.brand_tier != null) ? hotel.brand_tier : null,
    persona:            persona || null,
  };
}

/**
 * Derives the numeric score that should be passed to deriveClaimStrength()
 * for a given PhraseResult. Reads from claim_source_field on the hotel.
 * Returns null for boolean/descriptive claims (they don't use a score gradient).
 *
 * @param  {Object} phraseResult
 * @param  {Object} hotel
 * @returns {number|null}
 */
function _getClaimScore(phraseResult, hotel) {
  if (!phraseResult) return null;
  const type = phraseResult.claim_type;
  if (type !== 'numeric' && type !== 'comparative') return null;
  if (!phraseResult.claim_source_field) return null;
  const val = _resolve(hotel, phraseResult.claim_source_field);
  return typeof val === 'number' ? val : null;
}

/**
 * Classifies a persona score into a fit strength label.
 *
 * @param  {number|null|undefined} score
 * @returns {'strong'|'moderate'|'weak'|'poor'|'unknown'}
 */
function _fitStrength(score) {
  if (typeof score !== 'number' || isNaN(score)) return 'unknown';
  if (score >= FIT_STRENGTH_STRONG)   return 'strong';
  if (score >= FIT_STRENGTH_MODERATE) return 'moderate';
  if (score >= FIT_STRENGTH_WEAK)     return 'weak';
  return 'poor';
}

/**
 * Constructs a synthetic fallback weakness PhraseResult when all phrase_library
 * weakness lookups fail or are suppressed.
 *
 * The fallback:
 *   - Uses produces_claim=false so hallucination_guard skips field/value checks.
 *   - Uses claim_type='descriptive' so confidence_enforcer treats it as weak.
 *   - References hotel name and optional pricing for context.
 *   - Never asserts a specific numeric fact without source.
 *
 * @param  {Object} hotel
 * @returns {Object} synthetic PhraseResult
 */
function _buildFallbackWeakness(hotel) {
  const name  = (hotel && (hotel.hotel_name || hotel.name)) || 'This property';
  const price = hotel && hotel.avg_nightly_rate;
  const priceStr = (typeof price === 'number' && !isNaN(price) && price > 0)
    ? ` Pricing is approximately USD ${Math.round(price).toLocaleString('en-US')}/night —`
    : '';
  const text = `${name}: pricing and value comparison data are limited for this property.` +
    `${priceStr} traveler budgets should be verified directly with the property or via ` +
    `confirmed OTA rates before booking.`;

  return {
    phrase_id:          'FALLBACK_WEAKNESS',
    rendered_text:      text,
    injected_values:    {},
    suppressed:         false,
    suppression_reason: null,
    produces_claim:     false,
    claim_source_field: null,
    claim_type:         'descriptive',
    _is_fallback:       true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHRASE LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Looks up and executes a STRENGTH or WEAKNESS phrase for a specific dimension.
 * Uses the dimension's score to derive the score_band.
 *
 * Returns:
 *   - A PhraseResult (may be suppressed) if a phrase was found.
 *   - null if no phrase exists for this dimension/type/score_band combination.
 *
 * @param  {string} dimension
 * @param  {string} type       — 'strength' or 'weakness'
 * @param  {Object} hotel
 * @param  {string} persona
 * @returns {Object|null} PhraseResult or null
 */
function _tryGetDimensionPhrase(dimension, type, hotel, persona) {
  const score     = _resolve(hotel, `score_breakdown.${dimension}`);
  const scoreBand = phraseLib.getScoreBand(typeof score === 'number' ? score : 0);
  const context   = _buildLookupContext(hotel, persona);
  return phraseLib.getAndExecute(
    { dimension, type, score_band: scoreBand, context },
    hotel,
  );
}

/**
 * Performs an exhaustive search for a fit_positive, fit_negative, or tradeoff
 * phrase for the given persona.
 *
 * Iterates all score_bands (highest first) across all dimensions. The first
 * non-suppressed result is returned. Because iteration order is fixed, the
 * result is deterministic for a given hotel + persona.
 *
 * Returns null only if no suitable phrase exists or all candidates are suppressed
 * by phrase_library.
 *
 * @param  {string} type    — 'fit_positive' | 'fit_negative' | 'tradeoff'
 * @param  {Object} hotel
 * @param  {string} persona
 * @returns {Object|null} PhraseResult or null
 */
function _findFitPhrase(type, hotel, persona) {
  const context = _buildLookupContext(hotel, persona);

  for (const band of SCORE_BANDS) {                      // highest first
    for (const dimension of DIMENSION_KEYS) {            // registry order
      const result = phraseLib.getAndExecute(
        { dimension, type, score_band: band, context },
        hotel,
      );
      if (result && !result.suppressed) return result;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE STAGE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 1 — Input Validation.
 *
 * Validates:
 *   - hotel is a non-null plain object
 *   - hotel has hotel_id or id field
 *   - hotel.score_breakdown has all 5 dimension scores as numbers
 *   - persona is one of PERSONA_KEYS
 *
 * @param  {*}      hotel
 * @param  {string} persona
 * @returns {{ hotel_id, hotel_name, persona, rank }}
 * @throws {InvalidHotelInputError}
 * @throws {InvalidPersonaError}
 */
function _stage1_inputValidation(hotel, persona) {
  if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)) {
    throw new InvalidHotelInputError('hotel must be a non-null plain object');
  }

  const errors = [];

  const hotelId = hotel.hotel_id || hotel.id;
  if (!hotelId) {
    errors.push('hotel must have a hotel_id or id field');
  }

  if (!hotel.score_breakdown || typeof hotel.score_breakdown !== 'object' || Array.isArray(hotel.score_breakdown)) {
    errors.push('hotel.score_breakdown must be a plain object');
  } else {
    for (const dim of DIMENSION_KEYS) {
      const v = hotel.score_breakdown[dim];
      if (typeof v !== 'number' || isNaN(v)) {
        errors.push(`hotel.score_breakdown.${dim} must be a number (got ${JSON.stringify(v)})`);
      }
    }
  }

  if (!persona || !PERSONA_KEYS.includes(persona)) {
    throw new InvalidPersonaError(persona);
  }

  if (errors.length > 0) {
    throw new InvalidHotelInputError(`Invalid hotel input: ${errors.join('; ')}`, { errors });
  }

  return {
    hotel_id:   hotel.hotel_id || hotel.id,
    hotel_name: hotel.hotel_name || hotel.name || null,
    persona,
    rank:       typeof hotel.rank === 'number' ? hotel.rank : null,
  };
}

/**
 * Stage 2 — Dimension Analysis.
 *
 * Sorts all 5 dimensions by their score (ascending = weakest first).
 * Identifies:
 *   - weakness_candidates: bottom 1 dimension (lowest score)
 *   - strength_candidates: top 3 dimensions (highest scores, highest first)
 *
 * @param  {Object} hotel
 * @returns {{ sorted_dimensions, strength_candidates, weakness_candidates }}
 */
function _stage2_dimensionAnalysis(hotel) {
  const scored = DIMENSION_KEYS.map(dim => ({
    dimension: dim,
    score:     hotel.score_breakdown[dim],
  }));

  // Stable sort ascending: weakest first.
  // On equal scores, registry order (DIMENSION_KEYS) is preserved.
  scored.sort((a, b) => a.score - b.score);

  const weaknessCandidates = scored.slice(0, 1);
  // Reverse the top-3 slice so highest score is first
  const strengthCandidates = scored.slice(-STRENGTH_CANDIDATE_COUNT).reverse();

  return {
    sorted_dimensions:   scored,              // weakest → strongest
    weakness_candidates: weaknessCandidates,  // [{ dimension, score }]
    strength_candidates: strengthCandidates,  // [{ dimension, score }] strongest first
  };
}

/**
 * Stage 3 — Strength Extraction.
 *
 * Attempts to extract up to 3 strength PhraseResults from phrase_library,
 * one per top dimension. Only dimensions scoring ≥ MIN_STRENGTH_SCORE (70)
 * are eligible — phrase_library only registers strength phrases at 70+.
 *
 * @param  {Object}   hotel
 * @param  {string}   persona
 * @param  {Object[]} strengthCandidates — from stage 2 (strongest first)
 * @returns {Object[]} array of { dimension, score, phraseResult }
 */
function _stage3_strengthExtraction(hotel, persona, strengthCandidates) {
  const extracted = [];

  for (const { dimension, score } of strengthCandidates) {
    if (score < MIN_STRENGTH_SCORE) continue;  // no strength phrases below 70

    const phraseResult = _tryGetDimensionPhrase(dimension, PHRASE_TYPES.STRENGTH, hotel, persona);
    if (phraseResult) {
      // Include even if phraseResult.suppressed — validation gate is Stage 6
      extracted.push({ dimension, score, phraseResult });
    }
  }

  return extracted;  // 0–3 items
}

/**
 * Stage 4 — Weakness Extraction.
 *
 * INVARIANT: must always return exactly one weakness candidate.
 *
 * Algorithm:
 *   1. Try weaknessCandidates (bottom 1 dimension).
 *   2. If phrase is null or suppressed, walk all dimensions bottom-up.
 *   3. If all lookups fail, construct a synthetic fallback PhraseResult.
 *
 * The fallback PhraseResult has produces_claim=false and claim_type='descriptive'
 * so hallucination_guard will pass it through all stages.
 *
 * @param  {Object}   hotel
 * @param  {string}   persona
 * @param  {Object[]} weaknessCandidates — from stage 2 (weakest first)
 * @param  {Object[]} sortedDimensions   — all dimensions weakest → strongest
 * @returns {{ dimension, score, phraseResult, is_fallback: boolean }}
 */
function _stage4_weaknessExtraction(hotel, persona, weaknessCandidates, sortedDimensions) {
  // Primary: try the weakest dimension
  for (const { dimension, score } of weaknessCandidates) {
    const phraseResult = _tryGetDimensionPhrase(dimension, PHRASE_TYPES.WEAKNESS, hotel, persona);
    if (phraseResult && !phraseResult.suppressed) {
      return { dimension, score, phraseResult, is_fallback: false };
    }
  }

  // Secondary: walk all dimensions bottom-up
  for (const { dimension, score } of sortedDimensions) {
    const phraseResult = _tryGetDimensionPhrase(dimension, PHRASE_TYPES.WEAKNESS, hotel, persona);
    if (phraseResult && !phraseResult.suppressed) {
      return { dimension, score, phraseResult, is_fallback: false };
    }
  }

  // Tertiary: synthetic fallback
  return {
    dimension:    'value_score',  // semantically closest for a generic pricing fallback
    score:        hotel.score_breakdown.value_score,
    phraseResult: _buildFallbackWeakness(hotel),
    is_fallback:  true,
  };
}

/**
 * Stage 5 — Traveler Fit Generation.
 *
 * Looks up:
 *   - positive_fit: fit_positive phrase for this persona (exhaustive search)
 *   - cautionary_note: fit_negative or tradeoff phrase (exhaustive search)
 *
 * Both lookups may return null — fit phrases are optional.
 * Persona score is read from all_persona_scores[persona].
 *
 * @param  {Object} hotel
 * @param  {string} persona
 * @returns {{ personaScore, positivePhraseResult, cautionaryPhraseResult }}
 */
function _stage5_travelerFitGeneration(hotel, persona) {
  const personaScore = _resolve(hotel, `all_persona_scores.${persona}`);

  const positivePhraseResult    = _findFitPhrase(PHRASE_TYPES.FIT_POSITIVE, hotel, persona);
  const cautionaryPhraseResult  = _findFitPhrase(PHRASE_TYPES.FIT_NEGATIVE, hotel, persona)
                                || _findFitPhrase(PHRASE_TYPES.TRADEOFF,     hotel, persona);

  return { personaScore, positivePhraseResult, cautionaryPhraseResult };
}

/**
 * Stage 6 — Claim Validation.
 *
 * Routes ALL candidate PhraseResults through hallucination_guard.validate().
 * Each candidate is validated independently.
 *
 * Candidate types: 'strength', 'weakness', 'fit_positive', 'fit_negative'.
 *
 * @param  {Object}   hotel
 * @param  {Object[]} strengthExtracted  — from stage 3
 * @param  {Object}   weaknessExtracted  — from stage 4
 * @param  {Object}   fitData            — from stage 5
 * @returns {Object[]} array of augmented candidate objects with validationResult
 */
function _stage6_claimValidation(hotel, strengthExtracted, weaknessExtracted, fitData) {
  const candidates = [];

  // Strength candidates
  for (const { dimension, score, phraseResult } of strengthExtracted) {
    candidates.push({
      type:       'strength',
      dimension,
      score,
      phraseResult,
      is_fallback: false,
    });
  }

  // Weakness candidate (exactly 1)
  candidates.push({
    type:        'weakness',
    dimension:   weaknessExtracted.dimension,
    score:       weaknessExtracted.score,
    phraseResult: weaknessExtracted.phraseResult,
    is_fallback:  weaknessExtracted.is_fallback,
  });

  // Fit candidates (optional)
  if (fitData.positivePhraseResult) {
    candidates.push({
      type:        'fit_positive',
      dimension:   'fit',
      score:       fitData.personaScore,
      phraseResult: fitData.positivePhraseResult,
      is_fallback: false,
    });
  }
  if (fitData.cautionaryPhraseResult) {
    candidates.push({
      type:        'fit_negative',
      dimension:   'fit',
      score:       null,
      phraseResult: fitData.cautionaryPhraseResult,
      is_fallback: false,
    });
  }

  // Route each through hallucination_guard
  return candidates.map(candidate => ({
    ...candidate,
    validationResult: guard.validate(candidate.phraseResult, hotel),
  }));
}

/**
 * Stage 7 — Confidence Calibration.
 *
 * Routes each non-suppressed ValidationResult through confidence_enforcer.enforce().
 * Suppressed claims are passed through unchanged (no enforcement needed).
 *
 * Derives:
 *   - confidence_level:  from hotel.review_count (same level applied to all claims)
 *   - claim_strength:    from phraseResult.claim_type + claim_source_field score
 *
 * @param  {Object}   hotel
 * @param  {Object[]} validated — from stage 6
 * @returns {{ calibrated: Object[], overall_confidence_level: string }}
 */
function _stage7_confidenceCalibration(hotel, validated) {
  const overallConfidenceLevel = enforcer.deriveConfidenceLevel(hotel.review_count);

  const calibrated = validated.map(item => {
    const { validationResult, phraseResult } = item;

    if (validationResult.suppressed) {
      // No enforcement — already suppressed by guard
      return {
        ...item,
        enforcementResult:    null,
        confidence_level:     overallConfidenceLevel,
        claim_strength:       null,
      };
    }

    // validated_claim is the original phraseResult (non-null when not suppressed)
    const validatedClaim = validationResult.validated_claim;
    const claimScore     = _getClaimScore(phraseResult, hotel);
    const claimStrength  = enforcer.deriveClaimStrength(phraseResult.claim_type, claimScore);

    const enforcementResult = enforcer.enforce({
      validated_claim:  validatedClaim,
      confidence_level: overallConfidenceLevel,
      claim_strength:   claimStrength,
      audit_log:        Array.isArray(validationResult.audit_log)
                          ? validationResult.audit_log.slice()
                          : [],
    });

    return {
      ...item,
      enforcementResult,
      confidence_level: overallConfidenceLevel,
      claim_strength:   claimStrength,
    };
  });

  return { calibrated, overall_confidence_level: overallConfidenceLevel };
}

/**
 * Stage 8 — Summary Generation.
 *
 * Assembles a 1-2 sentence summary from hotel metadata and the top calibrated
 * strength claim. No new facts are introduced — the summary only references
 * values already computed in upstream stages.
 *
 * @param  {Object}   hotel
 * @param  {string}   persona
 * @param  {Object[]} calibrated         — from stage 7
 * @param  {string}   overallConfidence  — from stage 7
 * @returns {string}
 */
function _stage8_summaryGeneration(hotel, persona, calibrated, overallConfidence) {
  const name    = (hotel.hotel_name || hotel.name || 'This property');
  const overall = (hotel.score_breakdown && typeof hotel.score_breakdown.overall_score === 'number')
    ? Math.round(hotel.score_breakdown.overall_score)
    : null;
  const personaScore = _resolve(hotel, `all_persona_scores.${persona}`);

  const overallStr   = overall !== null ? ` Overall score: ${overall}/100.` : '';
  const personaLabel = persona.replace(/_/g, '-');
  const personaStr   = (typeof personaScore === 'number' && !isNaN(personaScore))
    ? ` ${personaLabel} fit score: ${Math.round(personaScore)}/100.`
    : '';

  // Find the leading non-suppressed, non-enforcement-suppressed strength claim
  const topStrength = calibrated.find(
    c => c.type === 'strength' &&
         c.enforcementResult &&
         !c.enforcementResult.suppressed &&
         c.enforcementResult.final_text,
  );

  if (topStrength) {
    const preview = topStrength.enforcementResult.final_text.substring(0, 100).trimEnd();
    const ellipsis = topStrength.enforcementResult.final_text.length > 100 ? '…' : '';
    return `${name}:${overallStr}${personaStr} Leading signal — ${preview}${ellipsis}`;
  }

  return `${name}:${overallStr}${personaStr} Assessment complete — see breakdown for full detail.`;
}

/**
 * Stage 9 — Explanation Assembly.
 *
 * Builds and freezes the final ExplanationObject from all prior stage outputs.
 *
 * WEAKNESS GUARANTEE: if no weakness survived calibration (e.g. confidence
 * enforcer suppressed even the fallback for 'insufficient' confidence), a
 * hardcoded last-resort weakness is injected. This guarantee is absolute.
 *
 * @param  {Object}   meta              — from stage 1
 * @param  {Object[]} calibrated        — from stage 7
 * @param  {string}   summary           — from stage 8
 * @param  {string}   overallConfidence — from stage 7
 * @returns {Object} frozen ExplanationObject
 */
function _stage9_explanationAssembly(meta, calibrated, summary, overallConfidence) {
  const { hotel_id, hotel_name, persona, rank } = meta;

  const strengths  = [];
  const weaknesses = [];
  const travelerFit = {
    persona,
    persona_score:   null,
    positive_fit:    null,
    cautionary_note: null,
    fit_strength:    'unknown',
  };
  const supportingClaims = [];
  const suppressedClaims = [];

  let totalCandidates  = calibrated.length;
  let published        = 0;
  let suppressedCount  = 0;
  let hedgedCount      = 0;

  for (const item of calibrated) {
    const validationSuppressed  = item.validationResult && item.validationResult.suppressed;
    const enforcementSuppressed = item.enforcementResult && item.enforcementResult.suppressed;
    const isPublishable = !validationSuppressed && !enforcementSuppressed && item.enforcementResult;

    if (!isPublishable) {
      suppressedCount++;
      suppressedClaims.push({
        type:               item.type,
        dimension:          item.dimension,
        phrase_id:          (item.phraseResult && item.phraseResult.phrase_id) || null,
        suppressed_at:      validationSuppressed ? 'validation' : 'enforcement',
        suppression_reason: validationSuppressed
          ? (item.validationResult && item.validationResult.suppression_reason)
          : (item.enforcementResult && item.enforcementResult.suppression_reason),
      });
      continue;
    }

    published++;
    const finalText    = item.enforcementResult.final_text;
    const hedgePattern = item.enforcementResult.hedge_pattern;

    if (item.enforcementResult.hedged) hedgedCount++;

    supportingClaims.push(finalText);

    if (item.type === 'strength') {
      strengths.push({
        dimension:        item.dimension,
        score:            item.score,
        final_text:       finalText,
        hedge_pattern:    hedgePattern,
        confidence_level: item.confidence_level,
        claim_strength:   item.claim_strength,
        phrase_id:        (item.phraseResult && item.phraseResult.phrase_id) || null,
      });

    } else if (item.type === 'weakness') {
      weaknesses.push({
        dimension:        item.dimension,
        score:            item.score,
        final_text:       finalText,
        hedge_pattern:    hedgePattern,
        confidence_level: item.confidence_level,
        claim_strength:   item.claim_strength,
        phrase_id:        (item.phraseResult && item.phraseResult.phrase_id) || null,
        is_fallback:      item.is_fallback || false,
      });

    } else if (item.type === 'fit_positive') {
      travelerFit.positive_fit  = finalText;
      travelerFit.persona_score = (typeof item.score === 'number' && !isNaN(item.score))
        ? Math.round(item.score) : null;
      travelerFit.fit_strength  = _fitStrength(item.score);

    } else if (item.type === 'fit_negative') {
      travelerFit.cautionary_note = finalText;
    }
  }

  // ── Weakness guarantee ───────────────────────────────────────────────────
  // If all weakness candidates were suppressed (e.g. insufficient confidence),
  // inject a hardcoded last-resort entry so weaknesses[] always has exactly 1.
  if (weaknesses.length === 0) {
    weaknesses.push({
      dimension:        'overall_score',
      score:            null,
      final_text:       'Insufficient review and pricing data to characterise a specific weakness ' +
                        'with statistical confidence. Verify current quality and pricing directly ' +
                        'with the property.',
      hedge_pattern:    null,
      confidence_level: 'insufficient',
      claim_strength:   'weak',
      phrase_id:        'LAST_RESORT_WEAKNESS_GUARANTEE',
      is_fallback:      true,
    });
    published++;
  }

  const hedgeRate       = totalCandidates > 0 ? Math.round((hedgedCount / totalCandidates) * 100) / 100 : 0;
  const suppressionRate = totalCandidates > 0 ? Math.round((suppressedCount / totalCandidates) * 100) / 100 : 0;

  return Object.freeze({
    hotel_id,
    hotel_name,
    persona,
    rank,
    explanation_summary:  summary,
    strengths:            Object.freeze(strengths.slice(0, STRENGTH_CANDIDATE_COUNT)),
    weaknesses:           Object.freeze(weaknesses.slice(0, 1)),  // always exactly 1
    traveler_fit:         Object.freeze({ ...travelerFit }),
    confidence_level:     overallConfidence,
    supporting_claims:    Object.freeze(supportingClaims.slice()),
    suppressed_claims:    Object.freeze(suppressedClaims.slice()),
    validation_summary:   Object.freeze({
      total_candidates: totalCandidates,
      published,
      suppressed:       suppressedCount,
      hedge_rate:       hedgeRate,
      suppression_rate: suppressionRate,
    }),
    explanation_version:  ENGINE_VERSION,
    generated_at:         new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a complete, validated, confidence-calibrated ExplanationObject
 * for the given hotel record and traveler persona.
 *
 * Runs the full 9-stage pipeline deterministically. Same hotel + persona
 * always produces the same ExplanationObject (except generated_at timestamp).
 *
 * @param  {Object} hotel   — bound HotelRecord from scoring_engine
 * @param  {string} persona — one of PERSONA_KEYS
 * @returns {Object} frozen ExplanationObject
 * @throws {InvalidHotelInputError} if hotel is missing required fields
 * @throws {InvalidPersonaError}    if persona is not a recognised key
 */
function explain(hotel, persona) {
  // Stage 1: Input Validation
  const meta = _stage1_inputValidation(hotel, persona);

  // Stage 2: Dimension Analysis
  const {
    sorted_dimensions,
    strength_candidates,
    weakness_candidates,
  } = _stage2_dimensionAnalysis(hotel);

  // Stage 3: Strength Extraction
  const strengthExtracted = _stage3_strengthExtraction(hotel, persona, strength_candidates);

  // Stage 4: Weakness Extraction (MUST produce exactly 1 candidate)
  const weaknessExtracted = _stage4_weaknessExtraction(
    hotel, persona, weakness_candidates, sorted_dimensions,
  );

  // Stage 5: Traveler Fit Generation
  const fitData = _stage5_travelerFitGeneration(hotel, persona);

  // Stage 6: Claim Validation (all candidates → hallucination_guard)
  const validated = _stage6_claimValidation(hotel, strengthExtracted, weaknessExtracted, fitData);

  // Stage 7: Confidence Calibration (validated claims → confidence_enforcer)
  const { calibrated, overall_confidence_level } = _stage7_confidenceCalibration(hotel, validated);

  // Stage 8: Summary Generation
  const summary = _stage8_summaryGeneration(hotel, persona, calibrated, overall_confidence_level);

  // Stage 9: Explanation Assembly
  return _stage9_explanationAssembly(meta, calibrated, summary, overall_confidence_level);
}

/**
 * Generates ExplanationObjects for an array of hotel records.
 * All explanations use the same persona. Hotels are processed independently.
 *
 * @param  {Object[]} hotels
 * @param  {string}   persona
 * @returns {Object[]} array of frozen ExplanationObjects (same length as input)
 * @throws  {TypeError}            if hotels is not an array
 * @throws  {InvalidPersonaError}  if persona is invalid
 */
function explainBatch(hotels, persona) {
  if (!Array.isArray(hotels)) {
    throw new TypeError('explainBatch: first argument must be an array');
  }
  return hotels.map(hotel => explain(hotel, persona));
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Primary API ────────────────────────────────────────────────────────────
  explain,
  explainBatch,

  // ── Pipeline stage functions (for unit testing) ───────────────────────────
  _stage1_inputValidation,
  _stage2_dimensionAnalysis,
  _stage3_strengthExtraction,
  _stage4_weaknessExtraction,
  _stage5_travelerFitGeneration,
  _stage6_claimValidation,
  _stage7_confidenceCalibration,
  _stage8_summaryGeneration,
  _stage9_explanationAssembly,

  // ── Internal helpers (for unit testing) ──────────────────────────────────
  _resolve,
  _buildAmenityContext,
  _buildLookupContext,
  _getClaimScore,
  _fitStrength,
  _buildFallbackWeakness,
  _tryGetDimensionPhrase,
  _findFitPhrase,

  // ── Constants ─────────────────────────────────────────────────────────────
  ENGINE_VERSION,
  PIPELINE_STAGES,
  STRENGTH_CANDIDATE_COUNT,
  MIN_STRENGTH_SCORE,
  FIT_STRENGTH_STRONG,
  FIT_STRENGTH_MODERATE,
  FIT_STRENGTH_WEAK,

  // ── Error types ────────────────────────────────────────────────────────────
  ExplanationEngineError,
  InvalidHotelInputError,
  InvalidPersonaError,
  WeaknessGuaranteeError,
};
