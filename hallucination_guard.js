/**
 * hallucination_guard.js
 * Mauritius Resort Finder — Explanation Engine, Module 2 of 4
 * Version: 1.0.0
 *
 * Publishability gate. Validates every candidate PhraseResult against source
 * hotel data before it is eligible for rendering. Accepts a PhraseResult from
 * phrase_library.js and a bound HotelRecord; returns a ValidationResult.
 *
 * Architecture position: Layer 3 — Explanation Engine (post-phrase-selection).
 * Upstream:   phrase_library.js  (produces PhraseResult objects)
 * Downstream: explanation_engine.js  (only renders valid, non-suppressed results)
 * Peer:       confidence_enforcer.js (runs on validated claims only; not this module)
 *
 * Validation pipeline (short-circuiting, deterministic, ordered):
 *   [1] Field Presence Validation      — required fields exist; source field resolves
 *   [2] Boolean Consistency Validation — boolean claims match actual flag values
 *   [3] Review Confidence Validation   — claim strength appropriate to review volume
 *   [4] Value Consistency Validation   — numeric/comparative claims match source data
 *   [5] Prohibited Pattern Validation  — forbidden language in rendered text
 *
 * Short-circuit rule: first failing stage suppresses the claim immediately.
 * All subsequent stages are skipped and marked as such in the audit_log.
 *
 * Design invariants:
 *   - Stateless. Pure functions only. No side effects. No mutations of input.
 *   - NEVER modifies claim content. NEVER generates replacement text.
 *   - NEVER repairs a failing claim — only suppresses it.
 *   - Deterministic: same input always produces identical output.
 *   - Always returns a complete ValidationResult regardless of outcome.
 *   - An already-suppressed PhraseResult short-circuits immediately at entry.
 *
 * Responsibility boundary:
 *   This module decides: PUBLISH or SUPPRESS.
 *   Confidence calibration (softening language) is confidence_enforcer.js's job.
 *   Phrase selection appropriateness is explanation_engine.js's job.
 *   This module only validates what was generated — it does not judge fit.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

const GUARD_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION STAGE IDENTIFIERS
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = Object.freeze({
  PRE_SUPPRESSED:       'pre_suppressed',
  FIELD_PRESENCE:       'field_presence',
  BOOLEAN_CONSISTENCY:  'boolean_consistency',
  REVIEW_CONFIDENCE:    'review_confidence',
  VALUE_CONSISTENCY:    'value_consistency',
  PROHIBITED_PATTERNS:  'prohibited_patterns',
  PASSED:               'passed',
});

const STAGE_ORDER = Object.freeze([
  STAGES.FIELD_PRESENCE,
  STAGES.BOOLEAN_CONSISTENCY,
  STAGES.REVIEW_CONFIDENCE,
  STAGES.VALUE_CONSISTENCY,
  STAGES.PROHIBITED_PATTERNS,
]);

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW CONFIDENCE THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
//
// These thresholds define minimum review volumes for different claim strengths.
// Derived from the Bayesian confidence model in scoring_engine.js:
//   BAYESIAN_C = 50 (prior confidence threshold)
//   High-confidence comparative claims require 4× this minimum.
//
// ─────────────────────────────────────────────────────────────────────────────

const REVIEW_THRESHOLDS = Object.freeze({
  /**
   * Absolute floor. Below this: the prior dominates entirely.
   * ANY review-derived claim is suppressed.
   */
  ANY_CLAIM:             10,

  /**
   * Minimum for a numeric avg_rating claim (e.g. "4.7/5").
   * Below this: the Bayesian adjustment is too large to quote the raw rating.
   * Matches BAYESIAN_C from scoring_engine.js.
   */
  NUMERIC_RATING:        50,

  /**
   * Minimum for comparative superiority claims about review record
   * (e.g. "ranks among the strongest review records").
   * Below this: insufficient volume to support a comparative standing claim.
   */
  COMPARATIVE_STANDING: 200,
});

// ─────────────────────────────────────────────────────────────────────────────
// VALUE CONSISTENCY TOLERANCES
// ─────────────────────────────────────────────────────────────────────────────
//
// Detect stale data: PhraseResult.injected_values are compared to the
// current HotelRecord values. If they have drifted beyond tolerance, the
// phrase was generated from outdated data and must be suppressed.
//
// ─────────────────────────────────────────────────────────────────────────────

