/**
 * integration_harness.js
 * Mauritius Resort Finder — Full Pipeline Integration Harness
 * Version: 1.0.0
 *
 * Executes the complete recommendation pipeline end-to-end:
 *
 *   [1] Load hotel dataset
 *   [2] scoring_engine  → ranked hotel list
 *   [3] Adapter         → bridge ScoredHotel → engine-compatible format
 *   [4] explanation_engine → ExplanationObjects
 *   [5] block_assembler → ordered block sequence
 *   [6] Quality gates   → structural + content invariants
 *   [7] Export artifacts → rankings.json, explanations.json, blocks.json,
 *                          page.json, qa_report.json
 *
 * Design invariants:
 *   - Deterministic: same input dataset always produces identical output
 *   - Fail-loud: any critical error throws immediately with a clear audit trail
 *   - No side effects on module state
 *   - All exported JSON files are human-readable (2-space indent)
 *
 * Usage:
 *   node integration_harness.js [--persona <persona>] [--out <dir>]
 *   node integration_harness.js                    # defaults: luxury, ./artifacts
 *   node integration_harness.js --persona wellness --out ./out
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// MODULES
// ─────────────────────────────────────────────────────────────────────────────

const scoringEngine      = require('./scoring_engine.js');
const explanationEngine  = require('./explanation_engine.js');
const blockAssembler     = require('./block_assembler.js');

// ─────────────────────────────────────────────────────────────────────────────
// HARNESS VERSION
// ─────────────────────────────────────────────────────────────────────────────

const HARNESS_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// CLI ARGS
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args    = process.argv.slice(2);
  let   persona = 'luxury';
  let   outDir  = path.join(__dirname, 'artifacts');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--persona' && args[i + 1]) { persona = args[++i]; }
    if (args[i] === '--out'     && args[i + 1]) { outDir  = path.resolve(args[++i]); }
  }

  return { persona, outDir };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOTEL DATASET  (Mauritius luxury properties)
//
// Fields required by scoring_engine:
//   hotel_id, hotel_name, overall_rating, location_score, amenity_score,
//   brand_score, value_score, review_count, avg_rating
//
// Optional but used by explanation_engine:
//   avg_nightly_rate, amenities, star_rating, region
//
// Scoring notes:
//   All scores are on 0–10 scale for scoring_engine input.
//   For luxury persona: overall_rating >= 8.0, brand_score >= 7.0 required.
// ─────────────────────────────────────────────────────────────────────────────

const HOTEL_DATASET = [
  {
    hotel_id:                'MQ001',
    hotel_name:              'Royal Palm Beachcomber Luxury',
    overall_rating:           9.2,
    location_score:           9.4,
    amenity_score:            9.1,
    brand_score:              9.0,
    value_score:              7.2,
    review_count:            1340,
    avg_rating:               4.8,
    avg_nightly_rate:        1450,
    affiliate_commission_rate: 0.08,
    star_rating:              5,
    region:                  'Grand Baie',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   true,
      fine_dining:      true,
      private_pool:     true,
      overwater_villa:  false,
      pool:             true,
      gym:              true,
      concierge:        true,
    },
  },
  {
    hotel_id:                'MQ002',
    hotel_name:              'One&Only Le Saint Géran',
    overall_rating:           9.1,
    location_score:           9.3,
    amenity_score:            9.0,
    brand_score:              9.2,
    value_score:              7.0,
    review_count:            1020,
    avg_rating:               4.78,
    avg_nightly_rate:        1650,
    affiliate_commission_rate: 0.09,
    star_rating:              5,
    region:                  'Belle Mare',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   true,
      fine_dining:      true,
      private_pool:     true,
      overwater_villa:  false,
      pool:             true,
      gym:              true,
      concierge:        true,
      helicopter_transfer: true,
    },
  },
  {
    hotel_id:                'MQ003',
    hotel_name:              'Four Seasons Resort Mauritius at Anahita',
    overall_rating:           9.0,
    location_score:           8.9,
    amenity_score:            9.2,
    brand_score:              9.5,
    value_score:              7.1,
    review_count:            1180,
    avg_rating:               4.77,
    avg_nightly_rate:        1800,
    affiliate_commission_rate: 0.07,
    star_rating:              5,
    region:                  'Beau Champ',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   true,
      fine_dining:      true,
      private_pool:     true,
      overwater_villa:  true,
      pool:             true,
      gym:              true,
      concierge:        true,
      golf:             true,
    },
  },
  {
    hotel_id:                'MQ004',
    hotel_name:              'Shangri-La Le Touessrok Resort & Spa',
    overall_rating:           8.8,
    location_score:           9.0,
    amenity_score:            8.8,
    brand_score:              8.9,
    value_score:              7.5,
    review_count:             890,
    avg_rating:               4.72,
    avg_nightly_rate:        1100,
    affiliate_commission_rate: 0.08,
    star_rating:              5,
    region:                  'Trou d\'Eau Douce',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   true,
      fine_dining:      true,
      private_pool:     true,
      overwater_villa:  false,
      pool:             true,
      gym:              true,
      concierge:        true,
      water_sports:     true,
    },
  },
  {
    hotel_id:                'MQ005',
    hotel_name:              'Constance Belle Mare Plage',
    overall_rating:           8.7,
    location_score:           9.1,
    amenity_score:            8.6,
    brand_score:              8.3,
    value_score:              7.8,
    review_count:             760,
    avg_rating:               4.68,
    avg_nightly_rate:         890,
    affiliate_commission_rate: 0.07,
    star_rating:              5,
    region:                  'Belle Mare',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   false,
      fine_dining:      true,
      private_pool:     false,
      pool:             true,
      gym:              true,
      concierge:        true,
      golf:             true,
      water_sports:     true,
    },
  },
  {
    hotel_id:                'MQ006',
    hotel_name:              'Paradis Beachcomber Golf Resort & Spa',
    overall_rating:           8.6,
    location_score:           9.2,
    amenity_score:            8.5,
    brand_score:              8.1,
    value_score:              8.0,
    review_count:             710,
    avg_rating:               4.65,
    avg_nightly_rate:         820,
    affiliate_commission_rate: 0.08,
    star_rating:              5,
    region:                  'Le Morne',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   false,
      fine_dining:      true,
      private_pool:     false,
      pool:             true,
      gym:              true,
      concierge:        true,
      golf:             true,
    },
  },
  {
    hotel_id:                'MQ007',
    hotel_name:              'Heritage Le Telfair Golf & Wellness Resort',
    overall_rating:           8.4,
    location_score:           8.4,
    amenity_score:            8.6,
    brand_score:              7.8,
    value_score:              8.4,
    review_count:             580,
    avg_rating:               4.60,
    avg_nightly_rate:         750,
    affiliate_commission_rate: 0.07,
    star_rating:              5,
    region:                  'Bel Ombre',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   false,
      fine_dining:      true,
      private_pool:     false,
      pool:             true,
      gym:              true,
      concierge:        true,
      golf:             true,
      yoga:             true,
    },
  },
  {
    hotel_id:                'MQ008',
    hotel_name:              'Dinarobin Beachcomber Golf Resort & Spa',
    overall_rating:           8.3,
    location_score:           8.8,
    amenity_score:            8.3,
    brand_score:              8.0,
    value_score:              8.2,
    review_count:             510,
    avg_rating:               4.58,
    avg_nightly_rate:         720,
    affiliate_commission_rate: 0.08,
    star_rating:              5,
    region:                  'Le Morne',
    property_type:           'resort',
    amenities: {
      spa:              true,
      private_beach:    true,
      butler_service:   false,
      fine_dining:      true,
      private_pool:     false,
      pool:             true,
      gym:              true,
      concierge:        true,
      golf:             true,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// AFFILIATE LINKS  (keyed by hotel_id)
// ─────────────────────────────────────────────────────────────────────────────

const AFFILIATE_LINKS = {
  MQ001: { booking_url: 'https://mauritiusresortfinder.com/r/MQ001', provider: 'Booking.com',  commission_tier: 'premium'  },
  MQ002: { booking_url: 'https://mauritiusresortfinder.com/r/MQ002', provider: 'Booking.com',  commission_tier: 'premium'  },
  MQ003: { booking_url: 'https://mauritiusresortfinder.com/r/MQ003', provider: 'Expedia',      commission_tier: 'premium'  },
  MQ004: { booking_url: 'https://mauritiusresortfinder.com/r/MQ004', provider: 'Hotels.com',   commission_tier: 'standard' },
  MQ005: { booking_url: 'https://mauritiusresortfinder.com/r/MQ005', provider: 'Booking.com',  commission_tier: 'standard' },
  MQ006: { booking_url: 'https://mauritiusresortfinder.com/r/MQ006', provider: 'Expedia',      commission_tier: 'standard' },
  MQ007: { booking_url: 'https://mauritiusresortfinder.com/r/MQ007', provider: 'Hotels.com',   commission_tier: 'standard' },
  MQ008: { booking_url: 'https://mauritiusresortfinder.com/r/MQ008', provider: 'Booking.com',  commission_tier: 'standard' },
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE CONTEXT TEMPLATES (per persona)
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_CONTEXT_MAP = {
  luxury: {
    page_type:      'ranking',
    persona:        'luxury',
    title:          'Best Luxury Hotels in Mauritius 2024',
    target_keyword: 'luxury hotels mauritius',
    slug:           'best-luxury-hotels-mauritius',
  },
  honeymoon: {
    page_type:      'ranking',
    persona:        'honeymoon',
    title:          'Best Honeymoon Hotels in Mauritius 2024',
    target_keyword: 'honeymoon hotels mauritius',
    slug:           'best-honeymoon-hotels-mauritius',
  },
  family: {
    page_type:      'ranking',
    persona:        'family',
    title:          'Best Family Hotels in Mauritius 2024',
    target_keyword: 'family hotels mauritius',
    slug:           'best-family-hotels-mauritius',
  },
  wellness: {
    page_type:      'ranking',
    persona:        'wellness',
    title:          'Best Wellness Resorts in Mauritius 2024',
    target_keyword: 'wellness resorts mauritius',
    slug:           'best-wellness-resorts-mauritius',
  },
  remote_work: {
    page_type:      'ranking',
    persona:        'remote_work',
    title:          'Best Hotels for Remote Work in Mauritius 2024',
    target_keyword: 'remote work hotels mauritius',
    slug:           'best-remote-work-hotels-mauritius',
  },
  value_luxury: {
    page_type:      'ranking',
    persona:        'value_luxury',
    title:          'Best Value Luxury Hotels in Mauritius 2024',
    target_keyword: 'value luxury hotels mauritius',
    slug:           'best-value-luxury-hotels-mauritius',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: ScoredHotel → Engine-Compatible Hotel
//
// scoring_engine input uses 0–10 scale for dimension fields.
// explanation_engine expects hotel.score_breakdown with 0–100 scale values.
// block_assembler requires hotel.rank and hotel.score_breakdown.
//
// Dimension key mapping:
//   scoring_engine.dimension_scores.overall_rating → score_breakdown.overall_score
//   scoring_engine.dimension_scores.{rest}         → score_breakdown.{same key}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a ScoredHotel (scoring_engine output) to the hotel format expected
 * by explanation_engine and block_assembler.
 *
 * @param  {Object} scoredHotel — ScoredHotel record from rankHotels()
 * @returns {Object} engine-compatible hotel record
 */
