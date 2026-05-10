/**
 * hallucination_guard.test.js
 * Mauritius Resort Finder — HallucinationGuard Test Suite
 *
 * Self-running. No test framework required.
 * Run: node hallucination_guard.test.js
 *
 * Exit code 0 = all tests passed.
 * Exit code 1 = one or more failures.
 *
 * Coverage:
 *   - All 5 validation stages (pass and suppress)
 *   - Short-circuit behaviour (downstream stages skipped)
 *   - Pre-suppressed PhraseResult handling
 *   - validateBatch (parallelism, independence, empty input)
 *   - summariseBatch aggregation
 *   - Prohibited pattern registry completeness
 *   - Review threshold rules across all boundary conditions
 *   - Value consistency drift detection
 *   - Boolean consistency (strict true / false / null)
 *   - Non-claim phrase handling
 *   - Edge cases: null inputs, malformed objects, type mismatches
 *   - Audit log completeness and ordering
 *   - Constants immutability
 */

'use strict';

const {
  validate,
  validateBatch,
  summariseBatch,
  getProhibitedPatternRegistry,
  getReviewThresholds,
  getValueTolerances,
  _validateFieldPresence,
  _validateBooleanConsistency,
  _validateReviewConfidence,
  _validateValueConsistency,
  _validateProhibitedPatterns,
  _resolveField,
  _getFieldTolerance,
  _withinTolerance,
  GUARD_VERSION,
  STAGES,
  STAGE_ORDER,
  REVIEW_THRESHOLDS,
  VALUE_TOLERANCES,
  PROHIBITED_PATTERNS,
} = require('./hallucination_guard');

// ─────────────────────────────────────────────────────────────────────────────
// TEST HARNESS
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write(`  ✓ ${message}\n`);
  } else {
    failed++;
    failures.push(message);
    process.stdout.write(`  ✗ FAIL: ${message}\n`);
  }
}

function assertThrows(fn, expectedErrorFragment, message) {
  try {
    fn();
    failed++;
    failures.push(message);
    process.stdout.write(`  ✗ FAIL (no throw): ${message}\n`);
  } catch (e) {
    if (expectedErrorFragment && !e.message.includes(expectedErrorFragment)) {
      failed++;
      failures.push(`${message} — wrong error: "${e.message}"`);
      process.stdout.write(`  ✗ FAIL (wrong error): ${message}\n`);
    } else {
      passed++;
      process.stdout.write(`  ✓ ${message}\n`);
    }
  }
}