const VALUE_TOLERANCES = Object.freeze({
  /**
   * Maximum acceptable drift for 0–5 scale rating fields (e.g. avg_rating).
   * A drift of 0.1 on a 5-point scale ≈ 2% — tight enough to catch stale data.
   */
  RATING_FIELD:  0.1,

  /**
   * Maximum acceptable drift for 0–100 scale score fields.
   * A drift of 1.0 on a 100-point scale is minimal noise tolerance.
   */
  SCORE_FIELD:   1.0,

  /**
   * Maximum acceptable drift for integer count fields (e.g. review_count).
   * Exact match required — counts are discrete values.
   */
  COUNT_FIELD:   0,
});

// ─────────────────────────────────────────────────────────────────────────────
// FIELD CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────
//
// Determines which tolerance applies to a given hotel field path.
// Unrecognised paths default to SCORE_FIELD tolerance.
//
// ─────────────────────────────────────────────────────────────────────────────

/** Field paths that use RATING_FIELD tolerance (0–5 scale). */
const RATING_FIELD_PATHS = new Set([
  'avg_rating',
]);

/** Field paths that use COUNT_FIELD tolerance (integer, exact). */
const COUNT_FIELD_PATHS = new Set([
  'review_count',
  'amenity_flags.restaurant_count',
  'amenity_flags.pool_count',
]);

/** Field path prefixes considered review-related for confidence gating. */
const REVIEW_RELATED_PATHS = new Set([
  'avg_rating',
  'review_count',
]);

// ─────────────────────────────────────────────────────────────────────────────
// PROHIBITED PATTERN REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiled once at module load. Each entry defines:
//   pattern_id  — unique identifier for audit trails
//   pattern     — compiled RegExp (case-insensitive)
//   reason      — human-readable suppression justification
//
// Design philosophy:
//   Patterns target UNVERIFIABLE ABSOLUTES and FABRICATED RANKINGS.
//   They do NOT target superlative language that is explicitly data-backed.
//
//   ALLOWED: "ranks among the strongest review records in this dataset"
//            (comparative, dataset-bounded, review_count supports it)
//   BLOCKED: "best resort in Mauritius"
//            (absolute ranking claim — no dataset backs this)
//
// ─────────────────────────────────────────────────────────────────────────────

