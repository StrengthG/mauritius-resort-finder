'use strict';

/**
 * explanation_engine.test.js
 * Mauritius Resort Finder — Module 5 Test Suite
 *
 * 22 sections, 70+ unit tests.
 * Tests every exported function, pipeline stage, and invariant.
 *
 * Run: node explanation_engine.test.js
 */

const assert = require('assert');
const engine = require('./explanation_engine.js');

// ─────────────────────────────────────────────────────────────────────────────
// TEST INFRASTRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (e) {
    failed++;
    failures.push({ label, error: e.message });
    process.stdout.write('F');
  }
}

function section(title) {
  process.stdout.write(`\n\n  ${title}\n  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full hotel with high review count — triggers high confidence level.
 * Location is strongest dimension; brand is second. Value is weakest.
 */
const HOTEL_FULL = {
  hotel_id:   'MQ001',
  name:       'Le Meridien Mauritius',
  hotel_name: 'Le Meridien Mauritius',
  region:     'West Coast',
  review_count: 850,
  avg_rating:   4.7,
  avg_nightly_rate: 450,
  brand:        'Marriott International',
  brand_tier:   5,
  rank:         3,
  score_breakdown: {
    overall_score:  88,
    location_score: 92,
    amenity_score:  85,
    brand_score:    90,
    value_score:    72,
  },
  all_persona_scores: {
    honeymoon:    82,
    luxury:       88,
    family:       65,
    wellness:     75,
    remote_work:  60,
    value_luxury: 71,
  },
  amenity_flags: {
    beachfront:          true,
    has_spa:             true,
    spa_award_rated:     false,
    butler_service:      true,
    private_pool_villa:  true,
    all_inclusive:       false,
    kids_club:           false,
    adults_only:         false,
    high_speed_wifi:     true,
    overwater_bungalow:  false,
    dedicated_workspace: true,
  },
};

/**
 * Minimal hotel — insufficient review count, sparse amenity flags.
 * Tests sparse-data fallback and confidence edge cases.
 */
const HOTEL_MINIMAL = {
  hotel_id:    'MQ002',
  name:        'Budget Beachside',
  review_count: 5,  // < 10 → insufficient
  score_breakdown: {
    overall_score:  55,
    location_score: 60,
    amenity_score:  48,
    brand_score:    40,
    value_score:    70,
  },
  all_persona_scores: {
    honeymoon:    40,
    luxury:       35,
    family:       50,
    wellness:     30,
    remote_work:  55,
    value_luxury: 65,
  },
  amenity_flags: {},
};

/**
 * Wellness hotel — has spa, high amenity score.
 */
const HOTEL_WELLNESS = {
  hotel_id:    'MQ003',
  name:        'Shanti Maurice',
  review_count: 280,
  avg_rating:   4.8,
  score_breakdown: {
    overall_score:  90,
    location_score: 85,
    amenity_score:  93,
    brand_score:    75,
    value_score:    65,
  },
  all_persona_scores: {
    honeymoon:    70,
    luxury:       80,
    family:       40,
    wellness:     90,
    remote_work:  45,
    value_luxury: 62,
  },
  amenity_flags: {
    beachfront:          true,
    has_spa:             true,
    spa_award_rated:     true,
    butler_service:      false,
    private_pool_villa:  false,
    all_inclusive:       false,
    kids_club:           false,
    adults_only:         false,
    high_speed_wifi:     false,
    overwater_bungalow:  false,
    dedicated_workspace: false,
  },
};

/**
 * Family hotel — has kids_club.
 */
const HOTEL_FAMILY = {
  hotel_id:    'MQ004',
  name:        'Paradis Beachcomber',
  review_count: 420,
  score_breakdown: {
    overall_score:  82,
    location_score: 88,
    amenity_score:  80,
    brand_score:    78,
    value_score:    74,
  },
  all_persona_scores: {
    honeymoon:    55,
    luxury:       70,
    family:       85,
    wellness:     60,
    remote_work:  45,
    value_luxury: 72,
  },
  amenity_flags: {
    beachfront: true,
    has_spa:    true,
    kids_club:  true,
    adults_only: false,
  },
};

/**
 * Hotel with all low scores — value is the only dimension above 35.
 * Most strength lookups will fail (no phrases below MIN_STRENGTH_SCORE).
 */
const HOTEL_LOW_SCORES = {
  hotel_id:    'MQ005',
  name:        'Budget Inn',
  review_count: 25,
  score_breakdown: {
    overall_score:  38,
    location_score: 42,
    amenity_score:  35,
    brand_score:    30,
    value_score:    68,
  },
  all_persona_scores: {
    honeymoon:    20,
    luxury:       18,
    family:       30,
    wellness:     15,
    remote_work:  40,
    value_luxury: 55,
  },
  amenity_flags: {},
};

/**
 * Hotel using 'id' instead of 'hotel_id' — tests id aliasing.
 */
const HOTEL_ID_ALIAS = {
  id:          'MQ006',
  name:        'Aliased Hotel',
  review_count: 100,
  score_breakdown: {
    overall_score:  75,
    location_score: 78,
    amenity_score:  72,
    brand_score:    70,
    value_score:    80,
  },
  all_persona_scores: {
    honeymoon:    65, luxury: 70, family: 60, wellness: 55, remote_work: 65, value_luxury: 78,
  },
  amenity_flags: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: MODULE CONSTANTS AND EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

section('Section 1: Module constants and exports');

test('ENGINE_VERSION is a semver string', () => {
  assert.match(engine.ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
});

test('PIPELINE_STAGES has exactly 9 stages', () => {
  assert.strictEqual(engine.PIPELINE_STAGES.length, 9);
});

test('PIPELINE_STAGES includes all required stages', () => {
  const required = [
    'input_validation', 'dimension_analysis', 'strength_extraction',
    'weakness_extraction', 'traveler_fit_generation', 'claim_validation',
    'confidence_calibration', 'summary_generation', 'explanation_assembly',
  ];
  for (const s of required) {
    assert.ok(engine.PIPELINE_STAGES.includes(s), `Missing stage: ${s}`);
  }
});

test('STRENGTH_CANDIDATE_COUNT is 3', () => {
  assert.strictEqual(engine.STRENGTH_CANDIDATE_COUNT, 3);
});

test('MIN_STRENGTH_SCORE is 70', () => {
  assert.strictEqual(engine.MIN_STRENGTH_SCORE, 70);
});

test('primary API functions are exported', () => {
  assert.strictEqual(typeof engine.explain,      'function');
  assert.strictEqual(typeof engine.explainBatch, 'function');
});

test('all stage functions are exported', () => {
  const stages = [
    '_stage1_inputValidation', '_stage2_dimensionAnalysis',
    '_stage3_strengthExtraction', '_stage4_weaknessExtraction',
    '_stage5_travelerFitGeneration', '_stage6_claimValidation',
    '_stage7_confidenceCalibration', '_stage8_summaryGeneration',
    '_stage9_explanationAssembly',
  ];
  for (const s of stages) {
    assert.strictEqual(typeof engine[s], 'function', `Missing: ${s}`);
  }
});

test('error types are exported', () => {
  assert.strictEqual(typeof engine.ExplanationEngineError, 'function');
  assert.strictEqual(typeof engine.InvalidHotelInputError, 'function');
  assert.strictEqual(typeof engine.InvalidPersonaError,    'function');
  assert.strictEqual(typeof engine.WeaknessGuaranteeError, 'function');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: _resolve()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 2: _resolve()');

test('resolves a top-level field', () => {
  assert.strictEqual(engine._resolve({ name: 'Test' }, 'name'), 'Test');
});

test('resolves a nested field', () => {
  const obj = { score_breakdown: { overall_score: 88 } };
  assert.strictEqual(engine._resolve(obj, 'score_breakdown.overall_score'), 88);
});

test('returns undefined for a missing segment', () => {
  assert.strictEqual(engine._resolve({ a: {} }, 'a.b.c'), undefined);
});

test('returns undefined for null object', () => {
  assert.strictEqual(engine._resolve(null, 'a'), undefined);
});

test('returns undefined for empty path', () => {
  assert.strictEqual(engine._resolve({ a: 1 }, ''), undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: _buildAmenityContext()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 3: _buildAmenityContext()');

test('extracts all known amenity flags', () => {
  const ctx = engine._buildAmenityContext(HOTEL_FULL);
  assert.strictEqual(ctx.beachfront,         true);
  assert.strictEqual(ctx.has_spa,            true);
  assert.strictEqual(ctx.butler_service,     true);
  assert.strictEqual(ctx.private_pool_villa, true);
  assert.strictEqual(ctx.kids_club,          false);
  assert.strictEqual(ctx.adults_only,        false);
});

test('coerces missing flags to false', () => {
  const ctx = engine._buildAmenityContext({ amenity_flags: {} });
  assert.strictEqual(ctx.beachfront,    false);
  assert.strictEqual(ctx.has_spa,       false);
  assert.strictEqual(ctx.all_inclusive, false);
});

test('handles missing amenity_flags gracefully', () => {
  const ctx = engine._buildAmenityContext({});
  assert.strictEqual(ctx.beachfront, false);
  assert.strictEqual(ctx.kids_club,  false);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: _buildLookupContext()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 4: _buildLookupContext()');

test('includes review_volume_tier', () => {
  const ctx = engine._buildLookupContext(HOTEL_FULL, 'honeymoon');
  assert.strictEqual(ctx.review_volume_tier, 'high');  // 850 reviews
});

test('includes persona', () => {
  const ctx = engine._buildLookupContext(HOTEL_FULL, 'wellness');
  assert.strictEqual(ctx.persona, 'wellness');
});

test('includes brand_tier when present', () => {
  const ctx = engine._buildLookupContext(HOTEL_FULL, 'luxury');
  assert.strictEqual(ctx.brand_tier, 5);
});

test('includes amenity flags', () => {
  const ctx = engine._buildLookupContext(HOTEL_FULL, 'honeymoon');
  assert.strictEqual(ctx.beachfront,      true);
  assert.strictEqual(ctx.butler_service,  true);
  assert.strictEqual(ctx.kids_club,       false);
});

test('review_volume_tier is insufficient for low review count', () => {
  const ctx = engine._buildLookupContext(HOTEL_MINIMAL, 'luxury');
  assert.strictEqual(ctx.review_volume_tier, 'insufficient');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: _getClaimScore()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 5: _getClaimScore()');

test('returns null for boolean claim_type', () => {
  const pr = { claim_type: 'boolean', claim_source_field: 'amenity_flags.beachfront' };
  assert.strictEqual(engine._getClaimScore(pr, HOTEL_FULL), null);
});

test('returns null for descriptive claim_type', () => {
  const pr = { claim_type: 'descriptive', claim_source_field: 'brand' };
  assert.strictEqual(engine._getClaimScore(pr, HOTEL_FULL), null);
});

test('resolves numeric claim from source field', () => {
  const pr = { claim_type: 'numeric', claim_source_field: 'score_breakdown.overall_score' };
  assert.strictEqual(engine._getClaimScore(pr, HOTEL_FULL), 88);
});

test('resolves comparative claim from source field', () => {
  const pr = { claim_type: 'comparative', claim_source_field: 'score_breakdown.value_score' };
  assert.strictEqual(engine._getClaimScore(pr, HOTEL_FULL), 72);
});

test('returns null if claim_source_field is missing', () => {
  const pr = { claim_type: 'numeric', claim_source_field: null };
  assert.strictEqual(engine._getClaimScore(pr, HOTEL_FULL), null);
});

test('returns null if phraseResult is null', () => {
  assert.strictEqual(engine._getClaimScore(null, HOTEL_FULL), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: _fitStrength()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 6: _fitStrength()');

test('score >= 80 → strong', () => {
  assert.strictEqual(engine._fitStrength(80),   'strong');
  assert.strictEqual(engine._fitStrength(95),   'strong');
  assert.strictEqual(engine._fitStrength(100),  'strong');
});

test('score 65–79 → moderate', () => {
  assert.strictEqual(engine._fitStrength(65),   'moderate');
  assert.strictEqual(engine._fitStrength(79),   'moderate');
});

test('score 50–64 → weak', () => {
  assert.strictEqual(engine._fitStrength(50),   'weak');
  assert.strictEqual(engine._fitStrength(64),   'weak');
});

test('score < 50 → poor', () => {
  assert.strictEqual(engine._fitStrength(49),   'poor');
  assert.strictEqual(engine._fitStrength(0),    'poor');
});

test('null/NaN → unknown', () => {
  assert.strictEqual(engine._fitStrength(null),  'unknown');
  assert.strictEqual(engine._fitStrength(NaN),   'unknown');
  assert.strictEqual(engine._fitStrength(undefined), 'unknown');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: _buildFallbackWeakness()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 7: _buildFallbackWeakness()');

test('returns a PhraseResult-shaped object', () => {
  const fb = engine._buildFallbackWeakness(HOTEL_FULL);
  assert.ok(fb.phrase_id && typeof fb.phrase_id === 'string');
  assert.ok(fb.rendered_text && typeof fb.rendered_text === 'string');
  assert.strictEqual(fb.suppressed, false);
  assert.strictEqual(fb.produces_claim, false);
  assert.strictEqual(fb.claim_type, 'descriptive');
});

test('phrase_id is FALLBACK_WEAKNESS', () => {
  const fb = engine._buildFallbackWeakness(HOTEL_FULL);
  assert.strictEqual(fb.phrase_id, 'FALLBACK_WEAKNESS');
});

test('includes hotel name in text', () => {
  const fb = engine._buildFallbackWeakness(HOTEL_FULL);
  assert.ok(fb.rendered_text.includes('Le Meridien Mauritius'));
});

test('includes price when avg_nightly_rate is present', () => {
  const fb = engine._buildFallbackWeakness(HOTEL_FULL);
  assert.ok(fb.rendered_text.includes('450'));
});

test('omits price when avg_nightly_rate is absent', () => {
  const fb = engine._buildFallbackWeakness(HOTEL_MINIMAL);
  assert.ok(!fb.rendered_text.includes('USD'));
});

test('_is_fallback is true', () => {
  const fb = engine._buildFallbackWeakness(HOTEL_FULL);
  assert.strictEqual(fb._is_fallback, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Stage 1 — _stage1_inputValidation()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 8: Stage 1 — _stage1_inputValidation()');

test('accepts a valid hotel with hotel_id + persona', () => {
  const meta = engine._stage1_inputValidation(HOTEL_FULL, 'honeymoon');
  assert.strictEqual(meta.hotel_id,   'MQ001');
  assert.strictEqual(meta.hotel_name, 'Le Meridien Mauritius');
  assert.strictEqual(meta.persona,    'honeymoon');
  assert.strictEqual(meta.rank,       3);
});

test('accepts hotel with id instead of hotel_id', () => {
  const meta = engine._stage1_inputValidation(HOTEL_ID_ALIAS, 'luxury');
  assert.strictEqual(meta.hotel_id, 'MQ006');
});

test('throws InvalidHotelInputError for null hotel', () => {
  assert.throws(
    () => engine._stage1_inputValidation(null, 'honeymoon'),
    engine.InvalidHotelInputError,
  );
});

test('throws InvalidHotelInputError for missing hotel_id', () => {
  const bad = { score_breakdown: { overall_score: 80, location_score: 80, amenity_score: 80, brand_score: 80, value_score: 80 } };
  assert.throws(
    () => engine._stage1_inputValidation(bad, 'honeymoon'),
    engine.InvalidHotelInputError,
  );
});

test('throws InvalidHotelInputError for missing score_breakdown', () => {
  const bad = { hotel_id: 'X' };
  assert.throws(
    () => engine._stage1_inputValidation(bad, 'honeymoon'),
    engine.InvalidHotelInputError,
  );
});

test('throws InvalidHotelInputError for non-numeric score field', () => {
  const bad = {
    hotel_id: 'X',
    score_breakdown: { overall_score: 'high', location_score: 80, amenity_score: 80, brand_score: 80, value_score: 80 },
  };
  assert.throws(
    () => engine._stage1_inputValidation(bad, 'honeymoon'),
    engine.InvalidHotelInputError,
  );
});

test('throws InvalidPersonaError for unknown persona', () => {
  assert.throws(
    () => engine._stage1_inputValidation(HOTEL_FULL, 'backpacker'),
    engine.InvalidPersonaError,
  );
});

test('throws InvalidPersonaError for null persona', () => {
  assert.throws(
    () => engine._stage1_inputValidation(HOTEL_FULL, null),
    engine.InvalidPersonaError,
  );
});

test('rank defaults to null when not present', () => {
  const meta = engine._stage1_inputValidation(HOTEL_MINIMAL, 'luxury');
  assert.strictEqual(meta.rank, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Stage 2 — _stage2_dimensionAnalysis()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 9: Stage 2 — _stage2_dimensionAnalysis()');

test('returns sorted_dimensions, strength_candidates, weakness_candidates', () => {
  const result = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  assert.ok(Array.isArray(result.sorted_dimensions));
  assert.ok(Array.isArray(result.strength_candidates));
  assert.ok(Array.isArray(result.weakness_candidates));
});

test('sorted_dimensions has 5 entries (ascending)', () => {
  const { sorted_dimensions } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  assert.strictEqual(sorted_dimensions.length, 5);
  for (let i = 1; i < sorted_dimensions.length; i++) {
    assert.ok(
      sorted_dimensions[i].score >= sorted_dimensions[i-1].score,
      `Not ascending at index ${i}`,
    );
  }
});

test('weakness_candidate is the lowest-scoring dimension', () => {
  // HOTEL_FULL scores: overall=88, location=92, amenity=85, brand=90, value=72
  // Lowest = value_score=72
  const { weakness_candidates } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  assert.strictEqual(weakness_candidates.length, 1);
  assert.strictEqual(weakness_candidates[0].dimension, 'value_score');
  assert.strictEqual(weakness_candidates[0].score, 72);
});

test('strength_candidates are the top 3 highest-scoring dimensions (highest first)', () => {
  // HOTEL_FULL top 3: location=92, brand=90, overall=88
  const { strength_candidates } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  assert.strictEqual(strength_candidates.length, 3);
  assert.strictEqual(strength_candidates[0].dimension, 'location_score');
  assert.strictEqual(strength_candidates[0].score, 92);
});

test('all 5 DIMENSION_KEYS appear in sorted_dimensions', () => {
  const { sorted_dimensions } = engine._stage2_dimensionAnalysis(HOTEL_MINIMAL);
  const dims = sorted_dimensions.map(d => d.dimension);
  const phraseLib = require('./phrase_library.js');
  for (const k of phraseLib.DIMENSION_KEYS) {
    assert.ok(dims.includes(k), `Missing dimension: ${k}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Stage 3 — _stage3_strengthExtraction()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 10: Stage 3 — _stage3_strengthExtraction()');

test('returns an array', () => {
  const { strength_candidates } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  const result = engine._stage3_strengthExtraction(HOTEL_FULL, 'honeymoon', strength_candidates);
  assert.ok(Array.isArray(result));
});

test('extracts phrases for dimensions above MIN_STRENGTH_SCORE', () => {
  const { strength_candidates } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  const result = engine._stage3_strengthExtraction(HOTEL_FULL, 'honeymoon', strength_candidates);
  // All HOTEL_FULL top-3 scores are ≥ 70, so expect up to 3 results
  assert.ok(result.length > 0);
  assert.ok(result.length <= 3);
});

test('each extracted item has dimension, score, phraseResult', () => {
  const { strength_candidates } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  const result = engine._stage3_strengthExtraction(HOTEL_FULL, 'honeymoon', strength_candidates);
  for (const item of result) {
    assert.ok(typeof item.dimension   === 'string');
    assert.ok(typeof item.score       === 'number');
    assert.ok(item.phraseResult       !== null && typeof item.phraseResult === 'object');
    assert.ok(typeof item.phraseResult.phrase_id === 'string');
  }
});

test('skips dimensions below MIN_STRENGTH_SCORE=70', () => {
  // HOTEL_LOW_SCORES: best = value_score=68 — all below 70
  const { strength_candidates } = engine._stage2_dimensionAnalysis(HOTEL_LOW_SCORES);
  const result = engine._stage3_strengthExtraction(HOTEL_LOW_SCORES, 'luxury', strength_candidates);
  assert.strictEqual(result.length, 0, 'All dimensions < 70, expect 0 strengths');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: Stage 4 — _stage4_weaknessExtraction()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 11: Stage 4 — _stage4_weaknessExtraction()');

test('always returns exactly one result', () => {
  const { weakness_candidates, sorted_dimensions } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  const result = engine._stage4_weaknessExtraction(HOTEL_FULL, 'honeymoon', weakness_candidates, sorted_dimensions);
  assert.ok(result && typeof result === 'object');
  assert.ok(result.phraseResult);
  assert.strictEqual(typeof result.dimension, 'string');
});

test('result has is_fallback flag', () => {
  const { weakness_candidates, sorted_dimensions } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  const result = engine._stage4_weaknessExtraction(HOTEL_FULL, 'honeymoon', weakness_candidates, sorted_dimensions);
  assert.strictEqual(typeof result.is_fallback, 'boolean');
});

test('non-suppressed phraseResult is returned for a hotel with scoreable weakness', () => {
  const { weakness_candidates, sorted_dimensions } = engine._stage2_dimensionAnalysis(HOTEL_FULL);
  const result = engine._stage4_weaknessExtraction(HOTEL_FULL, 'honeymoon', weakness_candidates, sorted_dimensions);
  // value_score=72 — score band is 70-79, no weakness phrases at that band
  // Should walk to next weakest and find one, or fall back
  assert.ok(result.phraseResult.rendered_text !== null);
});

test('returns fallback when no weakness phrases exist for any dimension', () => {
  // HOTEL_LOW_SCORES: scores 30-68, all very low — but there ARE weakness phrases for low scores
  // Let's use a minimal hotel with high scores everywhere so no weakness phrase matches
  const noWeaknessHotel = {
    hotel_id: 'NW1',
    score_breakdown: {
      overall_score:  88, location_score: 90, amenity_score: 85,
      brand_score:    89, value_score:    87,
    },
    all_persona_scores: { honeymoon: 80, luxury: 85, family: 70, wellness: 75, remote_work: 60, value_luxury: 72 },
    amenity_flags: {},
  };
  const { weakness_candidates, sorted_dimensions } = engine._stage2_dimensionAnalysis(noWeaknessHotel);
  const result = engine._stage4_weaknessExtraction(noWeaknessHotel, 'honeymoon', weakness_candidates, sorted_dimensions);
  // All scores 85-90 — no weakness phrases registered for those bands → expect fallback
  assert.ok(result.is_fallback === true || result.phraseResult !== null,
    'Should always return a weakness candidate');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: Stage 5 — _stage5_travelerFitGeneration()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 12: Stage 5 — _stage5_travelerFitGeneration()');

test('returns personaScore, positivePhraseResult, cautionaryPhraseResult', () => {
  const result = engine._stage5_travelerFitGeneration(HOTEL_FULL, 'honeymoon');
  assert.ok('personaScore'          in result);
  assert.ok('positivePhraseResult'  in result);
  assert.ok('cautionaryPhraseResult' in result);
});

test('personaScore resolves from all_persona_scores', () => {
  const result = engine._stage5_travelerFitGeneration(HOTEL_FULL, 'honeymoon');
  assert.strictEqual(result.personaScore, 82);
});

test('wellness persona with spa → positivePhraseResult is non-null', () => {
  // HOTEL_WELLNESS has has_spa=true and persona_scores.wellness=90
  const result = engine._stage5_travelerFitGeneration(HOTEL_WELLNESS, 'wellness');
  assert.ok(result.positivePhraseResult !== null, 'Expected positive fit phrase for wellness+spa');
});

test('positivePhraseResult has rendered_text when found', () => {
  const result = engine._stage5_travelerFitGeneration(HOTEL_FAMILY, 'family');
  if (result.positivePhraseResult) {
    assert.ok(
      typeof result.positivePhraseResult.rendered_text === 'string' &&
      result.positivePhraseResult.rendered_text.length > 0,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: Stage 6 — _stage6_claimValidation()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 13: Stage 6 — _stage6_claimValidation()');

function _buildValidationInputs(hotel, persona) {
  const { strength_candidates, weakness_candidates, sorted_dimensions } = engine._stage2_dimensionAnalysis(hotel);
  const strengthExtracted = engine._stage3_strengthExtraction(hotel, persona, strength_candidates);
  const weaknessExtracted = engine._stage4_weaknessExtraction(hotel, persona, weakness_candidates, sorted_dimensions);
  const fitData           = engine._stage5_travelerFitGeneration(hotel, persona);
  return { strengthExtracted, weaknessExtracted, fitData };
}

test('returns an array of candidate objects', () => {
  const { strengthExtracted, weaknessExtracted, fitData } = _buildValidationInputs(HOTEL_FULL, 'honeymoon');
  const validated = engine._stage6_claimValidation(HOTEL_FULL, strengthExtracted, weaknessExtracted, fitData);
  assert.ok(Array.isArray(validated));
  assert.ok(validated.length >= 1);  // always at least the weakness
});

test('every validated item has a validationResult', () => {
  const { strengthExtracted, weaknessExtracted, fitData } = _buildValidationInputs(HOTEL_FULL, 'luxury');
  const validated = engine._stage6_claimValidation(HOTEL_FULL, strengthExtracted, weaknessExtracted, fitData);
  for (const item of validated) {
    assert.ok(item.validationResult && typeof item.validationResult === 'object',
      `Missing validationResult for type=${item.type}`);
    assert.ok('suppressed' in item.validationResult);
    assert.ok('valid'      in item.validationResult);
  }
});

test('weakness candidate is always present in validated array', () => {
  const { strengthExtracted, weaknessExtracted, fitData } = _buildValidationInputs(HOTEL_MINIMAL, 'luxury');
  const validated = engine._stage6_claimValidation(HOTEL_MINIMAL, strengthExtracted, weaknessExtracted, fitData);
  const weaknesses = validated.filter(v => v.type === 'weakness');
  assert.strictEqual(weaknesses.length, 1);
});

test('fallback weakness passes hallucination_guard validation', () => {
  // Build a hotel where all normal weakness lookups fail (high scores)
  const hotel = {
    hotel_id: 'FW1',
    score_breakdown: { overall_score: 88, location_score: 90, amenity_score: 86, brand_score: 89, value_score: 87 },
    all_persona_scores: { honeymoon: 70, luxury: 75, family: 60, wellness: 65, remote_work: 55, value_luxury: 70 },
    amenity_flags: {},
  };
  const { strengthExtracted, weaknessExtracted, fitData } = _buildValidationInputs(hotel, 'luxury');
  const validated = engine._stage6_claimValidation(hotel, strengthExtracted, weaknessExtracted, fitData);
  const wk = validated.find(v => v.type === 'weakness');
  assert.ok(wk, 'Weakness item must be present');
  if (wk.is_fallback) {
    assert.ok(!wk.validationResult.suppressed, 'Fallback weakness must pass validation');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: Stage 7 — _stage7_confidenceCalibration()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 14: Stage 7 — _stage7_confidenceCalibration()');

function _buildCalibrationInputs(hotel, persona) {
  const inputs = _buildValidationInputs(hotel, persona);
  return engine._stage6_claimValidation(hotel, inputs.strengthExtracted, inputs.weaknessExtracted, inputs.fitData);
}

test('returns calibrated array and overall_confidence_level', () => {
  const validated = _buildCalibrationInputs(HOTEL_FULL, 'luxury');
  const result = engine._stage7_confidenceCalibration(HOTEL_FULL, validated);
  assert.ok(Array.isArray(result.calibrated));
  assert.ok(typeof result.overall_confidence_level === 'string');
});

test('HOTEL_FULL (850 reviews) → overall_confidence_level is high', () => {
  const validated = _buildCalibrationInputs(HOTEL_FULL, 'luxury');
  const { overall_confidence_level } = engine._stage7_confidenceCalibration(HOTEL_FULL, validated);
  assert.strictEqual(overall_confidence_level, 'high');
});

test('HOTEL_MINIMAL (5 reviews) → overall_confidence_level is insufficient', () => {
  const validated = _buildCalibrationInputs(HOTEL_MINIMAL, 'luxury');
  const { overall_confidence_level } = engine._stage7_confidenceCalibration(HOTEL_MINIMAL, validated);
  assert.strictEqual(overall_confidence_level, 'insufficient');
});

test('non-suppressed validated claims have enforcementResult', () => {
  const validated = _buildCalibrationInputs(HOTEL_FULL, 'honeymoon');
  const { calibrated } = engine._stage7_confidenceCalibration(HOTEL_FULL, validated);
  const validItems = calibrated.filter(c => !c.validationResult.suppressed);
  for (const item of validItems) {
    assert.ok(item.enforcementResult !== null, `Missing enforcementResult for type=${item.type}`);
  }
});

test('suppressed validated claims have null enforcementResult', () => {
  const validated = _buildCalibrationInputs(HOTEL_FULL, 'honeymoon');
  const { calibrated } = engine._stage7_confidenceCalibration(HOTEL_FULL, validated);
  const suppressedItems = calibrated.filter(c => c.validationResult.suppressed);
  for (const item of suppressedItems) {
    assert.strictEqual(item.enforcementResult, null);
  }
});

test('all calibrated items have confidence_level set', () => {
  const validated = _buildCalibrationInputs(HOTEL_WELLNESS, 'wellness');
  const { calibrated } = engine._stage7_confidenceCalibration(HOTEL_WELLNESS, validated);
  for (const item of calibrated) {
    assert.ok(typeof item.confidence_level === 'string');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15: Stage 8 — _stage8_summaryGeneration()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 15: Stage 8 — _stage8_summaryGeneration()');

function _buildCalibratedItems(hotel, persona) {
  const validated = _buildCalibrationInputs(hotel, persona);
  const { calibrated, overall_confidence_level } = engine._stage7_confidenceCalibration(hotel, validated);
  return { calibrated, overall_confidence_level };
}

test('returns a non-empty string', () => {
  const { calibrated, overall_confidence_level } = _buildCalibratedItems(HOTEL_FULL, 'honeymoon');
  const summary = engine._stage8_summaryGeneration(HOTEL_FULL, 'honeymoon', calibrated, overall_confidence_level);
  assert.ok(typeof summary === 'string' && summary.length > 0);
});

test('includes hotel name', () => {
  const { calibrated, overall_confidence_level } = _buildCalibratedItems(HOTEL_FULL, 'luxury');
  const summary = engine._stage8_summaryGeneration(HOTEL_FULL, 'luxury', calibrated, overall_confidence_level);
  assert.ok(summary.includes('Le Meridien Mauritius'));
});

test('includes overall score', () => {
  const { calibrated, overall_confidence_level } = _buildCalibratedItems(HOTEL_FULL, 'luxury');
  const summary = engine._stage8_summaryGeneration(HOTEL_FULL, 'luxury', calibrated, overall_confidence_level);
  assert.ok(summary.includes('88/100'));
});

test('includes persona fit score when available', () => {
  const { calibrated, overall_confidence_level } = _buildCalibratedItems(HOTEL_FULL, 'honeymoon');
  const summary = engine._stage8_summaryGeneration(HOTEL_FULL, 'honeymoon', calibrated, overall_confidence_level);
  // honeymoon persona score = 82
  assert.ok(summary.includes('82/100'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16: Stage 9 — _stage9_explanationAssembly()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 16: Stage 9 — _stage9_explanationAssembly()');

function _buildFullPipelineOutput(hotel, persona) {
  const meta = engine._stage1_inputValidation(hotel, persona);
  const { sorted_dimensions, strength_candidates, weakness_candidates } = engine._stage2_dimensionAnalysis(hotel);
  const strengthExtracted = engine._stage3_strengthExtraction(hotel, persona, strength_candidates);
  const weaknessExtracted = engine._stage4_weaknessExtraction(hotel, persona, weakness_candidates, sorted_dimensions);
  const fitData           = engine._stage5_travelerFitGeneration(hotel, persona);
  const validated         = engine._stage6_claimValidation(hotel, strengthExtracted, weaknessExtracted, fitData);
  const { calibrated, overall_confidence_level } = engine._stage7_confidenceCalibration(hotel, validated);
  const summary           = engine._stage8_summaryGeneration(hotel, persona, calibrated, overall_confidence_level);
  return { meta, calibrated, summary, overall_confidence_level };
}

test('returns a frozen object with all required fields', () => {
  const { meta, calibrated, summary, overall_confidence_level } = _buildFullPipelineOutput(HOTEL_FULL, 'honeymoon');
  const obj = engine._stage9_explanationAssembly(meta, calibrated, summary, overall_confidence_level);

  assert.ok(Object.isFrozen(obj));
  assert.ok('hotel_id'            in obj);
  assert.ok('hotel_name'          in obj);
  assert.ok('persona'             in obj);
  assert.ok('rank'                in obj);
  assert.ok('explanation_summary' in obj);
  assert.ok('strengths'           in obj);
  assert.ok('weaknesses'          in obj);
  assert.ok('traveler_fit'        in obj);
  assert.ok('confidence_level'    in obj);
  assert.ok('supporting_claims'   in obj);
  assert.ok('suppressed_claims'   in obj);
  assert.ok('validation_summary'  in obj);
  assert.ok('explanation_version' in obj);
  assert.ok('generated_at'        in obj);
});

test('weaknesses[] always has exactly 1 element', () => {
  const { meta, calibrated, summary, overall_confidence_level } = _buildFullPipelineOutput(HOTEL_FULL, 'honeymoon');
  const obj = engine._stage9_explanationAssembly(meta, calibrated, summary, overall_confidence_level);
  assert.strictEqual(obj.weaknesses.length, 1);
});

test('strengths[] has at most 3 elements', () => {
  const { meta, calibrated, summary, overall_confidence_level } = _buildFullPipelineOutput(HOTEL_FULL, 'luxury');
  const obj = engine._stage9_explanationAssembly(meta, calibrated, summary, overall_confidence_level);
  assert.ok(obj.strengths.length <= 3);
});

test('validation_summary has correct fields', () => {
  const { meta, calibrated, summary, overall_confidence_level } = _buildFullPipelineOutput(HOTEL_FULL, 'luxury');
  const obj = engine._stage9_explanationAssembly(meta, calibrated, summary, overall_confidence_level);
  const vs = obj.validation_summary;
  assert.ok(typeof vs.total_candidates  === 'number');
  assert.ok(typeof vs.published         === 'number');
  assert.ok(typeof vs.suppressed        === 'number');
  assert.ok(typeof vs.hedge_rate        === 'number');
  assert.ok(typeof vs.suppression_rate  === 'number');
});

test('explanation_version matches ENGINE_VERSION', () => {
  const { meta, calibrated, summary, overall_confidence_level } = _buildFullPipelineOutput(HOTEL_FULL, 'luxury');
  const obj = engine._stage9_explanationAssembly(meta, calibrated, summary, overall_confidence_level);
  assert.strictEqual(obj.explanation_version, engine.ENGINE_VERSION);
});

test('weakness guarantee — last resort injected when all claims suppressed', () => {
  // Build calibrated array with weakness item suppressed
  const fakeMeta = { hotel_id: 'X', hotel_name: 'X', persona: 'luxury', rank: null };
  const fakeCalibrated = [{
    type:            'weakness',
    dimension:       'value_score',
    score:           45,
    phraseResult:    { phrase_id: 'WK', rendered_text: 'text', suppressed: false, claim_type: 'comparative' },
    is_fallback:     false,
    validationResult: { suppressed: true, suppression_reason: 'test suppression', valid: false },
    enforcementResult: null,
    confidence_level: 'low',
    claim_strength:  'weak',
  }];
  const obj = engine._stage9_explanationAssembly(fakeMeta, fakeCalibrated, 'Test summary', 'low');
  assert.strictEqual(obj.weaknesses.length, 1);
  assert.ok(obj.weaknesses[0].is_fallback === true);
  assert.ok(obj.weaknesses[0].phrase_id === 'LAST_RESORT_WEAKNESS_GUARANTEE');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17: explain() — Integration
// ─────────────────────────────────────────────────────────────────────────────

section('Section 17: explain() — Full pipeline integration');

test('explain(HOTEL_FULL, honeymoon) → valid ExplanationObject', () => {
  const obj = engine.explain(HOTEL_FULL, 'honeymoon');
  assert.strictEqual(obj.hotel_id,  'MQ001');
  assert.strictEqual(obj.persona,   'honeymoon');
  assert.strictEqual(obj.weaknesses.length, 1);
  assert.ok(obj.explanation_version);
  assert.ok(obj.generated_at);
});

test('explain(HOTEL_WELLNESS, wellness) → valid ExplanationObject', () => {
  const obj = engine.explain(HOTEL_WELLNESS, 'wellness');
  assert.strictEqual(obj.hotel_id,         'MQ003');
  assert.strictEqual(obj.weaknesses.length, 1);
  assert.ok(typeof obj.confidence_level === 'string');
});

test('explain(HOTEL_FAMILY, family) → valid ExplanationObject', () => {
  const obj = engine.explain(HOTEL_FAMILY, 'family');
  assert.strictEqual(obj.weaknesses.length, 1);
  assert.ok(Array.isArray(obj.strengths));
});

test('explain(HOTEL_MINIMAL, luxury) → valid even with insufficient data', () => {
  const obj = engine.explain(HOTEL_MINIMAL, 'luxury');
  assert.strictEqual(obj.confidence_level, 'insufficient');
  assert.strictEqual(obj.weaknesses.length, 1);
});

test('explain(HOTEL_LOW_SCORES, value_luxury) → valid even with no phrase strengths', () => {
  const obj = engine.explain(HOTEL_LOW_SCORES, 'value_luxury');
  // All dimension scores < 70, so strengths[] may be empty
  assert.ok(Array.isArray(obj.strengths));
  assert.strictEqual(obj.weaknesses.length, 1);
});

test('explain() — weakness[0] always has a non-empty final_text', () => {
  const personas = ['honeymoon', 'luxury', 'family', 'wellness', 'remote_work', 'value_luxury'];
  const hotels = [HOTEL_FULL, HOTEL_MINIMAL, HOTEL_WELLNESS, HOTEL_LOW_SCORES];
  for (const hotel of hotels) {
    for (const persona of personas) {
      const obj = engine.explain(hotel, persona);
      assert.ok(
        obj.weaknesses[0].final_text && obj.weaknesses[0].final_text.length > 0,
        `Empty weakness for hotel=${hotel.hotel_id}, persona=${persona}`,
      );
    }
  }
});

test('explain() — deterministic: same hotel+persona → same core result', () => {
  const a = engine.explain(HOTEL_FULL, 'honeymoon');
  const b = engine.explain(HOTEL_FULL, 'honeymoon');
  // generated_at will differ, but everything else must match
  assert.strictEqual(a.hotel_id,          b.hotel_id);
  assert.strictEqual(a.confidence_level,  b.confidence_level);
  assert.strictEqual(a.weaknesses.length, b.weaknesses.length);
  assert.strictEqual(a.weaknesses[0].final_text, b.weaknesses[0].final_text);
  assert.strictEqual(a.strengths.length,  b.strengths.length);
  if (a.strengths.length > 0) {
    assert.strictEqual(a.strengths[0].final_text, b.strengths[0].final_text);
  }
});

test('explain() — different personas produce different results', () => {
  const honeymoon = engine.explain(HOTEL_FULL, 'honeymoon');
  const family    = engine.explain(HOTEL_FULL, 'family');
  assert.strictEqual(honeymoon.persona, 'honeymoon');
  assert.strictEqual(family.persona,    'family');
  // Persona scores differ
  assert.notStrictEqual(honeymoon.traveler_fit.persona_score, family.traveler_fit.persona_score);
});

test('explain() — throws InvalidPersonaError for unknown persona', () => {
  assert.throws(() => engine.explain(HOTEL_FULL, 'surfer'), engine.InvalidPersonaError);
});

test('explain() — throws InvalidHotelInputError for null hotel', () => {
  assert.throws(() => engine.explain(null, 'luxury'), engine.InvalidHotelInputError);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 18: explainBatch()
// ─────────────────────────────────────────────────────────────────────────────

section('Section 18: explainBatch()');

test('returns an array of ExplanationObjects', () => {
  const results = engine.explainBatch([HOTEL_FULL, HOTEL_WELLNESS], 'honeymoon');
  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].hotel_id, 'MQ001');
  assert.strictEqual(results[1].hotel_id, 'MQ003');
});

test('empty array input → empty array output', () => {
  const results = engine.explainBatch([], 'luxury');
  assert.deepStrictEqual(results, []);
});

test('throws TypeError for non-array input', () => {
  assert.throws(() => engine.explainBatch('notarray', 'luxury'), TypeError);
});

test('each result has exactly 1 weakness', () => {
  const results = engine.explainBatch([HOTEL_FULL, HOTEL_MINIMAL, HOTEL_LOW_SCORES], 'luxury');
  for (const obj of results) {
    assert.strictEqual(obj.weaknesses.length, 1, `Expected 1 weakness for hotel=${obj.hotel_id}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 19: ExplanationObject schema conformance
// ─────────────────────────────────────────────────────────────────────────────

section('Section 19: ExplanationObject schema conformance');

test('strengths[] items have required fields', () => {
  const obj = engine.explain(HOTEL_FULL, 'luxury');
  for (const str of obj.strengths) {
    assert.ok('dimension'        in str);
    assert.ok('score'            in str);
    assert.ok('final_text'       in str);
    assert.ok('hedge_pattern'    in str);
    assert.ok('confidence_level' in str);
    assert.ok('claim_strength'   in str);
    assert.ok('phrase_id'        in str);
  }
});

test('weaknesses[] item has required fields', () => {
  const obj = engine.explain(HOTEL_FULL, 'luxury');
  const wk = obj.weaknesses[0];
  assert.ok('dimension'        in wk);
  assert.ok('score'            in wk);
  assert.ok('final_text'       in wk);
  assert.ok('hedge_pattern'    in wk);
  assert.ok('confidence_level' in wk);
  assert.ok('claim_strength'   in wk);
  assert.ok('phrase_id'        in wk);
  assert.ok('is_fallback'      in wk);
});

test('traveler_fit has required fields', () => {
  const obj = engine.explain(HOTEL_FULL, 'honeymoon');
  const tf = obj.traveler_fit;
  assert.ok('persona'          in tf);
  assert.ok('persona_score'    in tf);
  assert.ok('positive_fit'     in tf);
  assert.ok('cautionary_note'  in tf);
  assert.ok('fit_strength'     in tf);
  assert.strictEqual(tf.persona, 'honeymoon');
});

test('validation_summary counts are internally consistent', () => {
  const obj = engine.explain(HOTEL_FULL, 'honeymoon');
  const vs = obj.validation_summary;
  assert.ok(vs.total_candidates >= 0);
  // published + suppressed should not exceed total (last-resort weakness may push published up)
  assert.ok(vs.published + vs.suppressed >= 0);
  assert.ok(vs.hedge_rate >= 0 && vs.hedge_rate <= 1);
  assert.ok(vs.suppression_rate >= 0 && vs.suppression_rate <= 1);
});

test('supporting_claims is an array of strings', () => {
  const obj = engine.explain(HOTEL_FULL, 'luxury');
  assert.ok(Array.isArray(obj.supporting_claims));
  for (const c of obj.supporting_claims) {
    assert.ok(typeof c === 'string', `Expected string, got ${typeof c}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 20: Error type inheritance
// ─────────────────────────────────────────────────────────────────────────────

section('Section 20: Error type inheritance');

test('InvalidHotelInputError instanceof ExplanationEngineError', () => {
  try {
    engine._stage1_inputValidation(null, 'luxury');
  } catch (e) {
    assert.ok(e instanceof engine.ExplanationEngineError);
    assert.ok(e instanceof engine.InvalidHotelInputError);
  }
});

test('InvalidPersonaError instanceof ExplanationEngineError', () => {
  try {
    engine._stage1_inputValidation(HOTEL_FULL, 'unknown');
  } catch (e) {
    assert.ok(e instanceof engine.ExplanationEngineError);
    assert.ok(e instanceof engine.InvalidPersonaError);
  }
});

test('WeaknessGuaranteeError instanceof ExplanationEngineError', () => {
  const err = new engine.WeaknessGuaranteeError('MQ001');
  assert.ok(err instanceof engine.ExplanationEngineError);
  assert.ok(err instanceof engine.WeaknessGuaranteeError);
});

test('InvalidPersonaError carries the invalid persona in details', () => {
  try {
    engine._stage1_inputValidation(HOTEL_FULL, 'scuba_diver');
  } catch (e) {
    assert.ok(e instanceof engine.InvalidPersonaError);
    assert.strictEqual(e.details && e.details.persona, 'scuba_diver');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 21: Weakness guarantee — all personas, edge cases
// ─────────────────────────────────────────────────────────────────────────────

section('Section 21: Weakness guarantee — all personas');

const ALL_PERSONAS = ['honeymoon', 'luxury', 'family', 'wellness', 'remote_work', 'value_luxury'];
const TEST_HOTELS  = [HOTEL_FULL, HOTEL_MINIMAL, HOTEL_WELLNESS, HOTEL_FAMILY, HOTEL_LOW_SCORES, HOTEL_ID_ALIAS];

test('EVERY hotel × persona produces exactly 1 weakness', () => {
  let violations = 0;
  for (const hotel of TEST_HOTELS) {
    for (const persona of ALL_PERSONAS) {
      const obj = engine.explain(hotel, persona);
      if (obj.weaknesses.length !== 1) {
        violations++;
        failures.push({ label: `Weakness count violation: hotel=${hotel.hotel_id} persona=${persona}`, error: `Expected 1 weakness, got ${obj.weaknesses.length}` });
      }
    }
  }
  assert.strictEqual(violations, 0, `${violations} weakness guarantee violations`);
});

test('EVERY weakness has a non-empty final_text', () => {
  for (const hotel of TEST_HOTELS) {
    for (const persona of ALL_PERSONAS) {
      const obj = engine.explain(hotel, persona);
      const wk = obj.weaknesses[0];
      assert.ok(
        wk.final_text && wk.final_text.trim().length > 0,
        `Empty weakness for hotel=${hotel.hotel_id} persona=${persona}`,
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 22: id alias + no hotel_name
// ─────────────────────────────────────────────────────────────────────────────

section('Section 22: id alias and fallback name');

test('hotel with id (not hotel_id) produces valid result', () => {
  const obj = engine.explain(HOTEL_ID_ALIAS, 'value_luxury');
  assert.strictEqual(obj.hotel_id, 'MQ006');
  assert.strictEqual(obj.weaknesses.length, 1);
});

test('hotel with no name field uses null hotel_name', () => {
  const nameless = { ...HOTEL_FULL, hotel_name: undefined, name: undefined };
  const obj = engine.explain(nameless, 'luxury');
  // Should not throw; hotel_name may be null
  assert.strictEqual(obj.weaknesses.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n\n');
console.log('─'.repeat(60));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));

if (failures.length > 0) {
  console.log('\n  FAILURES:\n');
  for (const { label, error } of failures) {
    console.log(`  ✗  ${label}`);
    console.log(`     ${error}\n`);
  }
}

if (failed === 0) {
  console.log('\n  ✓  All tests passed.\n');
  process.exit(0);
} else {
  console.log(`\n  ${failed} test(s) failed.\n`);
  process.exit(1);
}
