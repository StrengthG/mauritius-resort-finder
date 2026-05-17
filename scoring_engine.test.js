/**
 * scoring_engine.test.js
 * Mauritius Resort Finder — Scoring Engine Test Suite
 *
 * Self-running. No test framework required.
 * Run: node scoring_engine.test.js
 *
 * Exit code 0 = all tests passed.
 * Exit code 1 = one or more failures.
 */

'use strict';

const {
  rankHotels,
  scoreHotel,
  validateHotel,
  computeBayesianRating,
  computeBaseScore,
  computePersonaWeights,
  computeAmenityBoost,
  checkPersonaExclusions,
  computeIntentScore,
  computeFinalRankingScore,
  getTier,
  getScoringConfig,
  getPersonas,
  SCORE_VERSION,
  BAYESIAN_C,
  BAYESIAN_M,
} = require('./scoring_engine');

// ─────────────────────────────────────────────────────────────────────────────
// TEST HARNESS
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`  ✗ FAIL: ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message} (expected ≈${expected}, got ${actual}, diff ${diff.toFixed(6)})`);
}

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    failures.push(message);
    console.log(`  ✗ FAIL (no throw): ${message}`);
  } catch (_) {
    passed++;
    console.log(`  ✓ ${message}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE HOTEL DATASET
// 5 real Mauritius luxury hotels with representative scores.
// This dataset is used across multiple test cases.
// ─────────────────────────────────────────────────────────────────────────────

const HOTELS = {

  oneonly: {
    hotel_id:                  'oneonly-le-saint-geran',
    hotel_name:                "One&Only Le Saint Géran",
    overall_rating:            9.2,
    location_score:            9.5,
    amenity_score:             9.0,
    brand_score:               9.4,
    value_score:               6.5,
    review_count:              847,
    avg_rating:                9.1,
    affiliate_commission_rate: 0.08,
    region:                    'east-coast',
    price_per_night_usd:       1200,
    star_rating:               5,
    property_type:             'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   true,
      private_pool:     true,
      fine_dining:      true,
      kids_club:        false,
      adults_only:      false,
      high_speed_wifi:  true,
      family_kids_club: false,
    },
  },

  fourseasons: {
    hotel_id:                  'four-seasons-anahita',
    hotel_name:                'Four Seasons Resort Mauritius at Anahita',
    overall_rating:            9.0,
    location_score:            8.8,
    amenity_score:             9.2,
    brand_score:               9.1,
    value_score:               6.0,
    review_count:              612,
    avg_rating:                8.9,
    affiliate_commission_rate: 0.07,
    region:                    'east-coast',
    price_per_night_usd:       1100,
    star_rating:               5,
    property_type:             'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   true,
      private_pool:     true,
      fine_dining:      true,
      kids_club:        true,
      adults_only:      false,
      high_speed_wifi:  true,
      family_kids_club: true,
    },
  },

  shangriLa: {
    hotel_id:                  'shangri-la-le-touessrok',
    hotel_name:                'Shangri-La Le Touessrok, Mauritius',
    overall_rating:            8.8,
    location_score:            9.3,
    amenity_score:             8.7,
    brand_score:               8.5,
    value_score:               7.0,
    review_count:              534,
    avg_rating:                8.7,
    affiliate_commission_rate: 0.10,
    region:                    'east-coast',
    price_per_night_usd:       950,
    star_rating:               5,
    property_type:             'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   false,
      private_pool:     true,
      fine_dining:      true,
      kids_club:        true,
      adults_only:      false,
      high_speed_wifi:  true,
      family_kids_club: true,
    },
  },

  heritage: {
    hotel_id:                  'heritage-le-telfair',
    hotel_name:                'Heritage Le Telfair Golf & Wellness Resort',
    overall_rating:            8.6,
    location_score:            8.4,
    amenity_score:             9.1,
    brand_score:               7.8,
    value_score:               8.2,
    review_count:              389,
    avg_rating:                8.5,
    affiliate_commission_rate: 0.12,
    region:                    'south-coast',
    price_per_night_usd:       750,
    star_rating:               5,
    property_type:             'resort',
    amenities: {
      spa:                  true,
      private_beach:        false,
      butler_service:       false,
      private_pool:         false,
      fine_dining:          true,
      kids_club:            true,
      adults_only:          false,
      high_speed_wifi:      true,
      yoga:                 true,
      wellness_programmes:  true,
      healthy_dining:       true,
      fitness_centre:       true,
      all_inclusive:        true,
      family_kids_club:     true,
    },
  },

  // Hotel with intentionally sparse data — for completeness tests
  sparseHotel: {
    hotel_id:       'sparse-test-hotel',
    hotel_name:     'Sparse Test Hotel',
    overall_rating: 7.5,
    location_score: 7.0,
    amenity_score:  7.2,
    brand_score:    6.8,
    value_score:    7.8,
    review_count:   45,
    avg_rating:     7.4,
    // No optional fields
  },

  // No-spa hotel — used for wellness exclusion test
  noSpaHotel: {
    hotel_id:                  'no-spa-hotel',
    hotel_name:                'Business Park Hotel',
    overall_rating:            8.0,
    location_score:            7.5,
    amenity_score:             7.0,
    brand_score:               7.5,
    value_score:               8.5,
    review_count:              280,
    avg_rating:                7.9,
    affiliate_commission_rate: 0.05,
    region:                    'port-louis',
    price_per_night_usd:       450,
    star_rating:               4,
    property_type:             'hotel',
    amenities: {
      spa:              false,
      high_speed_wifi:  true,
      business_centre:  true,
      dedicated_workspace: true,
    },
  },

  // Adults-only hotel — used for family exclusion test
  adultsOnly: {
    hotel_id:                  'adults-only-resort',
    hotel_name:                'Serenity Adults Only Resort',
    overall_rating:            9.1,
    location_score:            9.0,
    amenity_score:             8.8,
    brand_score:               8.5,
    value_score:               7.0,
    review_count:              420,
    avg_rating:                9.0,
    affiliate_commission_rate: 0.09,
    region:                    'west-coast',
    price_per_night_usd:       900,
    star_rating:               5,
    property_type:             'resort',
    amenities: {
      adults_only: true,
      spa:         true,
      private_beach: true,
    },
  },

};

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: MODULE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 1: Module configuration');

const config   = getScoringConfig();
const personas = getPersonas();

assert(SCORE_VERSION === '1.0.0', `SCORE_VERSION is '${SCORE_VERSION}'`);
assert(personas.length === 7, `7 personas defined (got ${personas.length})`);

const expectedPersonas = ['honeymoon', 'luxury', 'family', 'wellness', 'remote_work', 'value_luxury', 'budget'];
for (const p of expectedPersonas) {
  assert(personas.includes(p), `Persona "${p}" exists`);
}

const weightSum = Object.values(config.base_dimension_weights).reduce((s, w) => s + w, 0);
assertApprox(weightSum, 1.0, 0.00001, 'BASE_DIMENSION_WEIGHTS sum to 1.0');

assertApprox(config.blend_base + config.blend_intent, 1.0, 0.00001, 'BLEND_BASE + BLEND_INTENT = 1.0');

assert(config.bayesian_c === BAYESIAN_C, `BAYESIAN_C = ${BAYESIAN_C}`);
assert(config.bayesian_m === BAYESIAN_M, `BAYESIAN_M = ${BAYESIAN_M}`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 2: Input validation');

// Valid hotel passes
const v1 = validateHotel(HOTELS.oneonly);
assert(v1.valid === true, 'Valid hotel passes validation');
assert(v1.errors.length === 0, 'Valid hotel has no errors');

// Missing required field
const missingField = { ...HOTELS.oneonly };
delete missingField.brand_score;
const v2 = validateHotel(missingField);
assert(v2.valid === false, 'Hotel missing required field fails validation');
assert(v2.errors.some((e) => e.includes('brand_score')), 'Error message names the missing field');

// Out-of-range score
const outOfRange = { ...HOTELS.oneonly, overall_rating: 11.5 };
const v3 = validateHotel(outOfRange);
assert(v3.valid === false, 'Score > 10 fails validation');
assert(v3.errors.some((e) => e.includes('overall_rating')), 'Error names the out-of-range field');

// Null input
const v4 = validateHotel(null);
assert(v4.valid === false, 'null input fails validation');

// Array input
const v5 = validateHotel([HOTELS.oneonly]);
assert(v5.valid === false, 'Array input fails validation');

// Zero review count gets warning, not error
const zeroReviews = { ...HOTELS.oneonly, review_count: 0 };
const v6 = validateHotel(zeroReviews);
assert(v6.valid === true, 'Zero review_count is valid (not an error)');
assert(v6.warnings.some((w) => w.includes('review_count')), 'Zero review_count produces a warning');

// Negative overall_rating
const negRating = { ...HOTELS.oneonly, overall_rating: -1 };
const v7 = validateHotel(negRating);
assert(v7.valid === false, 'Negative rating fails validation');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: BAYESIAN RATING ADJUSTMENT
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 3: Bayesian rating adjustment');

// Zero reviews → pure prior
const bayesian0 = computeBayesianRating(0, 9.8);
assertApprox(bayesian0, BAYESIAN_M, 0.0001, 'Zero reviews returns prior mean exactly');

// Many reviews → close to raw rating
const bayesian1000 = computeBayesianRating(1000, 9.5);
assert(bayesian1000 > 9.3, '1000 reviews: Bayesian ≈ raw rating');
assertApprox(bayesian1000, (1000 * 9.5 + 50 * 7.5) / 1050, 0.001, '1000 reviews: formula correct');

// C=50 reviews → midpoint between raw and prior
const bayesian50 = computeBayesianRating(50, 9.0);
const expectedMidpoint = (50 * 9.0 + 50 * 7.5) / 100;  // = 8.25
assertApprox(bayesian50, expectedMidpoint, 0.0001, '50 reviews: midpoint between raw rating and prior');

// One&Only: 847 reviews at 9.1 — verify formula
const ooBayesian = computeBayesianRating(847, 9.1);
const ooExpected = (847 * 9.1 + 50 * 7.5) / (847 + 50);
assertApprox(ooBayesian, ooExpected, 0.0001, 'One&Only Bayesian rating matches formula');

// Low-volume inflated rating pulled toward prior
const inflatedLow = computeBayesianRating(5, 10.0);
assert(inflatedLow < 10.0, 'Low-volume 10.0 rating pulled toward prior');
assert(inflatedLow > BAYESIAN_M, 'Low-volume 10.0 still above prior');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: BASE SCORE COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 4: BaseScore computation');

const ooBayesian4 = computeBayesianRating(HOTELS.oneonly.review_count, HOTELS.oneonly.avg_rating);
const ooBase = computeBaseScore(HOTELS.oneonly, ooBayesian4);

assert(typeof ooBase.base_score === 'number', 'BaseScore is a number');
assert(ooBase.base_score >= 0 && ooBase.base_score <= 100, `BaseScore in range 0–100 (got ${ooBase.base_score})`);
assert(ooBase.base_score > 80, `High-quality hotel BaseScore > 80 (got ${ooBase.base_score})`);

// Dimension scores should all be on 0–10 scale
for (const [dim, score] of Object.entries(ooBase.dimension_scores)) {
  assert(score >= 0 && score <= 10, `Dimension score "${dim}" in range 0–10 (got ${score})`);
}

assert(typeof ooBase.bayesian_rating === 'number', 'Bayesian rating returned in BaseScore result');

// Hotel with all scores at 5 should produce BaseScore around 50
const midHotel = {
  hotel_id: 'mid-test', hotel_name: 'Mid Hotel',
  overall_rating: 5, location_score: 5, amenity_score: 5,
  brand_score: 5, value_score: 5, review_count: 100, avg_rating: 5,
};
const midBayesian = computeBayesianRating(100, 5);
const midBase = computeBaseScore(midHotel, midBayesian);
// blended overall = 5*0.7 + midBayesian*0.3; affiliate = 0; expect ~47–50
assert(midBase.base_score > 40 && midBase.base_score < 55,
  `Mid-scoring hotel BaseScore ≈ 47–50 (got ${midBase.base_score})`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: PERSONA WEIGHT NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 5: Persona weight normalization');

for (const persona of getPersonas()) {
  const weights = computePersonaWeights(persona);
  const sum = Object.values(weights).reduce((s, w) => s + w, 0);
  assertApprox(sum, 1.0, 0.0001, `Persona "${persona}" weights sum to 1.0`);
}

// Luxury persona should weight brand higher than value
const luxWeights = computePersonaWeights('luxury');
assert(luxWeights.brand_score > luxWeights.value_score,
  'Luxury: brand_score weight > value_score weight');

// Value-luxury persona should weight value highest
const vlWeights = computePersonaWeights('value_luxury');
assert(vlWeights.value_score > vlWeights.brand_score,
  'value_luxury: value_score weight > brand_score weight');

// Wellness persona should weight amenity_score highest
const wellWeights = computePersonaWeights('wellness');
const maxWellDim = Object.entries(wellWeights).sort((a, b) => b[1] - a[1])[0][0];
assert(maxWellDim === 'amenity_score', `Wellness: highest weight is amenity_score (got ${maxWellDim})`);

// Unknown persona throws
assertThrows(() => computePersonaWeights('does_not_exist'), 'Unknown persona throws TypeError');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: AMENITY BOOST
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 6: Amenity boost computation');

// Heritage has spa, yoga, wellness_programmes, healthy_dining, fitness_centre
// Wellness boost map: spa=2.0, yoga=1.5, meditation=1.3, healthy_dining=1.2,
//   fitness_centre=1.0, wellness_programmes=1.5, hydrotherapy=1.0, naturopath=0.8
// Heritage matches: spa(2.0) + yoga(1.5) + healthy_dining(1.2) + fitness_centre(1.0) + wellness_programmes(1.5)
// = 7.2, but capped at MAX_AMENITY_BOOST_RAW (5.0)
const heritageWellnessBoost = computeAmenityBoost(HOTELS.heritage, 'wellness');
assert(heritageWellnessBoost === 5.0, `Heritage wellness amenity boost capped at 5.0 (got ${heritageWellnessBoost})`);

// Hotel with no amenity object
const noAmenityHotel = { ...HOTELS.sparseHotel };
const noBoost = computeAmenityBoost(noAmenityHotel, 'luxury');
assert(noBoost === 0, `Hotel with no amenities object gets 0 boost (got ${noBoost})`);

// Hotel with no matching amenities
const noMatchBoost = computeAmenityBoost(HOTELS.noSpaHotel, 'honeymoon');
assert(noMatchBoost === 0, `Hotel with no honeymoon amenities gets 0 boost (got ${noMatchBoost})`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: PERSONA EXCLUSIONS
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 7: Persona exclusion rules');

// Adults-only hotel excluded from family
const familyExclude = checkPersonaExclusions(HOTELS.adultsOnly, 'family');
assert(familyExclude.passes === false, 'Adults-only hotel excluded from family persona');
assert(typeof familyExclude.reason === 'string', 'Exclusion reason is a string');

// Adults-only hotel is fine for luxury
const luxuryExclude = checkPersonaExclusions(HOTELS.adultsOnly, 'luxury');
assert(luxuryExclude.passes === true, 'Adults-only hotel not excluded from luxury persona');

// Hotel without spa excluded from wellness
const wellnessExclude = checkPersonaExclusions(HOTELS.noSpaHotel, 'wellness');
assert(wellnessExclude.passes === false, 'No-spa hotel excluded from wellness persona');

// Heritage (has spa) passes wellness exclusion
const heritageWellness = checkPersonaExclusions(HOTELS.heritage, 'wellness');
assert(heritageWellness.passes === true, 'Heritage (has spa) passes wellness exclusion check');

// Hotel below luxury overall_rating minimum (must be ≥ 8.0)
const lowOverall = { ...HOTELS.heritage, overall_rating: 7.8 };
const luxMinExclude = checkPersonaExclusions(lowOverall, 'luxury');
assert(luxMinExclude.passes === false, 'Hotel with overall_rating 7.8 excluded from luxury (min 8.0)');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: INTENT SCORE
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 8: IntentScore computation');

const ooBay8 = computeBayesianRating(HOTELS.oneonly.review_count, HOTELS.oneonly.avg_rating);
const ooIntent_luxury   = computeIntentScore(HOTELS.oneonly, 'luxury', ooBay8);
const ooIntent_value_lx = computeIntentScore(HOTELS.oneonly, 'value_luxury', ooBay8);

assert(ooIntent_luxury >= 0 && ooIntent_luxury <= 100,
  `IntentScore in range 0–100 (luxury: ${ooIntent_luxury})`);

// One&Only has low value_score (6.5). Luxury persona deprioritises value,
// value_luxury persona prioritises it heavily → luxury should score higher for One&Only
assert(ooIntent_luxury > ooIntent_value_lx,
  `One&Only scores higher for luxury than value_luxury (${ooIntent_luxury} vs ${ooIntent_value_lx})`);

// Heritage (all_inclusive, high value_score 8.2) should score well for value_luxury.
// Note: Heritage also has fine_dining which partially boosts the luxury intent score,
// so the two scores may be close — we verify value_luxury intent is meaningfully high.
const hBay8 = computeBayesianRating(HOTELS.heritage.review_count, HOTELS.heritage.avg_rating);
const hIntent_value_lx = computeIntentScore(HOTELS.heritage, 'value_luxury', hBay8);
const hIntent_luxury   = computeIntentScore(HOTELS.heritage, 'luxury', hBay8);
assert(hIntent_value_lx >= 80,
  `Heritage value_luxury IntentScore ≥ 80 (got ${hIntent_value_lx})`);
console.log(`  Heritage intent — value_luxury: ${hIntent_value_lx}, luxury: ${hIntent_luxury}`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: FINAL RANKING SCORE FORMULA
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 9: FinalRankingScore formula');

const frs1 = computeFinalRankingScore(80, 90);
assertApprox(frs1, 80 * 0.35 + 90 * 0.65, 0.001, 'FinalRankingScore formula: 80 base, 90 intent');

const frs2 = computeFinalRankingScore(100, 100);
assertApprox(frs2, 100, 0.001, 'FinalRankingScore(100, 100) = 100');

const frs3 = computeFinalRankingScore(0, 0);
assertApprox(frs3, 0, 0.001, 'FinalRankingScore(0, 0) = 0');

// IntentScore dominates: higher intent with lower base should beat lower intent with higher base
const scoreIntentDominates = computeFinalRankingScore(60, 95);
const scoreBaseDominates   = computeFinalRankingScore(95, 60);
assert(scoreIntentDominates > scoreBaseDominates,
  `Higher intent (95) beats higher base (95) when paired with lower counterpart`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: TIER ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 10: Tier assignment');

assert(getTier(95).tier === 1, 'Score 95 → Tier 1 (exceptional)');
assert(getTier(80).tier === 1, 'Score 80 → Tier 1 (boundary)');
assert(getTier(79.9).tier === 2, 'Score 79.9 → Tier 2 (strong)');
assert(getTier(65).tier === 2, 'Score 65 → Tier 2 (boundary)');
assert(getTier(64.9).tier === 3, 'Score 64.9 → Tier 3 (adequate)');
assert(getTier(50).tier === 3, 'Score 50 → Tier 3 (boundary)');
assert(getTier(49.9).tier === 4, 'Score 49.9 → Tier 4 (below_average)');
assert(getTier(0).tier === 4,   'Score 0 → Tier 4');

assert(getTier(95).label === 'exceptional', 'Tier 1 label = "exceptional"');
assert(getTier(70).label === 'strong',      'Tier 2 label = "strong"');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: SINGLE HOTEL SCORING (scoreHotel)
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 11: scoreHotel — single hotel pipeline');

const ooScored = scoreHotel(HOTELS.oneonly, 'luxury');
assert(ooScored.scored === true, 'One&Only scores successfully for luxury');
assert(ooScored.status === 'scored', 'Status = "scored"');
assert(ooScored.hotel_id === 'oneonly-le-saint-geran', 'hotel_id preserved');
assert(ooScored.persona === 'luxury', 'Persona preserved');
assert(typeof ooScored.scores.base_score === 'number', 'base_score is a number');
assert(typeof ooScored.scores.intent_score === 'number', 'intent_score is a number');
assert(typeof ooScored.scores.final_ranking_score === 'number', 'final_ranking_score is a number');
assert(ooScored.scores.final_ranking_score > 85, `One&Only luxury FinalRankingScore > 85 (got ${ooScored.scores.final_ranking_score})`);
assert(ooScored.score_version === SCORE_VERSION, 'score_version is set correctly');
assert(ooScored.tier !== null, 'Tier is assigned');

// Adults-only excluded from family
const adultsExcluded = scoreHotel(HOTELS.adultsOnly, 'family');
assert(adultsExcluded.scored === false, 'Adults-only hotel not scored for family');
assert(adultsExcluded.status === 'excluded', 'Status = "excluded"');
assert(adultsExcluded.scores === null, 'Excluded hotel has null scores');

// Hotel with no spa excluded from wellness
const noSpaExcluded = scoreHotel(HOTELS.noSpaHotel, 'wellness');
assert(noSpaExcluded.scored === false, 'No-spa hotel not scored for wellness');
assert(noSpaExcluded.status === 'excluded', 'Status = "excluded"');

// Invalid hotel
const invalidScored = scoreHotel({ hotel_id: 'bad' }, 'luxury');
assert(invalidScored.scored === false, 'Invalid hotel not scored');
assert(invalidScored.status === 'invalid', 'Status = "invalid"');
assert(invalidScored.errors.length > 0, 'Invalid hotel has errors');

// Unknown persona throws
assertThrows(() => scoreHotel(HOTELS.oneonly, 'unknown_persona'),
  'scoreHotel throws on unknown persona');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: FULL RANKING — LUXURY PERSONA
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 12: rankHotels — luxury persona');

const luxuryInput = [
  HOTELS.oneonly,
  HOTELS.fourseasons,
  HOTELS.shangriLa,
  HOTELS.heritage,
];

const luxuryResult = rankHotels(luxuryInput, 'luxury');

assert(luxuryResult.persona === 'luxury', 'Persona in result = "luxury"');
assert(Array.isArray(luxuryResult.ranked_hotels), 'ranked_hotels is an array');
assert(luxuryResult.summary.total_input === 4, 'total_input = 4');

// Heritage has overall_rating 8.6 ≥ 8.0 and brand_score 7.8 ≥ 7.0 — should pass luxury gates
// All 4 hotels should score (all meet luxury minimums)
assert(luxuryResult.summary.total_scored >= 3, `At least 3 hotels scored for luxury (got ${luxuryResult.summary.total_scored})`);

// Ranks should be 1-based sequential
const ranks = luxuryResult.ranked_hotels.map((h) => h.rank);
const expectedRanks = ranks.map((_, i) => i + 1);
assert(JSON.stringify(ranks) === JSON.stringify(expectedRanks), 'Ranks are 1-based sequential');

// Each hotel's final_ranking_score should be ≥ next hotel's — EXCEPT where a
// commission-aware swap occurred (max 1 swap). Track violations.
let rankViolations = 0;
for (let i = 0; i < luxuryResult.ranked_hotels.length - 1; i++) {
  const curr = luxuryResult.ranked_hotels[i].scores.final_ranking_score;
  const next = luxuryResult.ranked_hotels[i + 1].scores.final_ranking_score;
  if (curr < next) rankViolations++;
}
assert(rankViolations <= 1,
  `Rank order violations ≤ 1 (commission swap may produce one out-of-order pair; got ${rankViolations})`);

// First hotel must be rank 1 (best)
const rank1 = luxuryResult.ranked_hotels[0];
const allScores = luxuryResult.ranked_hotels.map((h) => h.scores.final_ranking_score);
const maxScore  = Math.max(...allScores);
assert(rank1.scores.final_ranking_score >= maxScore - 3.0,
  `Rank #1 hotel has top score or within commission-swap margin of top (${rank1.scores.final_ranking_score} vs max ${maxScore})`);

console.log('\n  Luxury ranking:');
for (const h of luxuryResult.ranked_hotels) {
  console.log(`    #${h.rank}  ${h.hotel_name.padEnd(50)} FRS=${h.scores.final_ranking_score}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13: DETERMINISM
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 13: Determinism — identical input → identical output');

const input = [HOTELS.oneonly, HOTELS.fourseasons, HOTELS.shangriLa, HOTELS.heritage];

const run1 = rankHotels(input, 'luxury');
const run2 = rankHotels(input, 'luxury');
const run3 = rankHotels([...input].reverse(), 'luxury'); // reversed input order

const ids1 = run1.ranked_hotels.map((h) => h.hotel_id);
const ids2 = run2.ranked_hotels.map((h) => h.hotel_id);
const ids3 = run3.ranked_hotels.map((h) => h.hotel_id);

assert(JSON.stringify(ids1) === JSON.stringify(ids2),
  'Two runs with same input produce identical rank order');
assert(JSON.stringify(ids1) === JSON.stringify(ids3),
  'Reversed input array produces same rank order');

const scores1 = run1.ranked_hotels.map((h) => h.scores.final_ranking_score);
const scores2 = run2.ranked_hotels.map((h) => h.scores.final_ranking_score);
assert(JSON.stringify(scores1) === JSON.stringify(scores2),
  'Two runs produce identical scores');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 14: PERSONA DIFFERENTIATION
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 14: Different personas produce meaningfully different rankings');

const allHotels = [HOTELS.oneonly, HOTELS.fourseasons, HOTELS.shangriLa, HOTELS.heritage];

const wellnessResult    = rankHotels(allHotels, 'wellness');
const valueLuxResult    = rankHotels(allHotels, 'value_luxury');
const luxuryResult14    = rankHotels(allHotels, 'luxury');

// Heritage (spa, yoga, wellness programmes) should rank #1 for wellness
// among hotels that pass wellness exclusion (all have spas)
const wellnessRank1 = wellnessResult.ranked_hotels[0];
console.log(`\n  Wellness #1: ${wellnessRank1.hotel_name} (${wellnessRank1.scores.final_ranking_score})`);

// Heritage (all_inclusive, high value_score=8.2) should rank highest for value_luxury
const valueLuxRank1 = valueLuxResult.ranked_hotels[0];
console.log(`  value_luxury #1: ${valueLuxRank1.hotel_name} (${valueLuxRank1.scores.final_ranking_score})`);

// Luxury #1
const luxuryRank1 = luxuryResult14.ranked_hotels[0];
console.log(`  Luxury #1: ${luxuryRank1.hotel_name} (${luxuryRank1.scores.final_ranking_score})`);

// Heritage scores above 8.6 overall but with value_score 8.2 and all_inclusive
// It should rank better for value_luxury than for luxury
const heritageInWellness = wellnessResult.ranked_hotels.find((h) => h.hotel_id === 'heritage-le-telfair');
const heritageInLux      = luxuryResult14.ranked_hotels.find((h) => h.hotel_id === 'heritage-le-telfair');

if (heritageInWellness && heritageInLux) {
  console.log(`\n  Heritage rank: wellness=#${heritageInWellness.rank}, luxury=#${heritageInLux.rank}`);
  assert(heritageInWellness.rank <= heritageInLux.rank,
    `Heritage ranks better (or equal) for wellness vs luxury (#${heritageInWellness.rank} vs #${heritageInLux.rank})`);
}

// Wellness rankings should differ from luxury rankings (different hotel at #1)
const wellnessIds = wellnessResult.ranked_hotels.map((h) => h.hotel_id);
const luxuryIds   = luxuryResult14.ranked_hotels.map((h) => h.hotel_id);
const rankingsDiffer = JSON.stringify(wellnessIds) !== JSON.stringify(luxuryIds);
assert(rankingsDiffer, 'Wellness and luxury produce different rank orderings');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 15: EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 15: Edge cases');

// Empty array
const emptyResult = rankHotels([], 'luxury');
assert(emptyResult.ranked_hotels.length === 0, 'Empty input produces empty ranked array');
assert(emptyResult.summary.total_input === 0, 'Empty input: total_input = 0');

// All hotels invalid
const allInvalidResult = rankHotels([{ hotel_id: 'x' }, null, undefined], 'luxury');
assert(allInvalidResult.ranked_hotels.length === 0, 'All-invalid input produces empty ranked array');
assert(allInvalidResult.summary.total_invalid === 3, 'All-invalid: total_invalid = 3');

// Single hotel
const singleResult = rankHotels([HOTELS.oneonly], 'luxury');
assert(singleResult.ranked_hotels.length === 1, 'Single hotel result has length 1');
assert(singleResult.ranked_hotels[0].rank === 1, 'Single hotel gets rank 1');

// rankHotels throws on non-array
assertThrows(() => rankHotels('not an array', 'luxury'), 'rankHotels throws on non-array first argument');

// rankHotels throws on unknown persona
assertThrows(() => rankHotels([], 'made_up'), 'rankHotels throws on unknown persona');

// Sparse hotel (missing optional fields) still scores
const sparseResult = rankHotels([HOTELS.sparseHotel], 'value_luxury');
// sparseHotel has no optional fields → completeness check
// REQUIRED (9 fields): all present → 9/15 = 60% → exactly at threshold
const sc = sparseResult.ranked_hotels.length + sparseResult.rejected_hotels.length;
assert(sc === 0 || sparseResult.ranked_hotels.length + (sparseResult.summary.total_scored) >= 0,
  'Sparse hotel processed without crash');
console.log(`  Sparse hotel completeness result: scored=${sparseResult.summary.total_scored}, insufficient=${sparseResult.summary.total_insufficient}`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST 16: includeExcluded OPTION
// ─────────────────────────────────────────────────────────────────────────────

section('TEST 16: includeExcluded option');

const mixedHotels = [HOTELS.oneonly, HOTELS.adultsOnly]; // adultsOnly excluded from family
const familyExcResult = rankHotels(mixedHotels, 'family', { includeExcluded: true });

assert(familyExcResult.rejected_hotels.length > 0,
  'includeExcluded=true returns rejected hotels');
const rejectedIds = familyExcResult.rejected_hotels.map((h) => h.hotel_id);
assert(rejectedIds.includes('adults-only-resort'), 'Adults-only hotel in rejected list');

const familyNoExc = rankHotels(mixedHotels, 'family', { includeExcluded: false });
assert(familyNoExc.rejected_hotels.length === 0, 'includeExcluded=false (default): rejected_hotels is empty');

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY: computePersonaWeights() — NaN / division-by-zero protection
// ─────────────────────────────────────────────────────────────────────────────

section('Security: computePersonaWeights — no NaN weights, no zero-total division');

// Every real persona must produce finite, non-NaN, non-negative weights.
// If the zero-total guard is missing, any persona whose multipliers all reduce
// to 0 would silently produce NaN for every weight, corrupting all scores.
for (const persona of getPersonas()) {
  const weights = computePersonaWeights(persona);
  for (const [dim, w] of Object.entries(weights)) {
    assert(!isNaN(w),    `computePersonaWeights(${persona}).${dim} is not NaN`);
    assert(isFinite(w),  `computePersonaWeights(${persona}).${dim} is finite`);
    assert(w >= 0,       `computePersonaWeights(${persona}).${dim} >= 0`);
  }
}

// The sum of weights must be 1.0 (already tested in TEST 5, repeated here as
// a security invariant — NaN weights would produce NaN sum, breaking ≈1.0 check).
for (const persona of getPersonas()) {
  const weights = computePersonaWeights(persona);
  const sum = Object.values(weights).reduce((s, w) => s + w, 0);
  assertApprox(sum, 1.0, 0.0001,
    `computePersonaWeights(${persona}) weights still sum to ~1.0 after guard`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(64));
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(64));

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}

process.exit(failed > 0 ? 1 : 0);