const PROHIBITED_PATTERNS = Object.freeze([
  {
    pattern_id: 'PP_001',
    pattern:    /\bbest\s+(?:resort|hotel|spa|beach|property|destination)\s+in\b/i,
    reason:     'Absolute geographic ranking claim — no dataset supports a definitive "best in [place]" assertion',
  },
  {
    pattern_id: 'PP_002',
    pattern:    /\bworld[- ]class\b/i,
    reason:     'Global superlative — unverifiable against world-scale benchmarks',
  },
  {
    pattern_id: 'PP_003',
    pattern:    /\bunmatched\b/i,
    reason:     'Absolute comparative — implies exhaustive global comparison not supported by data',
  },
  {
    pattern_id: 'PP_004',
    pattern:    /\bunparalleled\b/i,
    reason:     'Absolute comparative — implies exhaustive global comparison not supported by data',
  },
  {
    pattern_id: 'PP_005',
    pattern:    /\bguaranteed\b/i,
    reason:     'Certainty claim — the system cannot guarantee experiential outcomes',
  },
  {
    pattern_id: 'PP_006',
    pattern:    /\bperfect\s+for\s+everyone\b/i,
    reason:     'Universal suitability claim — contradicts persona-based segmentation',
  },
  {
    pattern_id: 'PP_007',
    pattern:    /\bnever\s+(?:disappoint|disappoints|fail|fails)\b/i,
    reason:     'Absolute negative performance guarantee — unverifiable categorical claim',
  },
  {
    pattern_id: 'PP_008',
    pattern:    /\balways\s+(?:exceed|exceeds|deliver|delivers|surpass|surpasses)\b/i,
    reason:     'Absolute positive performance claim — unverifiable categorical claim',
  },
  {
    pattern_id: 'PP_009',
    pattern:    /\b(?:ranked?|rated?)\s+#\s*1\b/i,
    reason:     'External ranking fabrication — no third-party ranking is cited or verified',
  },
  {
    pattern_id: 'PP_010',
    pattern:    /\bnumber\s+one\s+(?:resort|hotel|destination|property)\b/i,
    reason:     'External ranking fabrication — no third-party ranking is cited or verified',
  },
  {
    pattern_id: 'PP_011',
    pattern:    /\blegendary\b/i,
    reason:     'Reputation claim without measurable evidence — not derivable from scored data',
  },
  {
    pattern_id: 'PP_012',
    pattern:    /\bsecond\s+to\s+none\b/i,
    reason:     'Absolute comparative — implies exhaustive global comparison not supported by data',
  },
  {
    pattern_id: 'PP_013',
    pattern:    /\bbeyond\s+compare\b/i,
    reason:     'Absolute comparative — implies exhaustive global comparison not supported by data',
  },
  {
    pattern_id: 'PP_014',
    pattern:    /\bflawless\b/i,
    reason:     'Absolute quality claim — no scored dimension returns a perfection indicator',
  },
  {
    pattern_id: 'PP_015',
    pattern:    /\bmost\s+(?:luxurious|prestigious|exclusive|sought-after)\b/i,
    reason:     'Superlative ranking without exhaustive comparative dataset',
  },
  {
    pattern_id: 'PP_016',
    pattern:    /\btop[- ]rated\s+(?:resort|hotel|spa|destination)\s+in\s+(?:mauritius|africa|the world|the region)\b/i,
    reason:     'External top-rated claim without citation of the rating source',
  },
  {
    pattern_id: 'PP_017',
    pattern:    /\bno\s+other\s+(?:resort|hotel|property)\b/i,
    reason:     'Exclusive claim implying exhaustive market comparison',
  },
  {
    pattern_id: 'PP_018',
    pattern:    /\bperfect\s+(?:weather|climate|conditions)\s+year[- ]round\b/i,
    reason:     'Meteorological absolute — climate data is not present in the scoring schema',
  },
  {
    pattern_id: 'PP_019',
    pattern:    /\bonly\s+(?:resort|hotel|property)\s+(?:in mauritius|on the island)\s+(?:with|that|to)\b/i,
    reason:     'Exclusivity claim — market completeness cannot be verified from this dataset',
  },
  {
    pattern_id: 'PP_020',
    pattern:    /\b(?:iconic|legendary)\s+(?:resort|hotel|destination|property|spa)\b/i,
    reason:     'Brand reputation claim without measurable evidence in scored dimensions',
  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// FIELD RESOLVER (shared utility)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a dot-notation field path against an object.
 * Returns undefined if any segment in the path is null/undefined.
 *
 * @param  {string}  path  — e.g. 'amenity_flags.beachfront'
 * @param  {Object}  obj
 * @returns {*}
 */
function _resolveField(path, obj) {
  if (!path || obj === null || obj === undefined) return undefined;
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, obj);
}

/**
 * Returns the tolerance to apply when comparing values at a given field path.
 *
 * @param  {string} fieldPath
 * @returns {number}
 */
function _getFieldTolerance(fieldPath) {
  if (RATING_FIELD_PATHS.has(fieldPath)) return VALUE_TOLERANCES.RATING_FIELD;
  if (COUNT_FIELD_PATHS.has(fieldPath))  return VALUE_TOLERANCES.COUNT_FIELD;
  return VALUE_TOLERANCES.SCORE_FIELD;
}

/**
 * Returns true if the two numeric values are within the given tolerance.
 *
 * @param  {number}  a
 * @param  {number}  b
 * @param  {number}  tolerance
 * @returns {boolean}
 */
function _withinTolerance(a, b, tolerance) {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return Math.abs(a - b) <= tolerance;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE RESULT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a standardised AuditEntry for the audit_log.
 *
 * @param  {string}   stage       — stage identifier from STAGES
 * @param  {number}   stage_id    — 1-based stage index
 * @param  {'passed'|'suppressed'|'skipped'} outcome
 * @param  {string|null} reason
 * @param  {string[]}    checks_run
 * @returns {Object} AuditEntry
 */
function _auditEntry(stage, stage_id, outcome, reason, checks_run) {
  return Object.freeze({
    stage,
    stage_id,
    outcome,
    reason:     reason || null,
    checks_run: Object.freeze(checks_run || []),
  });
}

/**
 * Creates a suppression StageResult.
 *
 * @param  {string}   stage
 * @param  {number}   stage_id
 * @param  {string}   reason
 * @param  {string[]} checks_run
 * @returns {{ suppressed: true, reason: string, audit: AuditEntry }}
 */
function _suppress(stage, stage_id, reason, checks_run) {
  return {
    suppressed: true,
    reason,
    audit: _auditEntry(stage, stage_id, 'suppressed', reason, checks_run),
  };
}

/**
 * Creates a passing StageResult.
 *
 * @param  {string}   stage
 * @param  {number}   stage_id
 * @param  {string[]} checks_run
 * @returns {{ suppressed: false, audit: AuditEntry }}
 */
function _pass(stage, stage_id, checks_run) {
  return {
    suppressed: false,
    audit: _auditEntry(stage, stage_id, 'passed', null, checks_run),
  };
}

/**
 * Creates a skipped StageResult (short-circuit).
 *
 * @param  {string} stage
 * @param  {number} stage_id
 * @returns {{ suppressed: false, audit: AuditEntry }}
 */
function _skip(stage, stage_id) {
  return {
    suppressed: false,
    audit: _auditEntry(stage, stage_id, 'skipped', 'Upstream stage suppressed — short-circuit', []),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1: FIELD PRESENCE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that all fields required for the claim exist and are non-null.
 *
 * Checks:
 *   1. phraseResult is a valid object with required keys
 *   2. rendered_text is a non-null, non-empty string
 *   3. claim_source_field resolves to a non-null value on the hotel
 *   4. The hotel record itself is a valid object
 *
 * @param  {Object} phraseResult
 * @param  {Object} hotel
 * @returns {{ suppressed: boolean, reason?: string, audit: Object }}
 */
function _validateFieldPresence(phraseResult, hotel) {
  const stage    = STAGES.FIELD_PRESENCE;
  const stage_id = 1;
  const checks   = [];

  // Guard: phraseResult must be a valid object
  checks.push('phraseResult_is_object');
  if (!phraseResult || typeof phraseResult !== 'object' || Array.isArray(phraseResult)) {
    return _suppress(stage, stage_id, 'phraseResult is not a plain object', checks);
  }

  // Guard: hotel must be a valid object
  checks.push('hotel_is_object');
  if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)) {
    return _suppress(stage, stage_id, 'Hotel record is not a plain object', checks);
  }

  // rendered_text must be a non-null, non-empty string
  checks.push('rendered_text_non_null');
  if (phraseResult.rendered_text === null || phraseResult.rendered_text === undefined) {
    return _suppress(stage, stage_id, 'rendered_text is null — phrase was conditionally suppressed at template execution', checks);
  }

  checks.push('rendered_text_is_string');
  if (typeof phraseResult.rendered_text !== 'string' || phraseResult.rendered_text.trim() === '') {
    return _suppress(stage, stage_id, 'rendered_text is not a non-empty string', checks);
  }

  // phrase_id must exist
  checks.push('phrase_id_present');
  if (!phraseResult.phrase_id || typeof phraseResult.phrase_id !== 'string') {
    return _suppress(stage, stage_id, 'phrase_id is missing or invalid', checks);
  }

  // claim_source_field check (only for phrases that produce claims)
  checks.push('claim_source_field_check');
  if (phraseResult.produces_claim === true) {
    if (!phraseResult.claim_source_field || typeof phraseResult.claim_source_field !== 'string') {
      return _suppress(
        stage, stage_id,
        `produces_claim=true but claim_source_field is absent or invalid`,
        checks,
      );
    }

    checks.push('claim_source_field_resolves_on_hotel');
    const sourceValue = _resolveField(phraseResult.claim_source_field, hotel);
    if (sourceValue === undefined || sourceValue === null) {
      return _suppress(
        stage, stage_id,
        `claim_source_field "${phraseResult.claim_source_field}" resolves to null/undefined on hotel record`,
        checks,
      );
    }
  }

  return _pass(stage, stage_id, checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2: BOOLEAN CONSISTENCY VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates boolean claims against actual flag values on the hotel.
 *
 * A boolean claim is only valid when the claim_source_field on the hotel
 * is strictly === true. Any other value (false, null, undefined, 0, '') suppresses.
 *
 * Non-boolean claims pass this stage unconditionally.
 * Non-producing phrases (produces_claim: false) pass unconditionally.
 *
 * @param  {Object} phraseResult
 * @param  {Object} hotel
 * @returns {{ suppressed: boolean, reason?: string, audit: Object }}
 */
function _validateBooleanConsistency(phraseResult, hotel) {
  const stage    = STAGES.BOOLEAN_CONSISTENCY;
  const stage_id = 2;
  const checks   = [];

  // Non-claim phrases skip this stage
  checks.push('is_boolean_claim');
  if (!phraseResult.produces_claim || phraseResult.claim_type !== 'boolean') {
    return _pass(stage, stage_id, checks);
  }

  // Resolve the source flag on hotel
  checks.push('resolve_source_field');
  const flagValue = _resolveField(phraseResult.claim_source_field, hotel);

  checks.push('source_field_is_strictly_true');
  if (flagValue !== true) {
    return _suppress(
      stage, stage_id,
      `Boolean claim source "${phraseResult.claim_source_field}" is ${JSON.stringify(flagValue)} — must be strictly true to publish`,
      checks,
    );
  }

  return _pass(stage, stage_id, checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3: REVIEW CONFIDENCE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that the claim's strength is appropriate for the hotel's review volume.
 *
 * Rules (evaluated in order):
 *   - review_count < ANY_CLAIM (10):         suppress all review-derived claims
 *   - review_count < NUMERIC_RATING (50):    suppress numeric avg_rating claims
 *   - review_count < COMPARATIVE_STANDING (200): suppress comparative standing claims
 *                                            about the hotel's review record
 *
 * A claim is "review-derived" if:
 *   - claim_source_field is in REVIEW_RELATED_PATHS, OR
 *   - injected_values contains 'avg_rating' or 'review_count'
 *
 * A claim is a "comparative standing" claim if:
 *   - claim_type === 'comparative' AND the claim is review-derived
 *
 * @param  {Object} phraseResult
 * @param  {Object} hotel
 * @returns {{ suppressed: boolean, reason?: string, audit: Object }}
 */
function _validateReviewConfidence(phraseResult, hotel) {
  const stage    = STAGES.REVIEW_CONFIDENCE;
  const stage_id = 3;
  const checks   = [];

  // Determine if this phrase is review-derived
  checks.push('is_review_derived_check');
  const isReviewSourceField = REVIEW_RELATED_PATHS.has(phraseResult.claim_source_field || '');
  const injected = phraseResult.injected_values || {};
  const hasInjectedRating = 'avg_rating'    in injected;
  const hasInjectedCount  = 'review_count'  in injected;
  const isReviewDerived   = isReviewSourceField || hasInjectedRating || hasInjectedCount;

  // Non-review phrases pass unconditionally
  if (!isReviewDerived) {
    return _pass(stage, stage_id, checks);
  }

  // Resolve review_count from hotel
  checks.push('resolve_review_count');
  const reviewCount = hotel.review_count;
  if (reviewCount === null || reviewCount === undefined) {
    return _suppress(
      stage, stage_id,
      `Review-derived claim requires hotel.review_count but it is absent`,
      checks,
    );
  }

  const count = typeof reviewCount === 'number' ? Math.floor(reviewCount) : 0;

  // Rule 1: below the absolute floor — suppress any review claim
  checks.push(`review_count_vs_ANY_CLAIM(${REVIEW_THRESHOLDS.ANY_CLAIM})`);
  if (count < REVIEW_THRESHOLDS.ANY_CLAIM) {
    return _suppress(
      stage, stage_id,
      `review_count ${count} is below the absolute floor of ${REVIEW_THRESHOLDS.ANY_CLAIM} — Bayesian prior completely dominates; no review-derived claim is publishable`,
      checks,
    );
  }

  // Rule 2: numeric avg_rating claim — requires NUMERIC_RATING threshold
  checks.push(`review_count_vs_NUMERIC_RATING(${REVIEW_THRESHOLDS.NUMERIC_RATING})`);
  const isNumericRating = phraseResult.claim_type === 'numeric' && isReviewSourceField;
  if (isNumericRating && count < REVIEW_THRESHOLDS.NUMERIC_RATING) {
    return _suppress(
      stage, stage_id,
      `Numeric avg_rating claim requires ≥${REVIEW_THRESHOLDS.NUMERIC_RATING} reviews (Bayesian_C threshold); got ${count}`,
      checks,
    );
  }

  // Rule 3: comparative standing claim about review record — requires COMPARATIVE_STANDING
  checks.push(`review_count_vs_COMPARATIVE_STANDING(${REVIEW_THRESHOLDS.COMPARATIVE_STANDING})`);
  const isComparativeReview = phraseResult.claim_type === 'comparative' && isReviewDerived;
  if (isComparativeReview && count < REVIEW_THRESHOLDS.COMPARATIVE_STANDING) {
    return _suppress(
      stage, stage_id,
      `Comparative review standing claim requires ≥${REVIEW_THRESHOLDS.COMPARATIVE_STANDING} reviews; got ${count} — insufficient volume for a relative superiority assertion`,
      checks,
    );
  }

  return _pass(stage, stage_id, checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4: VALUE CONSISTENCY VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects stale or inconsistent numeric/comparative claims.
 *
 * Checks performed:
 *   1. Injected value freshness: for each path in injected_values where a
 *      non-null numeric value was captured at phrase execution, verify the
 *      current hotel value is within tolerance. Drift beyond tolerance = stale data.
 *
 *   2. Claim source consistency (numeric claims): the claim_source_field current
 *      value must remain within tolerance of the injected value at render time.
 *
 *   3. Comparative direction alignment: for comparative claims, if the source
 *      field is a 0–100 score, the current value must be within ±15 of the
 *      injected value — detecting band-crossing stale data (e.g. a strength
 *      phrase generated when score=88, now score=42).
 *
 * Boolean and descriptive claims are not subject to numeric drift checks.
 *
 * @param  {Object} phraseResult
 * @param  {Object} hotel
 * @returns {{ suppressed: boolean, reason?: string, audit: Object }}
 */
function _validateValueConsistency(phraseResult, hotel) {
  const stage    = STAGES.VALUE_CONSISTENCY;
  const stage_id = 4;
  const checks   = [];

  // Boolean claims handled in Stage 2; descriptive claims have no numeric drift
  checks.push('claim_type_applicable');
  if (!phraseResult.produces_claim ||
      phraseResult.claim_type === 'boolean' ||
      phraseResult.claim_type === 'descriptive') {
    return _pass(stage, stage_id, checks);
  }

  const injected = phraseResult.injected_values || {};

  // ── Check 1: injected value freshness for numeric fields ──────────────────
  checks.push('injected_value_freshness');
  for (const [fieldPath, injectedValue] of Object.entries(injected)) {
    // Only check numeric injected values
    if (typeof injectedValue !== 'number' || isNaN(injectedValue)) continue;

    // For comparative claims, the claim_source_field is validated separately
    // in Check 2 with a wider 15-point band-crossing window. Applying the
    // narrow SCORE_FIELD tolerance here would produce false positives on
    // legitimate data drift that is still within the 15-point window.
    if (phraseResult.claim_type === 'comparative' &&
        fieldPath === phraseResult.claim_source_field) {
      continue;
    }

    const currentValue = _resolveField(fieldPath, hotel);
    if (currentValue === undefined || currentValue === null) {
      // Field was present at phrase execution but is now missing — stale data
      return _suppress(
        stage, stage_id,
        `Injected field "${fieldPath}" was ${injectedValue} at phrase execution but is now absent from hotel record`,
        checks,
      );
    }

    if (typeof currentValue !== 'number') continue; // type changed — skip numeric check

    const tolerance = _getFieldTolerance(fieldPath);
    if (!_withinTolerance(injectedValue, currentValue, tolerance)) {
      return _suppress(
        stage, stage_id,
        `Data staleness detected: field "${fieldPath}" was ${injectedValue} at phrase execution, now ${currentValue} (drift: ${Math.abs(injectedValue - currentValue).toFixed(4)}, tolerance: ${tolerance})`,
        checks,
      );
    }
  }

  // ── Check 2: comparative claim source — band-crossing detection ───────────
  checks.push('comparative_source_alignment');
  if (phraseResult.claim_type === 'comparative' && phraseResult.claim_source_field) {
    const injectedSourceValue = injected[phraseResult.claim_source_field];
    const currentSourceValue  = _resolveField(phraseResult.claim_source_field, hotel);

    if (typeof injectedSourceValue === 'number' && typeof currentSourceValue === 'number') {
      // For 0–100 scale score fields: suppress if drift exceeds 15 points (>1 full tier)
      const isScoreField = !RATING_FIELD_PATHS.has(phraseResult.claim_source_field) &&
                           !COUNT_FIELD_PATHS.has(phraseResult.claim_source_field);
      if (isScoreField) {
        const drift = Math.abs(injectedSourceValue - currentSourceValue);
        if (drift > 15) {
          return _suppress(
            stage, stage_id,
            `Comparative claim source "${phraseResult.claim_source_field}" has drifted ${drift.toFixed(1)} points ` +
            `(was ${injectedSourceValue}, now ${currentSourceValue}) — phrase may no longer reflect current data tier`,
            checks,
          );
        }
      }
    }
  }

  return _pass(stage, stage_id, checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5: PROHIBITED PATTERN VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans rendered_text for forbidden language patterns.
 *
 * Any match against PROHIBITED_PATTERNS suppresses the entire phrase.
 * The guard reports which pattern matched for audit purposes.
 *
 * Note: The phrase_library should never produce these patterns by design.
 * This stage exists as a hard safety net for:
 *   - Future phrase authors who violate constraints
 *   - Dynamic text assembly in the explanation_engine
 *   - Any injection vector that produces rendered text
 *
 * @param  {Object} phraseResult
 * @returns {{ suppressed: boolean, reason?: string, audit: Object }}
 */
function _validateProhibitedPatterns(phraseResult) {
  const stage    = STAGES.PROHIBITED_PATTERNS;
  const stage_id = 5;
  const checks   = [];

  checks.push('scan_rendered_text');
  const text = phraseResult.rendered_text;

  for (const { pattern_id, pattern, reason } of PROHIBITED_PATTERNS) {
    checks.push(`check_${pattern_id}`);
    if (pattern.test(text)) {
      return _suppress(
        stage, stage_id,
        `Prohibited pattern ${pattern_id} matched: ${reason}`,
        checks,
      );
    }
  }

  return _pass(stage, stage_id, checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION RESULT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles the final ValidationResult.
 *
 * @param  {boolean}     valid
 * @param  {boolean}     suppressed
 * @param  {string|null} suppression_reason
 * @param  {string}      validator_stage
 * @param  {Object[]}    audit_log
 * @param  {Object|null} phraseResult        — original input (null when suppressed)
 * @returns {Object} ValidationResult
 */
function _buildResult(valid, suppressed, suppression_reason, validator_stage, audit_log, phraseResult) {
  return Object.freeze({
    valid,
    suppressed,
    suppression_reason: suppression_reason || null,
    validator_stage,
    audit_log:        Object.freeze(audit_log),
    validated_claim:  suppressed ? null : phraseResult,
    guard_version:    GUARD_VERSION,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATION PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a single PhraseResult against the hotel record.
 *
 * Pipeline is short-circuiting: first failing stage suppresses the claim
 * and all subsequent stages are recorded as 'skipped'.
 *
 * Already-suppressed PhraseResults (phraseResult.suppressed === true) are
 * returned immediately without running any validators. Their suppression
 * reason from phrase_library is preserved.
 *
 * @param  {Object} phraseResult — from phrase_library.execute()
 * @param  {Object} hotel        — bound HotelRecord
 * @returns {Object} ValidationResult
 */
function validate(phraseResult, hotel) {
  const audit_log = [];

  // ── Pre-suppression short-circuit ─────────────────────────────────────────
  // If phrase_library already suppressed this phrase, respect that decision.
  if (phraseResult && phraseResult.suppressed === true) {
    audit_log.push(_auditEntry(
      STAGES.PRE_SUPPRESSED, 0, 'suppressed',
      `Phrase was already suppressed by phrase_library: ${phraseResult.suppression_reason}`,
      ['pre_suppression_check'],
    ));
    return _buildResult(
      false, true,
      `Pre-suppressed: ${phraseResult.suppression_reason}`,
      STAGES.PRE_SUPPRESSED,
      audit_log,
      null,
    );
  }

  // ── Run pipeline ──────────────────────────────────────────────────────────
  const validators = [
    () => _validateFieldPresence(phraseResult, hotel),
    () => _validateBooleanConsistency(phraseResult, hotel),
    () => _validateReviewConfidence(phraseResult, hotel),
    () => _validateValueConsistency(phraseResult, hotel),
    () => _validateProhibitedPatterns(phraseResult),
  ];

  let failedStage    = null;
  let failureReason  = null;
  let failedStageName = null;

  for (let i = 0; i < validators.length; i++) {
    if (failedStage !== null) {
      // Short-circuit: upstream stage suppressed — skip remaining stages
      audit_log.push(_skip(STAGE_ORDER[i], i + 1).audit);
      continue;
    }

    const result = validators[i]();
    audit_log.push(result.audit);

    if (result.suppressed) {
      failedStage     = i;
      failureReason   = result.reason;
      failedStageName = STAGE_ORDER[i];
    }
  }

  // ── Assemble result ───────────────────────────────────────────────────────
  if (failedStage !== null) {
    return _buildResult(
      false, true, failureReason, failedStageName, audit_log, null,
    );
  }

  return _buildResult(
    true, false, null, STAGES.PASSED, audit_log, phraseResult,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates an array of PhraseResults against a single hotel record.
 *
 * Each PhraseResult is validated independently — one suppression does not
 * affect others. Returns a parallel array of ValidationResult objects.
 *
 * @param  {Object[]} phraseResults
 * @param  {Object}   hotel
 * @returns {Object[]} array of ValidationResult (same length as input)
 */
function validateBatch(phraseResults, hotel) {
  if (!Array.isArray(phraseResults)) {
    throw new TypeError('validateBatch: first argument must be an array');
  }
  return phraseResults.map(pr => validate(pr, hotel));
}

// ─────────────────────────────────────────────────────────────────────────────
// INTROSPECTION UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns summary statistics for a batch of ValidationResults.
 * Useful for audit reporting in explanation_engine.js.
 *
 * @param  {Object[]} validationResults
 * @returns {{
 *   total: number,
 *   valid: number,
 *   suppressed: number,
 *   suppression_by_stage: Object,
 *   guard_version: string,
 * }}
 */
function summariseBatch(validationResults) {
  if (!Array.isArray(validationResults)) {
    throw new TypeError('summariseBatch: first argument must be an array');
  }

  const suppressionByStage = {};
  let validCount = 0;
  let suppressedCount = 0;

  for (const result of validationResults) {
    if (result.suppressed) {
      suppressedCount++;
      const stage = result.validator_stage || 'unknown';
      suppressionByStage[stage] = (suppressionByStage[stage] || 0) + 1;
    } else {
      validCount++;
    }
  }

  return {
    total:                validationResults.length,
    valid:                validCount,
    suppressed:           suppressedCount,
    suppression_by_stage: suppressionByStage,
    guard_version:        GUARD_VERSION,
  };
}

/**
 * Returns a snapshot of the prohibited pattern registry.
 * Used for audit trails and downstream configuration visibility.
 *
 * @returns {{ count: number, patterns: Array<{ pattern_id, reason }> }}
 */
function getProhibitedPatternRegistry() {
  return {
    count:    PROHIBITED_PATTERNS.length,
    patterns: PROHIBITED_PATTERNS.map(({ pattern_id, reason }) => ({ pattern_id, reason })),
  };
}

/**
 * Returns the current review thresholds configuration.
 *
 * @returns {Object}
 */
function getReviewThresholds() {
  return { ...REVIEW_THRESHOLDS };
}

/**
 * Returns the current value tolerance configuration.
 *
 * @returns {Object}
 */
function getValueTolerances() {
  return { ...VALUE_TOLERANCES };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Primary API ────────────────────────────────────────────────────────────
  validate,
  validateBatch,

  // ── Introspection / audit ──────────────────────────────────────────────────
  summariseBatch,
  getProhibitedPatternRegistry,
  getReviewThresholds,
  getValueTolerances,

  // ── Individual validators (exported for unit testing) ─────────────────────
  _validateFieldPresence,
  _validateBooleanConsistency,
  _validateReviewConfidence,
  _validateValueConsistency,
  _validateProhibitedPatterns,

  // ── Utilities (exported for unit testing) ─────────────────────────────────
  _resolveField,
  _getFieldTolerance,
  _withinTolerance,

  // ── Constants ──────────────────────────────────────────────────────────────
  GUARD_VERSION,
  STAGES,
  STAGE_ORDER,
  REVIEW_THRESHOLDS,
  VALUE_TOLERANCES,
  PROHIBITED_PATTERNS,
};