function adaptScoredHotel(scoredHotel) {
  const raw   = scoredHotel.hotel;          // original hotel record
  const ds    = scoredHotel.dimension_scores; // 0–10 scale

  // Map to 0–100 scale for explanation_engine phrase lookups
  const score_breakdown = {
    overall_score:  _roundTo(ds.overall_rating * 10, 2),
    location_score: _roundTo(ds.location_score * 10, 2),
    amenity_score:  _roundTo(ds.amenity_score  * 10, 2),
    brand_score:    _roundTo(ds.brand_score    * 10, 2),
    value_score:    _roundTo(ds.value_score    * 10, 2),
  };

  return {
    // Identity
    hotel_id:          raw.hotel_id,
    hotel_name:        raw.hotel_name,

    // Ranking (set by scoring_engine)
    rank:              scoredHotel.rank,

    // Score breakdown (0–100) required by explanation_engine
    score_breakdown,

    // Scoring metadata (for audit trail)
    scores:            scoredHotel.scores,
    tier:              scoredHotel.tier,
    completeness_percent: scoredHotel.completeness_percent,
    commission_adjusted:  scoredHotel.commission_adjusted,

    // Optional fields used by explanation_engine for phrase generation
    review_count:      raw.review_count,
    avg_rating:        raw.avg_rating,
    avg_nightly_rate:  raw.avg_nightly_rate  || null,
    amenities:         raw.amenities         || {},
    star_rating:       raw.star_rating       || null,
    region:            raw.region            || null,
    property_type:     raw.property_type     || null,
  };
}