function section(title) {
  process.stdout.write(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal valid bound HotelRecord. Used as the baseline across all tests.
 * Modify per-test using spread.
 */
const HOTEL = {
  hotel_id: 'htl_001',
  name: 'Heritage Le Telfair',
  region: 'South Coast',
  brand: 'Heritage Resorts',
  brand_tier: 4,
  rank: 1,
  final_ranking_score: 87.4,
  base_score: 82.1,
  intent_score: 90.2,
  score_breakdown: {
    overall_score:  88.0,
    location_score: 85.0,
    amenity_score:  90.0,
    brand_score:    78.0,
    value_score:    72.0,
    affiliate_score: 60.0,
  },
  all_persona_scores: {
    honeymoon: 91, luxury: 79, family: 52, wellness: 94, remote_work: 61, value_luxury: 68,
  },
  avg_rating:    4.7,
  review_count:  847,
  amenity_flags: {
    beachfront:           true,
    has_spa:              true,
    spa_award_rated:      true,
    private_pool_villa:   false,
    kids_club:            false,
    all_inclusive:        false,
    adults_only:          false,
    overwater_bungalow:   false,
    butler_service:       true,
    high_speed_wifi:      true,
    dedicated_workspace:  false,
    long_stay_rates:      false,
    restaurant_count:     4,
    pool_count:           3,
  },
  avg_nightly_rate:          650,
  avg_nightly_rate_currency: 'USD',
  affiliate_score:           60,
  has_active_affiliate:      true,
  data_completeness_pct:     92,
  score_version:             '1.0.0',
  confidence:                'high',
  badge:                     null,
};

/** Builds a minimal valid PhraseResult for a given scenario. */
function buildPhrase(overrides = {}) {
  return {
    phrase_id:          'OS_STR_90_GENERIC',
    rendered_text:      'Overall score 88/100 — consistently above segment median.',
    injected_values:    {
      'score_breakdown.overall_score': 88.0,
      'avg_rating':                    4.7,
      'review_count':                  847,
    },
    suppressed:         false,
    suppression_reason: null,
    produces_claim:     true,
    claim_source_field: 'score_breakdown.overall_score',
    claim_type:         'numeric',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: MODULE CONSTANTS AND CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

section('1. Module constants and configuration');

assert(typeof GUARD_VERSION === 'string' && GUARD_VERSION.length > 0,
  'GUARD_VERSION is a non-empty string');

assert(Object.isFrozen(STAGES),
  'STAGES constant is frozen');

assert(Object.isFrozen(STAGE_ORDER),
  'STAGE_ORDER is frozen');

assert(Object.isFrozen(REVIEW_THRESHOLDS),
  'REVIEW_THRESHOLDS is frozen');

assert(Object.isFrozen(VALUE_TOLERANCES),
  'VALUE_TOLERANCES is frozen');

assert(Object.isFrozen(PROHIBITED_PATTERNS),
  'PROHIBITED_PATTERNS is frozen');

assert(STAGE_ORDER.length === 5,
  'STAGE_ORDER has exactly 5 stages');

assert(STAGE_ORDER[0] === STAGES.FIELD_PRESENCE,
  'Stage 1 is field_presence');

assert(STAGE_ORDER[4] === STAGES.PROHIBITED_PATTERNS,
  'Stage 5 is prohibited_patterns');

assert(REVIEW_THRESHOLDS.ANY_CLAIM < REVIEW_THRESHOLDS.NUMERIC_RATING,
  'ANY_CLAIM threshold < NUMERIC_RATING threshold');

assert(REVIEW_THRESHOLDS.NUMERIC_RATING < REVIEW_THRESHOLDS.COMPARATIVE_STANDING,
  'NUMERIC_RATING threshold < COMPARATIVE_STANDING threshold');

assert(PROHIBITED_PATTERNS.length >= 15,
  `Prohibited pattern registry has ≥15 entries (has ${PROHIBITED_PATTERNS.length})`);

assert(PROHIBITED_PATTERNS.every(p => p.pattern instanceof RegExp),
  'All prohibited patterns are compiled RegExp');

assert(PROHIBITED_PATTERNS.every(p => typeof p.pattern_id === 'string'),
  'All prohibited patterns have a string pattern_id');

const patternIds = PROHIBITED_PATTERNS.map(p => p.pattern_id);
assert(new Set(patternIds).size === patternIds.length,
  'All prohibited pattern IDs are unique');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

section('2. Utility functions');

assert(_resolveField('name', HOTEL) === 'Heritage Le Telfair',
  '_resolveField: top-level field');

assert(_resolveField('score_breakdown.overall_score', HOTEL) === 88.0,
  '_resolveField: nested field (two levels)');

assert(_resolveField('amenity_flags.beachfront', HOTEL) === true,
  '_resolveField: amenity_flags nested boolean');

assert(_resolveField('amenity_flags.kids_club', HOTEL) === false,
  '_resolveField: resolves false values correctly');

assert(_resolveField('nonexistent_field', HOTEL) === undefined,
  '_resolveField: returns undefined for missing field');

assert(_resolveField('score_breakdown.nonexistent', HOTEL) === undefined,
  '_resolveField: returns undefined for missing nested field');

assert(_resolveField('amenity_flags.beachfront.deep', HOTEL) === undefined,
  '_resolveField: returns undefined when path traverses non-object');

assert(_resolveField('', HOTEL) === undefined,
  '_resolveField: empty path returns undefined');

assert(_resolveField(null, HOTEL) === undefined,
  '_resolveField: null path returns undefined');

assert(_getFieldTolerance('avg_rating') === VALUE_TOLERANCES.RATING_FIELD,
  '_getFieldTolerance: avg_rating uses RATING_FIELD tolerance');

assert(_getFieldTolerance('review_count') === VALUE_TOLERANCES.COUNT_FIELD,
  '_getFieldTolerance: review_count uses COUNT_FIELD tolerance (exact)');

assert(_getFieldTolerance('score_breakdown.overall_score') === VALUE_TOLERANCES.SCORE_FIELD,
  '_getFieldTolerance: score field uses SCORE_FIELD tolerance');

assert(_getFieldTolerance('unknown_field') === VALUE_TOLERANCES.SCORE_FIELD,
  '_getFieldTolerance: unknown field defaults to SCORE_FIELD tolerance');

assert(_withinTolerance(4.7, 4.75, 0.1) === true,
  '_withinTolerance: values within tolerance');

assert(_withinTolerance(4.7, 4.85, 0.1) === false,
  '_withinTolerance: values outside tolerance');

assert(_withinTolerance(88, 88.5, 1.0) === true,
  '_withinTolerance: score values within 1.0 tolerance');

assert(_withinTolerance(88, 90.5, 1.0) === false,
  '_withinTolerance: score values outside 1.0 tolerance');

assert(_withinTolerance('a', 4.7, 0.1) === false,
  '_withinTolerance: non-numeric a returns false');

assert(_withinTolerance(4.7, null, 0.1) === false,
  '_withinTolerance: null b returns false');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: STAGE 1 — FIELD PRESENCE
// ─────────────────────────────────────────────────────────────────────────────

section('3. Stage 1: Field Presence Validation');

// Pass: complete, valid inputs
{
  const result = _validateFieldPresence(buildPhrase(), HOTEL);
  assert(!result.suppressed,
    'S1: valid phrase + valid hotel → passes');
  assert(result.audit.outcome === 'passed',
    'S1: audit outcome is "passed" for valid input');
}

// Fail: null phraseResult
{
  const result = _validateFieldPresence(null, HOTEL);
  assert(result.suppressed,
    'S1: null phraseResult → suppressed');
  assert(result.reason.includes('plain object'),
    'S1: suppression reason cites object requirement');
}

// Fail: array as phraseResult
{
  const result = _validateFieldPresence([], HOTEL);
  assert(result.suppressed,
    'S1: array phraseResult → suppressed');
}

// Fail: null hotel
{
  const result = _validateFieldPresence(buildPhrase(), null);
  assert(result.suppressed,
    'S1: null hotel → suppressed');
  assert(result.reason.includes('plain object'),
    'S1: suppression reason cites object requirement for hotel');
}

// Fail: rendered_text is null
{
  const result = _validateFieldPresence(buildPhrase({ rendered_text: null }), HOTEL);
  assert(result.suppressed,
    'S1: rendered_text=null → suppressed');
  assert(result.reason.includes('null'),
    'S1: suppression reason cites null rendered_text');
}

// Fail: rendered_text is empty string
{
  const result = _validateFieldPresence(buildPhrase({ rendered_text: '   ' }), HOTEL);
  assert(result.suppressed,
    'S1: rendered_text is whitespace-only → suppressed');
}

// Fail: phrase_id missing
{
  const result = _validateFieldPresence(buildPhrase({ phrase_id: '' }), HOTEL);
  assert(result.suppressed,
    'S1: empty phrase_id → suppressed');
}

// Fail: produces_claim=true but claim_source_field absent
{
  const result = _validateFieldPresence(
    buildPhrase({ produces_claim: true, claim_source_field: null }),
    HOTEL,
  );
  assert(result.suppressed,
    'S1: produces_claim=true with null claim_source_field → suppressed');
}

// Fail: claim_source_field resolves to null on hotel
{
  const hotelMissingField = { ...HOTEL, score_breakdown: { ...HOTEL.score_breakdown, overall_score: null } };
  const result = _validateFieldPresence(
    buildPhrase({ claim_source_field: 'score_breakdown.overall_score' }),
    hotelMissingField,
  );
  assert(result.suppressed,
    'S1: claim_source_field is null on hotel → suppressed');
  assert(result.reason.includes('overall_score'),
    'S1: suppression reason cites the missing field path');
}

// Pass: produces_claim=false — skip source field check
{
  const result = _validateFieldPresence(
    buildPhrase({ produces_claim: false, claim_source_field: null }),
    HOTEL,
  );
  assert(!result.suppressed,
    'S1: produces_claim=false with no claim_source_field → passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: STAGE 2 — BOOLEAN CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

section('4. Stage 2: Boolean Consistency Validation');

const beachfrontPhrase = buildPhrase({
  claim_type:         'boolean',
  claim_source_field: 'amenity_flags.beachfront',
  renders:            'Beachfront placement confirmed.',
});

// Pass: source flag is true
{
  const result = _validateBooleanConsistency(beachfrontPhrase, HOTEL);
  assert(!result.suppressed,
    'S2: boolean claim with source=true → passes');
}

// Fail: source flag is false
{
  const hotelNoBeach = {
    ...HOTEL,
    amenity_flags: { ...HOTEL.amenity_flags, beachfront: false },
  };
  const result = _validateBooleanConsistency(beachfrontPhrase, hotelNoBeach);
  assert(result.suppressed,
    'S2: boolean claim with source=false → suppressed');
  assert(result.reason.includes('false'),
    'S2: suppression reason cites the actual value "false"');
}

// Fail: source flag is null
{
  const hotelNullFlag = {
    ...HOTEL,
    amenity_flags: { ...HOTEL.amenity_flags, beachfront: null },
  };
  const result = _validateBooleanConsistency(beachfrontPhrase, hotelNullFlag);
  assert(result.suppressed,
    'S2: boolean claim with source=null → suppressed');
}

// Fail: source flag is undefined (field absent)
{
  const { beachfront: _removed, ...restFlags } = HOTEL.amenity_flags;
  const hotelMissingFlag = { ...HOTEL, amenity_flags: restFlags };
  const result = _validateBooleanConsistency(beachfrontPhrase, hotelMissingFlag);
  assert(result.suppressed,
    'S2: boolean claim with source=undefined → suppressed');
}

// Pass: non-boolean claim type — stage skips
{
  const result = _validateBooleanConsistency(buildPhrase({ claim_type: 'numeric' }), HOTEL);
  assert(!result.suppressed,
    'S2: numeric claim type → passes (not applicable)');
}

// Pass: produces_claim=false — stage skips
{
  const result = _validateBooleanConsistency(
    buildPhrase({ produces_claim: false, claim_type: 'boolean' }),
    HOTEL,
  );
  assert(!result.suppressed,
    'S2: produces_claim=false → passes regardless of claim_type');
}

// Fail: spa_award_rated flag is false — award claim suppressed
{
  const awardPhrase = buildPhrase({
    phrase_id:          'AME_STR_90_SPA_AWARD',
    claim_type:         'boolean',
    claim_source_field: 'amenity_flags.spa_award_rated',
    rendered_text:      'Award-rated spa confirmed on property.',
  });
  const hotelNoAward = {
    ...HOTEL,
    amenity_flags: { ...HOTEL.amenity_flags, spa_award_rated: false },
  };
  const result = _validateBooleanConsistency(awardPhrase, hotelNoAward);
  assert(result.suppressed,
    'S2: award-rated claim suppressed when spa_award_rated=false');
}

// Fail: butler_service false
{
  const butlerPhrase = buildPhrase({
    claim_type:         'boolean',
    claim_source_field: 'amenity_flags.butler_service',
    rendered_text:      'Butler service confirmed.',
  });
  const hotelNoButler = {
    ...HOTEL,
    amenity_flags: { ...HOTEL.amenity_flags, butler_service: false },
  };
  const result = _validateBooleanConsistency(butlerPhrase, hotelNoButler);
  assert(result.suppressed,
    'S2: butler_service=false suppresses butler claim');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: STAGE 3 — REVIEW CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────

section('5. Stage 3: Review Confidence Validation');

const numericRatingPhrase = buildPhrase({
  phrase_id:          'OS_STR_90_HIGH_REVIEW',
  claim_type:         'numeric',
  claim_source_field: 'avg_rating',
  injected_values:    { avg_rating: 4.7, review_count: 847, 'score_breakdown.overall_score': 88 },
  rendered_text:      '4.7/5 guest average sustained across 847 reviews.',
});

const comparativeReviewPhrase = buildPhrase({
  phrase_id:          'OS_STR_90_COMPARATIVE',
  claim_type:         'comparative',
  claim_source_field: 'avg_rating',
  injected_values:    { avg_rating: 4.7, review_count: 847 },
  rendered_text:      'Rating ranks among the strongest review records in the Mauritius luxury inventory.',
});

// Pass: high review count — all claims pass
{
  const result = _validateReviewConfidence(numericRatingPhrase, HOTEL);
  assert(!result.suppressed,
    'S3: numeric rating claim with 847 reviews → passes');
}

{
  const result = _validateReviewConfidence(comparativeReviewPhrase, HOTEL);
  assert(!result.suppressed,
    'S3: comparative review claim with 847 reviews → passes');
}

// Fail: review_count below ANY_CLAIM floor (< 10)
{
  const hotelLowReviews = { ...HOTEL, review_count: 5 };
  const result = _validateReviewConfidence(numericRatingPhrase, hotelLowReviews);
  assert(result.suppressed,
    'S3: review_count=5 → suppressed (below ANY_CLAIM floor)');
  assert(result.reason.includes('10'),
    'S3: suppression reason cites the ANY_CLAIM threshold');
}

// Fail: review_count below NUMERIC_RATING threshold (< 50), above floor
{
  const hotelThinReviews = { ...HOTEL, review_count: 25 };
  const result = _validateReviewConfidence(numericRatingPhrase, hotelThinReviews);
  assert(result.suppressed,
    'S3: review_count=25 → suppresses numeric avg_rating claim (below 50)');
  assert(result.reason.includes('50'),
    'S3: suppression reason cites NUMERIC_RATING threshold');
}

// Pass: review_count exactly at NUMERIC_RATING threshold (50)
{
  const hotelAtThreshold = { ...HOTEL, review_count: 50 };
  const result = _validateReviewConfidence(numericRatingPhrase, hotelAtThreshold);
  assert(!result.suppressed,
    'S3: review_count=50 → numeric claim passes at exact threshold');
}

// Fail: comparative review claim with 100 reviews (< 200)
{
  const hotelModerateReviews = { ...HOTEL, review_count: 100 };
  const result = _validateReviewConfidence(comparativeReviewPhrase, hotelModerateReviews);
  assert(result.suppressed,
    'S3: comparative review standing claim with 100 reviews → suppressed (below 200)');
  assert(result.reason.includes('200'),
    'S3: suppression cites COMPARATIVE_STANDING threshold');
}

// Pass: comparative claim with exactly 200 reviews
{
  const hotelAtComparativeThreshold = { ...HOTEL, review_count: 200 };
  const result = _validateReviewConfidence(comparativeReviewPhrase, hotelAtComparativeThreshold);
  assert(!result.suppressed,
    'S3: comparative review claim with 200 reviews → passes at exact threshold');
}

// Pass: non-review-derived phrase — stage skips
{
  const nonReviewPhrase = buildPhrase({
    claim_type:         'boolean',
    claim_source_field: 'amenity_flags.beachfront',
    injected_values:    { 'amenity_flags.beachfront': true },
  });
  const result = _validateReviewConfidence(nonReviewPhrase, { ...HOTEL, review_count: 0 });
  assert(!result.suppressed,
    'S3: non-review-derived phrase → passes regardless of review_count');
}

// Fail: review_count is null on hotel
{
  const hotelNoCount = { ...HOTEL, review_count: null };
  const result = _validateReviewConfidence(numericRatingPhrase, hotelNoCount);
  assert(result.suppressed,
    'S3: review_count=null on hotel → suppresses review-derived claim');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: STAGE 4 — VALUE CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

section('6. Stage 4: Value Consistency Validation');

// Pass: injected values match current hotel values within tolerance
{
  const phrase = buildPhrase({
    injected_values:    { 'score_breakdown.overall_score': 88.0 },
    claim_type:         'numeric',
    claim_source_field: 'score_breakdown.overall_score',
  });
  const result = _validateValueConsistency(phrase, HOTEL);
  assert(!result.suppressed,
    'S4: injected value matches current value exactly → passes');
}

// Pass: injected value within SCORE_FIELD tolerance (±1.0)
{
  const phrase = buildPhrase({
    injected_values:    { 'score_breakdown.overall_score': 88.5 },
    claim_type:         'numeric',
    claim_source_field: 'score_breakdown.overall_score',
  });
  const result = _validateValueConsistency(phrase, HOTEL);
  assert(!result.suppressed,
    'S4: injected score differs by 0.5 → within tolerance → passes');
}

// Fail: injected value outside SCORE_FIELD tolerance (> 1.0 drift)
{
  const phrase = buildPhrase({
    injected_values:    { 'score_breakdown.overall_score': 90.5 },
    claim_type:         'numeric',
    claim_source_field: 'score_breakdown.overall_score',
  });
  const result = _validateValueConsistency(phrase, HOTEL);
  assert(result.suppressed,
    'S4: injected score=90.5, current=88.0 (drift=2.5) → suppressed (>1.0 tolerance)');
  assert(result.reason.includes('overall_score'),
    'S4: suppression reason cites the drifted field');
  assert(result.reason.includes('staleness') || result.reason.includes('drift'),
    'S4: suppression reason mentions data staleness or drift');
}

// Pass: injected avg_rating within RATING_FIELD tolerance (±0.1)
{
  const phrase = buildPhrase({
    injected_values:    { avg_rating: 4.72 },
    claim_type:         'numeric',
    claim_source_field: 'avg_rating',
  });
  const result = _validateValueConsistency(phrase, HOTEL);
  assert(!result.suppressed,
    'S4: injected avg_rating=4.72, current=4.7 (drift=0.02) → passes');
}

// Fail: injected avg_rating outside RATING_FIELD tolerance
{
  const phrase = buildPhrase({
    injected_values:    { avg_rating: 4.9 },
    claim_type:         'numeric',
    claim_source_field: 'avg_rating',
  });
  const result = _validateValueConsistency(phrase, HOTEL);
  assert(result.suppressed,
    'S4: injected avg_rating=4.9, current=4.7 (drift=0.2) → suppressed (>0.1 tolerance)');
}

// Fail: injected field now absent from hotel
{
  const { overall_score: _removed, ...rest } = HOTEL.score_breakdown;
  const hotelMissingScore = { ...HOTEL, score_breakdown: rest };
  const phrase = buildPhrase({
    injected_values:    { 'score_breakdown.overall_score': 88 },
    claim_type:         'numeric',
    claim_source_field: 'score_breakdown.overall_score',
  });
  const result = _validateValueConsistency(phrase, hotelMissingScore);
  assert(result.suppressed,
    'S4: injected field now absent → suppressed (stale data)');
}

// Fail: comparative claim with 20+ point drift in source field
{
  const hotelDegradedScore = {
    ...HOTEL,
    score_breakdown: { ...HOTEL.score_breakdown, overall_score: 45 },
  };
  const phrase = buildPhrase({
    injected_values:    { 'score_breakdown.overall_score': 88 },
    claim_type:         'comparative',
    claim_source_field: 'score_breakdown.overall_score',
  });
  const result = _validateValueConsistency(phrase, hotelDegradedScore);
  assert(result.suppressed,
    'S4: comparative claim — source drifted from 88 to 45 (>15 pts) → suppressed');
}

// Pass: comparative claim within 15 point drift window
{
  const hotelSlightDrift = {
    ...HOTEL,
    score_breakdown: { ...HOTEL.score_breakdown, overall_score: 80 },
  };
  const phrase = buildPhrase({
    injected_values:    { 'score_breakdown.overall_score': 88 },
    claim_type:         'comparative',
    claim_source_field: 'score_breakdown.overall_score',
  });
  const result = _validateValueConsistency(phrase, hotelSlightDrift);
  assert(!result.suppressed,
    'S4: comparative claim — drift of 8 points → within 15-point window → passes');
}

// Pass: boolean claim type — value consistency stage skips
{
  const phrase = buildPhrase({
    claim_type: 'boolean',
    injected_values: { 'amenity_flags.beachfront': true },
  });
  const result = _validateValueConsistency(phrase, HOTEL);
  assert(!result.suppressed,
    'S4: boolean claim_type → stage skips (handled by Stage 2)');
}

// Pass: descriptive claim type — value consistency stage skips
{
  const phrase = buildPhrase({
    claim_type:      'descriptive',
    injected_values: { brand: 'Heritage Resorts' },
  });
  const result = _validateValueConsistency(phrase, HOTEL);
  assert(!result.suppressed,
    'S4: descriptive claim_type → stage skips');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: STAGE 5 — PROHIBITED PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

section('7. Stage 5: Prohibited Pattern Validation');

function phraseWithText(text) {
  return buildPhrase({ rendered_text: text });
}

// Blocked phrases
assert(_validateProhibitedPatterns(phraseWithText('The best resort in Mauritius for couples.')).suppressed,
  'S5: "best resort in Mauritius" → suppressed (PP_001)');

assert(_validateProhibitedPatterns(phraseWithText('World-class amenities throughout.')).suppressed,
  'S5: "world-class" → suppressed (PP_002)');

assert(_validateProhibitedPatterns(phraseWithText('Service levels are unmatched in the region.')).suppressed,
  'S5: "unmatched" → suppressed (PP_003)');

assert(_validateProhibitedPatterns(phraseWithText('An unparalleled beachfront experience.')).suppressed,
  'S5: "unparalleled" → suppressed (PP_004)');

assert(_validateProhibitedPatterns(phraseWithText('Guaranteed to exceed your expectations.')).suppressed,
  'S5: "guaranteed" → suppressed (PP_005)');

assert(_validateProhibitedPatterns(phraseWithText('Perfect for everyone — families, couples, and solo travelers.')).suppressed,
  'S5: "perfect for everyone" → suppressed (PP_006)');

assert(_validateProhibitedPatterns(phraseWithText('A hotel that never disappoints.')).suppressed,
  'S5: "never disappoints" → suppressed (PP_007)');

assert(_validateProhibitedPatterns(phraseWithText('Always exceeds guest expectations at every touchpoint.')).suppressed,
  'S5: "always exceeds" → suppressed (PP_008)');

assert(_validateProhibitedPatterns(phraseWithText('Rated #1 resort in the Indian Ocean.')).suppressed,
  'S5: "rated #1 resort" → suppressed (PP_009)');

assert(_validateProhibitedPatterns(phraseWithText('Acclaimed as the number one resort in Mauritius.')).suppressed,
  'S5: "number one resort in Mauritius" → suppressed (PP_010)');

assert(_validateProhibitedPatterns(phraseWithText('A legendary property with decades of heritage.')).suppressed,
  'S5: "legendary" → suppressed (PP_011)');

assert(_validateProhibitedPatterns(phraseWithText('Quality that is second to none in the region.')).suppressed,
  'S5: "second to none" → suppressed (PP_012)');

assert(_validateProhibitedPatterns(phraseWithText('An experience beyond compare on the Indian Ocean.')).suppressed,
  'S5: "beyond compare" → suppressed (PP_013)');

assert(_validateProhibitedPatterns(phraseWithText('Flawless service from check-in to departure.')).suppressed,
  'S5: "flawless" → suppressed (PP_014)');

assert(_validateProhibitedPatterns(phraseWithText('The most prestigious hotel in the South Coast.')).suppressed,
  'S5: "most prestigious" → suppressed (PP_015)');

// Allowed phrases (analytical, data-backed language)
const allowedPhrases = [
  '4.7/5 guest average sustained across 847 verified reviews — high-confidence placement.',
  'Ranks among the strongest review records in the Mauritius luxury inventory.',
  'Scores particularly well for wellness travelers: intent score 94/100.',
  'Amenity score: 90/100 — top-tier facility profile.',
  'Exceptional price-to-quality ratio — one of the strongest value signals in this dataset.',
  'Location score 85/100: beachfront placement confirmed, direct sand access.',
  'Luxury intent score: 79/100. Brand score: 78/100 with butler service.',
  'Above-average price-to-quality ratio for the Mauritius luxury segment.',
  'Highest location score in the South Coast regional cohort.',
  'Strong review consistency across 847 verified stays.',
];

for (const text of allowedPhrases) {
  const result = _validateProhibitedPatterns(phraseWithText(text));
  assert(!result.suppressed,
    `S5: analytical language passes: "${text.substring(0, 50)}..."`);
}

// Suppression reason cites the pattern ID
{
  const result = _validateProhibitedPatterns(phraseWithText('Unmatched service at every level.'));
  assert(result.reason.includes('PP_003'),
    'S5: suppression reason cites pattern ID PP_003');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: FULL PIPELINE — VALIDATE()
// ─────────────────────────────────────────────────────────────────────────────

section('8. Full pipeline: validate()');

// Pass: clean phrase through all 5 stages
{
  const phrase = buildPhrase({
    claim_type:         'numeric',
    claim_source_field: 'score_breakdown.overall_score',
    injected_values:    { 'score_breakdown.overall_score': 88.0 },
    rendered_text:      'Overall score 88/100 — consistently above segment median.',
  });
  const result = validate(phrase, HOTEL);
  assert(result.valid,            'Pipeline: clean phrase → valid=true');
  assert(!result.suppressed,      'Pipeline: clean phrase → suppressed=false');
  assert(result.validator_stage === STAGES.PASSED,  'Pipeline: clean phrase → stage is PASSED');
  assert(result.audit_log.length === 5,             'Pipeline: clean phrase → 5 audit entries');
  assert(result.audit_log.every(e => e.outcome === 'passed'), 'Pipeline: all stages passed');
  assert(result.validated_claim === phrase,         'Pipeline: validated_claim is original input');
  assert(typeof result.guard_version === 'string',  'Pipeline: guard_version present');
}

// Pre-suppression short-circuit
{
  const preSupp = buildPhrase({ suppressed: true, suppression_reason: 'Missing required field: avg_rating' });
  const result = validate(preSupp, HOTEL);
  assert(!result.valid,             'Pipeline: pre-suppressed → valid=false');
  assert(result.suppressed,         'Pipeline: pre-suppressed → suppressed=true');
  assert(result.validator_stage === STAGES.PRE_SUPPRESSED, 'Pipeline: pre-suppressed → stage is pre_suppressed');
  assert(result.audit_log.length === 1,                    'Pipeline: pre-suppressed → only 1 audit entry');
  assert(result.validated_claim === null,                   'Pipeline: pre-suppressed → validated_claim is null');
  assert(result.suppression_reason.includes('avg_rating'), 'Pipeline: original suppression reason preserved');
}

// Short-circuit at Stage 1 — later stages skipped
{
  const result = validate(buildPhrase({ rendered_text: null }), HOTEL);
  assert(result.suppressed,                           'Pipeline: S1 failure → suppressed');
  assert(result.validator_stage === STAGES.FIELD_PRESENCE, 'Pipeline: S1 failure → stage is field_presence');
  assert(result.audit_log.length === 5,               'Pipeline: S1 failure → still 5 audit entries (skipped)');
  const skippedStages = result.audit_log.filter(e => e.outcome === 'skipped');
  assert(skippedStages.length === 4,                  'Pipeline: S1 failure → 4 subsequent stages skipped');
  assert(result.validated_claim === null,              'Pipeline: S1 failure → validated_claim is null');
}

// Short-circuit at Stage 2 — Stages 3-5 skipped
{
  const phrase = buildPhrase({
    claim_type:         'boolean',
    claim_source_field: 'amenity_flags.beachfront',
    injected_values:    { 'amenity_flags.beachfront': false },
  });
  const hotelNoBeach = { ...HOTEL, amenity_flags: { ...HOTEL.amenity_flags, beachfront: false } };
  const result = validate(phrase, hotelNoBeach);
  assert(result.suppressed,                                 'Pipeline: S2 failure → suppressed');
  assert(result.validator_stage === STAGES.BOOLEAN_CONSISTENCY, 'Pipeline: S2 failure → stage is boolean_consistency');
  const skipped = result.audit_log.filter(e => e.outcome === 'skipped');
  assert(skipped.length === 3,                              'Pipeline: S2 failure → 3 subsequent stages skipped');
}

// Short-circuit at Stage 5 (prohibited pattern)
{
  const phrase = buildPhrase({ rendered_text: 'World-class resort experience.' });
  const result = validate(phrase, HOTEL);
  assert(result.suppressed,                                   'Pipeline: S5 prohibited → suppressed');
  assert(result.validator_stage === STAGES.PROHIBITED_PATTERNS, 'Pipeline: S5 prohibited → correct stage');
  const skipped = result.audit_log.filter(e => e.outcome === 'skipped');
  assert(skipped.length === 0, 'Pipeline: S5 failure → no stages skipped (last stage)');
}

// Suppress at Stage 3 (review confidence) — Stages 4-5 skipped
{
  const phrase = buildPhrase({
    claim_type:         'numeric',
    claim_source_field: 'avg_rating',
    injected_values:    { avg_rating: 4.7, review_count: 5 },
    rendered_text:      '4.7/5 guest average.',
  });
  const result = validate(phrase, { ...HOTEL, review_count: 5 });
  assert(result.suppressed,                                 'Pipeline: S3 failure → suppressed');
  assert(result.validator_stage === STAGES.REVIEW_CONFIDENCE, 'Pipeline: S3 failure → correct stage');
  const skipped = result.audit_log.filter(e => e.outcome === 'skipped');
  assert(skipped.length === 2,                              'Pipeline: S3 failure → Stages 4-5 skipped');
}

// Audit log stage_id ordering
{
  const phrase = buildPhrase({
    claim_type:         'numeric',
    claim_source_field: 'score_breakdown.overall_score',
    injected_values:    { 'score_breakdown.overall_score': 88.0 },
    rendered_text:      'Overall score 88/100.',
  });
  const result = validate(phrase, HOTEL);
  assert(result.audit_log.map(e => e.stage_id).join(',') === '1,2,3,4,5',
    'Pipeline: audit log stage_ids are 1,2,3,4,5 in order');
}

// Suppression reason is always a non-empty string when suppressed
{
  const result = validate(buildPhrase({ rendered_text: null }), HOTEL);
  assert(typeof result.suppression_reason === 'string' && result.suppression_reason.length > 0,
    'Pipeline: suppression_reason is non-empty when suppressed');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: BATCH VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

section('9. Batch validation: validateBatch()');

// Empty array
{
  const results = validateBatch([], HOTEL);
  assert(Array.isArray(results) && results.length === 0,
    'validateBatch: empty array returns empty array');
}

// Single valid phrase
{
  const phrase = buildPhrase({
    injected_values: { 'score_breakdown.overall_score': 88.0 },
  });
  const results = validateBatch([phrase], HOTEL);
  assert(results.length === 1,    'validateBatch: 1 phrase returns 1 result');
  assert(results[0].valid,        'validateBatch: valid phrase in batch → valid');
}

// Mixed batch — valid and suppressed are independent
{
  const valid1 = buildPhrase({
    phrase_id: 'P1', injected_values: { 'score_breakdown.overall_score': 88.0 },
  });
  const suppressed1 = buildPhrase({
    phrase_id: 'P2', rendered_text: null,
  });
  const valid2 = buildPhrase({
    phrase_id: 'P3',
    claim_type: 'boolean',
    claim_source_field: 'amenity_flags.has_spa',
    injected_values: { 'amenity_flags.has_spa': true },
    rendered_text: 'Spa confirmed.',
  });
  const results = validateBatch([valid1, suppressed1, valid2], HOTEL);
  assert(results.length === 3,    'validateBatch: 3 inputs → 3 outputs');
  assert(results[0].valid,        'validateBatch: first phrase valid');
  assert(!results[1].valid,       'validateBatch: second phrase suppressed');
  assert(results[2].valid,        'validateBatch: third phrase valid (independence confirmed)');
}

// Invalid first argument
assertThrows(
  () => validateBatch('not-an-array', HOTEL),
  'must be an array',
  'validateBatch: non-array input throws TypeError',
);

// summariseBatch
{
  const valid1   = buildPhrase({ phrase_id: 'P1', injected_values: { 'score_breakdown.overall_score': 88.0 } });
  const invalid1 = buildPhrase({ phrase_id: 'P2', rendered_text: null });
  const invalid2 = buildPhrase({ phrase_id: 'P3', rendered_text: 'World-class amenities.' });
  const results  = validateBatch([valid1, invalid1, invalid2], HOTEL);
  const summary  = summariseBatch(results);
  assert(summary.total === 3,                               'summariseBatch: total = 3');
  assert(summary.valid === 1,                               'summariseBatch: valid = 1');
  assert(summary.suppressed === 2,                          'summariseBatch: suppressed = 2');
  assert(STAGES.FIELD_PRESENCE in summary.suppression_by_stage, 'summariseBatch: field_presence in suppression_by_stage');
  assert(typeof summary.guard_version === 'string',         'summariseBatch: guard_version present');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: INTROSPECTION UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

section('10. Introspection utilities');

{
  const registry = getProhibitedPatternRegistry();
  assert(registry.count === PROHIBITED_PATTERNS.length,
    'getProhibitedPatternRegistry: count matches PROHIBITED_PATTERNS.length');
  assert(Array.isArray(registry.patterns),
    'getProhibitedPatternRegistry: patterns is an array');
  assert(registry.patterns.every(p => typeof p.pattern_id === 'string'),
    'getProhibitedPatternRegistry: all entries have pattern_id string');
  assert(!registry.patterns.some(p => p.pattern instanceof RegExp),
    'getProhibitedPatternRegistry: does not expose compiled RegExp (only pattern_id + reason)');
}

{
  const thresholds = getReviewThresholds();
  assert(thresholds.ANY_CLAIM === REVIEW_THRESHOLDS.ANY_CLAIM,
    'getReviewThresholds: returns correct ANY_CLAIM value');
  assert(thresholds.COMPARATIVE_STANDING === REVIEW_THRESHOLDS.COMPARATIVE_STANDING,
    'getReviewThresholds: returns correct COMPARATIVE_STANDING value');
}

{
  const tolerances = getValueTolerances();
  assert(tolerances.RATING_FIELD === VALUE_TOLERANCES.RATING_FIELD,
    'getValueTolerances: returns correct RATING_FIELD value');
  assert(tolerances.SCORE_FIELD === VALUE_TOLERANCES.SCORE_FIELD,
    'getValueTolerances: returns correct SCORE_FIELD value');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

section('11. Edge cases');

// validate: null phraseResult (handled, not thrown)
{
  const result = validate(null, HOTEL);
  assert(result.suppressed,
    'Edge: validate(null, hotel) → suppressed gracefully');
  assert(!result.valid,
    'Edge: validate(null, hotel) → valid=false');
}

// validate: empty object phraseResult
{
  const result = validate({}, HOTEL);
  assert(result.suppressed,
    'Edge: validate({}, hotel) → suppressed (missing phrase_id)');
}

// validate: non-producing phrase (produces_claim=false) passes S1-S4 cleanly
{
  const phrase = buildPhrase({
    produces_claim:     false,
    claim_source_field: null,
    claim_type:         'descriptive',
    injected_values:    {},
    rendered_text:      'Located in the South Coast region of Mauritius.',
  });
  const result = validate(phrase, HOTEL);
  assert(!result.suppressed,
    'Edge: non-producing phrase → all stages pass');
}

// validate: phrase with empty injected_values
{
  const phrase = buildPhrase({
    produces_claim:     false,
    claim_type:         'descriptive',
    injected_values:    {},
    rendered_text:      'Award-rated spa on property.',
  });
  const result = validate(phrase, HOTEL);
  assert(!result.suppressed,
    'Edge: empty injected_values → no staleness check → passes');
}

// validate: hotel has additional unexpected fields (does not cause errors)
{
  const expandedHotel = { ...HOTEL, future_field: { nested: 'value' }, experimental: true };
  const phrase = buildPhrase({
    injected_values: { 'score_breakdown.overall_score': 88.0 },
  });
  const result = validate(phrase, expandedHotel);
  assert(!result.suppressed,
    'Edge: hotel with extra fields → validates correctly');
}

// validate: review_count of exactly 0
{
  const phrase = buildPhrase({
    claim_type:         'numeric',
    claim_source_field: 'avg_rating',
    injected_values:    { avg_rating: 4.7, review_count: 0 },
    rendered_text:      '4.7/5 guest average.',
  });
  const result = validate(phrase, { ...HOTEL, review_count: 0 });
  assert(result.suppressed,
    'Edge: review_count=0 → review-derived claim suppressed');
}

// validate: boolean claim, source field has truthy non-boolean (should suppress — strict true required)
{
  const phrase = buildPhrase({
    claim_type:         'boolean',
    claim_source_field: 'amenity_flags.restaurant_count',
    rendered_text:      'Restaurant confirmed.',
  });
  const result = validate(phrase, HOTEL); // restaurant_count = 4 (number, not boolean)
  assert(result.suppressed,
    'Edge: boolean claim on numeric source field (4) → suppressed (not strictly true)');
}

// Immutability: PROHIBITED_PATTERNS cannot be modified
{
  let threw = false;
  try {
    PROHIBITED_PATTERNS.push({ pattern_id: 'PP_TEST', pattern: /test/, reason: 'test' });
  } catch (_) {
    threw = true;
  }
  assert(threw || PROHIBITED_PATTERNS.length <= 20,
    'Edge: PROHIBITED_PATTERNS is frozen (push throws or has no effect)');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: INTEGRATION — PHRASE_LIBRARY + HALLUCINATION_GUARD
// ─────────────────────────────────────────────────────────────────────────────

section('12. Integration with phrase_library');

const lib = require('./phrase_library');

// Integration test 1: valid phrase from phrase_library passes guard
{
  const entry  = lib.get({ dimension: 'overall_score', type: 'strength', score_band: '90-100', context: { review_volume_tier: 'high' } });
  const phrase = lib.execute(entry, HOTEL);
  const result = validate(phrase, HOTEL);
  assert(!result.suppressed,
    'Integration: high-volume strength phrase → passes guard');
  assert(result.valid,
    'Integration: validated_claim is populated for valid phrase');
}

// Integration test 2: location beachfront phrase passes guard
{
  const entry  = lib.get({ dimension: 'location_score', type: 'strength', score_band: '90-100', context: { beachfront: true } });
  const phrase = lib.execute(entry, HOTEL);
  const result = validate(phrase, HOTEL);
  assert(!result.suppressed,
    'Integration: beachfront location phrase → passes guard');
}

// Integration test 3: spa_award phrase suppressed when spa_award_rated=false
{
  const hotelNoAward = { ...HOTEL, amenity_flags: { ...HOTEL.amenity_flags, spa_award_rated: false } };
  const entry  = lib.get({ dimension: 'amenity_score', type: 'strength', score_band: '90-100', context: { has_spa: true, spa_award_rated: true } });
  const phrase = lib.execute(entry, hotelNoAward);  // phrase fires (requires only checks field presence)
  const result = validate(phrase, hotelNoAward);    // guard suppresses (boolean strict check)
  assert(result.suppressed,
    'Integration: award phrase for hotel with spa_award_rated=false → guard suppresses');
  assert(result.validator_stage === STAGES.BOOLEAN_CONSISTENCY,
    'Integration: suppression at boolean_consistency stage');
}

// Integration test 4: numeric rating phrase suppressed when review_count < 50
{
  const thinHotel = { ...HOTEL, review_count: 20 };
  const entry  = lib.get({ dimension: 'overall_score', type: 'strength', score_band: '90-100', context: { review_volume_tier: 'high' } });
  const phrase = lib.execute(entry, thinHotel);
  const result = validate(phrase, thinHotel);
  assert(result.suppressed,
    'Integration: numeric rating phrase with 20 reviews → guard suppresses at review_confidence');
}

// Integration test 5: wellness fit phrase passes for valid spa hotel
{
  const entry  = lib.get({ dimension: 'amenity_score', type: 'fit_positive', score_band: '70-79', context: { persona: 'wellness', has_spa: true } });
  const phrase = lib.execute(entry, HOTEL);
  const result = validate(phrase, HOTEL);
  assert(!result.suppressed,
    'Integration: wellness fit phrase with spa=true → passes guard');
}

// Integration test 6: batch validation through phrase_library
{
  const phrases = [
    lib.execute(lib.get({ dimension: 'overall_score', type: 'strength', score_band: '90-100', context: {} }), HOTEL),
    lib.execute(lib.get({ dimension: 'location_score', type: 'strength', score_band: '90-100', context: { beachfront: true } }), HOTEL),
    lib.execute(lib.get({ dimension: 'amenity_score', type: 'weakness', score_band: '50-59', context: {} }), HOTEL),
  ];
  const results = validateBatch(phrases, HOTEL);
  assert(results.length === 3, 'Integration: batch of 3 → 3 ValidationResults');
  const summary = summariseBatch(results);
  assert(summary.total === 3,  'Integration: batch summary total = 3');
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n' + '═'.repeat(62) + '\n');
if (failed === 0) {
  process.stdout.write(`ALL ${passed} TESTS PASSED\n`);
} else {
  process.stdout.write(`${passed} passed — ${failed} FAILED\n\n`);
  process.stdout.write('Failures:\n');
  for (const f of failures) {
    process.stdout.write(`  ✗ ${f}\n`);
  }
}
process.stdout.write('═'.repeat(62) + '\n');

process.exit(failed > 0 ? 1 : 0);