function _roundTo(n, dp) {
  const factor = Math.pow(10, dp);
  return Math.round(n * factor) / factor;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE STAGES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 1: Load dataset.
 * Returns the static hotel array. In production this would fetch from a DB/API.
 */
function stage1_loadDataset() {
  log('[1/7] Loading hotel dataset');
  if (!Array.isArray(HOTEL_DATASET) || HOTEL_DATASET.length === 0) {
    fatal('Dataset is empty or invalid');
  }
  log(`      ${HOTEL_DATASET.length} hotels loaded`);
  return HOTEL_DATASET;
}

/**
 * Stage 2: Run scoring engine.
 * Scores and ranks all hotels for the given persona.
 * Fails loudly if fewer than 1 hotel qualifies.
 *
 * @param  {Array}  hotels
 * @param  {string} persona
 * @returns {{ rankingResult, rankedHotels }}
 */
function stage2_runScoring(hotels, persona) {
  log(`[2/7] Running scoring engine (persona: ${persona})`);

  const rankingResult = scoringEngine.rankHotels(hotels, persona, { includeExcluded: true });
  const rankedHotels  = rankingResult.ranked_hotels;

  log(`      Input:    ${rankingResult.summary.total_input} hotels`);
  log(`      Scored:   ${rankingResult.summary.total_scored}`);
  log(`      Excluded: ${rankingResult.summary.total_excluded}`);
  log(`      Insufficient data: ${rankingResult.summary.total_insufficient}`);
  log(`      Invalid:  ${rankingResult.summary.total_invalid}`);

  if (rankedHotels.length === 0) {
    fatal(`No hotels qualified for persona "${persona}". Adjust dataset or persona.`);
  }

  log(`      → ${rankedHotels.length} hotels ranked`);
  rankedHotels.forEach(h =>
    log(`        #${h.rank}  ${h.hotel_name}  (score: ${h.scores.final_ranking_score.toFixed(2)})`)
  );

  return { rankingResult, rankedHotels };
}

/**
 * Stage 3: Adapt scored hotels to engine-compatible format.
 * Bridges scoring_engine output → explanation_engine / block_assembler input.
 *
 * @param  {Array} rankedHotels — ScoredHotel[]
 * @returns {Array} engineHotels
 */
function stage3_adaptHotels(rankedHotels) {
  log('[3/7] Adapting scored hotels for explanation engine');
  const engineHotels = rankedHotels.map(adaptScoredHotel);
  log(`      → ${engineHotels.length} hotels adapted`);
  return engineHotels;
}

/**
 * Stage 4: Run explanation engine.
 * Generates one ExplanationObject per hotel. All must include exactly 1 weakness.
 *
 * @param  {Array}  engineHotels
 * @param  {string} persona
 * @returns {Array} explanationObjects
 */
function stage4_runExplanations(engineHotels, persona) {
  log(`[4/7] Running explanation engine (${engineHotels.length} hotels)`);

  const explanationObjects = explanationEngine.explainBatch(engineHotels, persona);

  log(`      → ${explanationObjects.length} ExplanationObjects generated`);

  // Sanity: every explanation must be present
  if (explanationObjects.length !== engineHotels.length) {
    fatal(
      `Explanation count mismatch: expected ${engineHotels.length}, got ${explanationObjects.length}`
    );
  }

  explanationObjects.forEach((exp, i) => {
    log(`        #${i + 1}  ${exp.hotel_name}  ` +
        `strengths=${exp.strengths.length}  weaknesses=${exp.weaknesses.length}  ` +
        `confidence=${exp.confidence_level}`);
  });

  return explanationObjects;
}

/**
 * Stage 5: Run block assembler.
 * Converts ranked hotels + ExplanationObjects + page context → ordered blocks.
 *
 * @param  {Array}  engineHotels
 * @param  {Array}  explanationObjects
 * @param  {Object} pageContext
 * @param  {Object} affiliateLinks
 * @returns {Object} assemblyResult
 */
function stage5_runAssembly(engineHotels, explanationObjects, pageContext, affiliateLinks) {
  log('[5/7] Running block assembler');

  const assemblyResult = blockAssembler.assemble(
    engineHotels,
    explanationObjects,
    pageContext,
    affiliateLinks,
    null, // no comparison data for ranking pages
  );

  const summary = assemblyResult.assembly_summary;
  log(`      Total blocks:     ${summary.total_blocks}`);
  log(`      Final trust depth: ${summary.final_trust_depth}`);
  log(`      Dropped CTAs:     ${summary.dropped_ctas}`);
  log(`      Hotel count:      ${summary.hotel_count}`);

  return assemblyResult;
}

/**
 * Stage 6: Run quality gates.
 * Checks all structural and content invariants. Returns a detailed QA report.
 * Fails loudly on any CRITICAL failure.
 *
 * Quality gates:
 *   [QG-01] Every explanation contains at least one weakness
 *   [QG-02] No CTA block appears before trust threshold (≥6)
 *   [QG-03] No unsupported claims (all supporting_claims passed validation)
 *   [QG-04] All affiliate CTAs include affiliate_disclosure: true
 *   [QG-05] No affiliate CTAs include fabricated_urgency: true
 *   [QG-06] No missing required fields in ExplanationObjects
 *   [QG-07] No missing required block types in assembly
 *   [QG-08] Block positions are sequential and 1-based
 *   [QG-09] Trust scores are non-decreasing across committed blocks
 *   [QG-10] All ranked hotels have a corresponding ExplanationObject
 *
 * @param  {Array}  engineHotels
 * @param  {Array}  explanationObjects
 * @param  {Object} assemblyResult
 * @returns {Object} qaReport
 */
function stage6_runQualityGates(engineHotels, explanationObjects, assemblyResult) {
  log('[6/7] Running quality gates');

  const gates   = [];
  const blocks  = assemblyResult.blocks;
  const summary = assemblyResult.assembly_summary;
  let   criticalFailures = 0;

  function gate(id, description, severity, pass, detail = null) {
    const result = { gate_id: id, description, severity, pass, detail: detail || null };
    gates.push(result);
    const icon = pass ? '✓' : (severity === 'CRITICAL' ? '✗' : '⚠');
    if (!pass && severity === 'CRITICAL') criticalFailures++;
    log(`      [${id}] ${icon}  ${description}${detail ? ': ' + detail : ''}`);
    return result;
  }

  // ── QG-01: Every explanation has exactly 1 weakness ──────────────────────
  const weaknessViolations = explanationObjects
    .filter(exp => !exp.weaknesses || exp.weaknesses.length !== 1)
    .map(exp => `${exp.hotel_id} (weaknesses=${exp.weaknesses ? exp.weaknesses.length : 'null'})`);
  gate('QG-01', 'Every explanation contains exactly 1 weakness', 'CRITICAL',
    weaknessViolations.length === 0,
    weaknessViolations.length > 0 ? `Violations: ${weaknessViolations.join(', ')}` : null);

  // ── QG-02: No CTA before trust threshold ────────────────────────────────
  const ctaBlocks = blocks.filter(b => b.block_type === 'affiliate_cta');
  const prematureCTAs = ctaBlocks.filter(b => b.trust_score < blockAssembler.CTA_MIN_TRUST_DEPTH);
  gate('QG-02', `No CTA block before trust depth ≥ ${blockAssembler.CTA_MIN_TRUST_DEPTH}`, 'CRITICAL',
    prematureCTAs.length === 0,
    prematureCTAs.length > 0
      ? `Premature CTAs at trust: ${prematureCTAs.map(b => b.trust_score).join(', ')}`
      : null);

  // ── QG-03: No unsupported claims ─────────────────────────────────────────
  const claimViolations = [];
  for (const exp of explanationObjects) {
    const unsupported = (exp.supporting_claims || []).filter(c => c.validation_result === 'fail');
    if (unsupported.length > 0) {
      claimViolations.push(`${exp.hotel_id}: ${unsupported.length} unsupported claim(s)`);
    }
  }
  gate('QG-03', 'No unsupported claims in ExplanationObjects', 'CRITICAL',
    claimViolations.length === 0,
    claimViolations.length > 0 ? claimViolations.join('; ') : null);

  // ── QG-04: All CTAs have affiliate_disclosure: true ──────────────────────
  const missingDisclosure = ctaBlocks.filter(
    b => !b.payload || b.payload.affiliate_disclosure !== true
  );
  gate('QG-04', 'All affiliate CTAs include affiliate_disclosure: true', 'CRITICAL',
    missingDisclosure.length === 0,
    missingDisclosure.length > 0
      ? `Violations: ${missingDisclosure.map(b => b.block_id).join(', ')}`
      : null);

  // ── QG-05: No CTAs have fabricated_urgency: true ─────────────────────────
  const fabricatedUrgency = ctaBlocks.filter(
    b => b.payload && b.payload.fabricated_urgency === true
  );
  gate('QG-05', 'No affiliate CTA includes fabricated_urgency: true', 'CRITICAL',
    fabricatedUrgency.length === 0,
    fabricatedUrgency.length > 0
      ? `Violations: ${fabricatedUrgency.map(b => b.block_id).join(', ')}`
      : null);

  // ── QG-06: No missing required fields in ExplanationObjects ──────────────
  const REQUIRED_EXP_FIELDS = [
    'hotel_id', 'hotel_name', 'persona', 'rank', 'explanation_summary',
    'strengths', 'weaknesses', 'traveler_fit', 'confidence_level',
    'supporting_claims', 'suppressed_claims', 'validation_summary',
    'explanation_version', 'generated_at',
  ];
  const missingFieldViolations = [];
  for (const exp of explanationObjects) {
    const missing = REQUIRED_EXP_FIELDS.filter(f => exp[f] === undefined || exp[f] === null);
    if (missing.length > 0) {
      missingFieldViolations.push(`${exp.hotel_id}: missing [${missing.join(', ')}]`);
    }
  }
  gate('QG-06', 'No missing required fields in ExplanationObjects', 'CRITICAL',
    missingFieldViolations.length === 0,
    missingFieldViolations.length > 0 ? missingFieldViolations.join('; ') : null);

  // ── QG-07: All required block types present in assembly ──────────────────
  const presentTypes    = new Set(blocks.map(b => b.block_type));
  const requiredTypes   = blockAssembler.REQUIRED_BLOCK_TYPES;
  const missingTypes    = requiredTypes.filter(t => !presentTypes.has(t));
  gate('QG-07', 'All required block types present in assembly', 'CRITICAL',
    missingTypes.length === 0,
    missingTypes.length > 0 ? `Missing: ${missingTypes.join(', ')}` : null);

  // ── QG-08: Block positions are sequential and 1-based ────────────────────
  const positionErrors = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].position !== i + 1) {
      positionErrors.push(`block[${i}].position = ${blocks[i].position}, expected ${i + 1}`);
    }
  }
  gate('QG-08', 'Block positions are sequential and 1-based', 'CRITICAL',
    positionErrors.length === 0,
    positionErrors.length > 0 ? positionErrors.slice(0, 3).join('; ') : null);

  // ── QG-09: Trust scores are non-decreasing ───────────────────────────────
  const trustErrors = [];
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].trust_score < blocks[i - 1].trust_score) {
      trustErrors.push(
        `block[${i}] trust ${blocks[i].trust_score} < block[${i-1}] trust ${blocks[i-1].trust_score}`
      );
    }
  }
  gate('QG-09', 'Trust scores are non-decreasing across committed blocks', 'CRITICAL',
    trustErrors.length === 0,
    trustErrors.length > 0 ? trustErrors.slice(0, 3).join('; ') : null);

  // ── QG-10: Every ranked hotel has an ExplanationObject ───────────────────
  const expIds      = new Set(explanationObjects.map(e => e.hotel_id));
  const missingExps = engineHotels.filter(h => !expIds.has(h.hotel_id)).map(h => h.hotel_id);
  gate('QG-10', 'Every ranked hotel has a corresponding ExplanationObject', 'WARNING',
    missingExps.length === 0,
    missingExps.length > 0 ? `Missing: ${missingExps.join(', ')}` : null);

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed  = gates.filter(g => g.pass).length;
  const failed  = gates.length - passed;
  const criticals = gates.filter(g => !g.pass && g.severity === 'CRITICAL').length;
  const warnings  = gates.filter(g => !g.pass && g.severity === 'WARNING').length;

  log(`      Passed: ${passed}/${gates.length}  (critical failures: ${criticals}, warnings: ${warnings})`);

  if (criticalFailures > 0) {
    fatal(
      `${criticalFailures} critical quality gate(s) failed. ` +
      `See qa_report.json for details.`
    );
  }

  const qaReport = {
    harness_version: HARNESS_VERSION,
    generated_at:    new Date().toISOString(),
    gates,
    summary: {
      total_gates:       gates.length,
      passed:            passed,
      failed:            failed,
      critical_failures: criticals,
      warnings:          warnings,
      overall_pass:      criticals === 0,
    },
  };

  return qaReport;
}

/**
 * Stage 7: Export artifacts.
 * Writes 5 JSON files to the output directory.
 *
 * Artifacts:
 *   rankings.json      — full RankingResult from scoring_engine
 *   explanations.json  — ExplanationObject[] from explanation_engine
 *   blocks.json        — committed Block[] from block_assembler
 *   page.json          — full AssemblyResult from block_assembler
 *   qa_report.json     — QA gate results
 *
 * @param  {Object} artifacts
 * @param  {string} outDir
 */
function stage7_exportArtifacts(artifacts, outDir) {
  log(`[7/7] Exporting artifacts to: ${outDir}`);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const files = {
    'rankings.json':     artifacts.rankingResult,
    'explanations.json': artifacts.explanationObjects,
    'blocks.json':       artifacts.assemblyResult.blocks,
    'page.json':         artifacts.assemblyResult,
    'qa_report.json':    artifacts.qaReport,
  };

  for (const [filename, data] of Object.entries(files)) {
    const filePath = path.join(outDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    const bytes = fs.statSync(filePath).size;
    log(`      ✓ ${filename}  (${_formatBytes(bytes)})`);
  }

  log(`      → All 5 artifacts exported successfully`);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(msg + '\n');
}

function fatal(msg) {
  process.stderr.write(`\n[FATAL] ${msg}\n\n`);
  process.exit(1);
}

function _formatBytes(bytes) {
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _banner(title) {
  const line = '─'.repeat(64);
  log('');
  log(line);
  log(`  ${title}`);
  log(line);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const { persona, outDir } = parseArgs();

  _banner(`Mauritius Resort Finder — Integration Harness v${HARNESS_VERSION}`);
  log(`  Persona:  ${persona}`);
  log(`  Output:   ${outDir}`);
  log(`  Started:  ${new Date().toISOString()}`);
  log('');

  const pageContext = PAGE_CONTEXT_MAP[persona];
  if (!pageContext) {
    fatal(
      `No page context defined for persona "${persona}". ` +
      `Valid: ${Object.keys(PAGE_CONTEXT_MAP).join(', ')}`
    );
  }

  const t0 = Date.now();

  // ── Pipeline ──────────────────────────────────────────────────────────────
  const hotels                         = stage1_loadDataset();
  const { rankingResult, rankedHotels } = stage2_runScoring(hotels, persona);
  const engineHotels                   = stage3_adaptHotels(rankedHotels);
  const explanationObjects             = stage4_runExplanations(engineHotels, persona);
  const assemblyResult                 = stage5_runAssembly(
    engineHotels, explanationObjects, pageContext, AFFILIATE_LINKS
  );
  const qaReport                       = stage6_runQualityGates(
    engineHotels, explanationObjects, assemblyResult
  );
  stage7_exportArtifacts(
    { rankingResult, explanationObjects, assemblyResult, qaReport },
    outDir
  );

  const elapsed = Date.now() - t0;
  _banner('Pipeline Complete');
  log(`  Hotels ranked:        ${rankedHotels.length}`);
  log(`  Explanations generated: ${explanationObjects.length}`);
  log(`  Blocks assembled:     ${assemblyResult.assembly_summary.total_blocks}`);
  log(`  Trust depth (final):  ${assemblyResult.assembly_summary.final_trust_depth}`);
  log(`  CTAs committed:       ${assemblyResult.blocks.filter(b => b.block_type === 'affiliate_cta').length}`);
  log(`  CTAs dropped:         ${assemblyResult.assembly_summary.dropped_ctas}`);
  log(`  QA gates passed:      ${qaReport.summary.passed}/${qaReport.summary.total_gates}`);
  log(`  Elapsed:              ${elapsed} ms`);
  log('');
  log('  ✓ All quality gates passed. Artifacts ready for rendering layer.');
  log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS  (for programmatic use and testing)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  adaptScoredHotel,
  stage1_loadDataset,
  stage2_runScoring,
  stage3_adaptHotels,
  stage4_runExplanations,
  stage5_runAssembly,
  stage6_runQualityGates,
  stage7_exportArtifacts,
  HOTEL_DATASET,
  AFFILIATE_LINKS,
  PAGE_CONTEXT_MAP,
  HARNESS_VERSION,
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}
