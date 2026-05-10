/**
 * confidence_enforcer.js
 * Mauritius Resort Finder — Explanation Engine, Module 3 of 4
 * Version: 1.0.0
 *
 * Certainty calibration layer. Decides HOW STRONGLY the system speaks —
 * not WHAT it says. Receives a validated claim (from hallucination_guard)
 * and applies linguistic certainty modifiers based on evidence quality.
 *
 * Architecture position: Layer 4 — Confidence Calibration (post-validation).
 * Upstream:   hallucination_guard.js  (validated, publishable claims only)
 * Downstream: explanation_engine.js   (final text assembly)
 * Peer:       phrase_library.js        (produced the original claim text)
 *
 * Enforcement pipeline (deterministic, stateless, ordered):
 *   [1] Input validation      — guard against malformed input
 *   [2] Matrix lookup         — resolve confidence_level × claim_strength → action
 *   [3] Suppression check     — suppress if evidence quality < claim strength
 *   [4] Direct assertion      — pass through unchanged when confidence = high
 *   [5] Idempotency check     — skip if text already contains hedge language
 *   [6] Hedge application     — prepend prefix + connector to claim text
 *
 * Design invariants:
 *   - Stateless. Pure functions only. No side effects. No mutations of input.
 *   - NEVER modifies factual content. NEVER injects new facts.
 *   - NEVER strips existing hedges (modification = forbidden).
 *   - NEVER converts an unsupported strong claim into vague marketing language.
 *   - Deterministic: same input always produces identical output.
 *   - Idempotent: re-applying to already-hedged text has no additional effect.
 *   - Always returns a complete EnforcementResult regardless of outcome.
 *
 * Responsibility boundary:
 *   This module decides: direct | hedge | suppress.
 *   Truth validation is hallucination_guard.js's job.
 *   Phrase selection is explanation_engine.js's job.
 *   This module only calibrates certainty expression.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

const ENFORCER_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// VALID DIMENSION VALUES
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low', 'insufficient']);
const CLAIM_STRENGTHS   = Object.freeze(['weak', 'moderate', 'strong']);

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW COUNT → CONFIDENCE LEVEL THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
//
// Aligned with hallucination_guard.js REVIEW_THRESHOLDS for cross-module
// consistency:
//   ANY_CLAIM = 10, NUMERIC_RATING = 50, COMPARATIVE_STANDING = 200
//
// These values define the boundaries for deriveConfidenceLevel(review_count).
//
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_REVIEW_THRESHOLDS = Object.freeze({
  INSUFFICIENT:  10,   // review_count < 10   → insufficient
  LOW:           50,   // review_count < 50   → low
  MEDIUM:       200,   // review_count < 200  → medium
  //              ≥200                        → high
});

// ─────────────────────────────────────────────────────────────────────────────
// SCORE → CLAIM STRENGTH THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
//
// Used by deriveClaimStrength(claim_type, score) for numeric/comparative claims.
//
// ─────────────────────────────────────────────────────────────────────────────

const CLAIM_STRENGTH_SCORE_THRESHOLDS = Object.freeze({
  STRONG:   80,   // score ≥ 80  → strong
  MODERATE: 60,   // score ≥ 60  → moderate
  //         < 60              → weak
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPRESS SENTINEL
// ─────────────────────────────────────────────────────────────────────────────

const SUPPRESS_SENTINEL = '__suppress__';

// ─────────────────────────────────────────────────────────────────────────────
// HEDGE MATRIX
// ─────────────────────────────────────────────────────────────────────────────
//
// Deterministic 2D lookup: confidence_level × claim_strength → action
//
// Each cell resolves to one of:
//   'HP_NONE'        — direct assertion; full confidence, no modification
//   '__suppress__'   — claim strength exceeds evidence quality; suppress entirely
//   'HP_*'           — apply named hedge pattern from the registry
//
// Design rationale:
//   Claim certainty must not exceed evidence certainty. As evidence quality
//   falls (confidence_level decreases), the acceptable claim strength ceiling
//   falls proportionally. A strong claim at low confidence is suppressed;
//   the same claim at high confidence is published without modification.
//
// Matrix layout:
//
//                  WEAK             MODERATE           STRONG
//   HIGH         HP_NONE           HP_NONE            HP_NONE
//   MEDIUM       HP_NONE           HP_SOFT_001        HP_SOFT_002
//   LOW          HP_LIGHT_001      HP_TENTATIVE_001   __suppress__
//   INSUFFICIENT __suppress__      __suppress__       __suppress__
//
// ─────────────────────────────────────────────────────────────────────────────

const HEDGE_MATRIX = Object.freeze({
  high: Object.freeze({
    weak:     'HP_NONE',
    moderate: 'HP_NONE',
    strong:   'HP_NONE',
  }),
  medium: Object.freeze({
    weak:     'HP_NONE',
    moderate: 'HP_SOFT_001',
    strong:   'HP_SOFT_002',
  }),
  low: Object.freeze({
    weak:     'HP_LIGHT_001',
    moderate: 'HP_TENTATIVE_001',
    strong:   SUPPRESS_SENTINEL,
  }),
  insufficient: Object.freeze({
    weak:     SUPPRESS_SENTINEL,
    moderate: SUPPRESS_SENTINEL,
    strong:   SUPPRESS_SENTINEL,
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// HEDGE PATTERN REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// Each entry defines a named hedge pattern referenced by HEDGE_MATRIX cells.
//
// Schema per entry:
//   pattern_id         — unique identifier (matches matrix cell values)
//   behavior           — category: 'none' | 'soft' | 'tentative' | 'light'
//   prefix             — text prepended to the claim body
//   connector          — joins prefix to claim body (e.g. ' that ', ' — ', ' ')
//   join_mode          — assembly rule applied in _joinHedge():
//                         'direct'    → return text unchanged (HP_NONE only)
//                         'preserve'  → prefix + connector + original text
//                         'lowercase' → prefix + connector + lowercased-first(text)
//   description        — rationale and appropriate use case
//   detection_patterns — compiled RegExp array for idempotency detection.
//                        If any pattern fires on the claim text, the text is
//                        considered already hedged; no additional hedge is added.
//
// Linguistic design constraints:
//   GOOD prefix: "Guests frequently note" — observational, volume-implied
//   BAD prefix:  "might possibly perhaps" — stacked uncertainty, robotic
//   GOOD prefix: "Reviews suggest"         — evidential, calibrated
//   BAD prefix:  "This hotel might seem"   — vague marketing language
//
// ─────────────────────────────────────────────────────────────────────────────

const HEDGE_PATTERNS = Object.freeze([

  // ── HP_NONE ─ Direct assertion (no hedge) ──────────────────────────────────
  Object.freeze({
    pattern_id:  'HP_NONE',
    behavior:    'none',
    prefix:      '',
    connector:   '',
    join_mode:   'direct',
    description: 'Direct assertion — full evidence quality supports the claim at this ' +
                 'strength. No linguistic modification applied.',
    detection_patterns: Object.freeze([]),
  }),

  // ── HP_SOFT_001 ─ Soft hedge (medium confidence + moderate claim) ──────────
  //
  // Signals consistent guest-reported evidence without citing a specific count.
  // Tone: analytical and volume-backed without claiming exhaustive certainty.
  //
  Object.freeze({
    pattern_id:  'HP_SOFT_001',
    behavior:    'soft',
    prefix:      'Guests frequently note',
    connector:   ' that ',
    join_mode:   'lowercase',
    description: 'Soft hedge — volume-backed observational framing for moderate claims ' +
                 'at medium confidence. Implies consistent guest consensus without ' +
                 'asserting statistical certainty.',
    detection_patterns: Object.freeze([
      /^guests\s+frequently\s+note/i,
      /^guests\s+often\s+note/i,
      /^guests\s+commonly\s+note/i,
      /^guests\s+frequently\s+highlight/i,
    ]),
  }),

  // ── HP_SOFT_002 ─ Soft hedge, consistency framing (medium + strong) ─────────
  //
  // For strong claims that have moderate evidence. Frames the claim as
  // an observed pattern rather than a guaranteed absolute.
  //
  Object.freeze({
    pattern_id:  'HP_SOFT_002',
    behavior:    'soft',
    prefix:      'Consistently observed across this review set',
    connector:   ' — ',
    join_mode:   'preserve',
    description: 'Soft hedge — consistency framing for strong claims at medium confidence. ' +
                 'Acknowledges the claim is data-backed while scoping to observed review ' +
                 'evidence rather than asserting universal truth.',
    detection_patterns: Object.freeze([
      /^consistently\s+observed\s+across/i,
      /^consistently\s+noted\s+across\s+this\s+review/i,
    ]),
  }),

  // ── HP_TENTATIVE_001 ─ Tentative hedge (low confidence + moderate claim) ────
  //
  // Review signal is thin. The claim can still be published but must be
  // framed as a pattern inferred from limited data, not a strong assertion.
  //
  Object.freeze({
    pattern_id:  'HP_TENTATIVE_001',
    behavior:    'tentative',
    prefix:      'Reviews suggest',
    connector:   ' that ',
    join_mode:   'lowercase',
    description: 'Tentative hedge — review signal framing for moderate claims at low ' +
                 'confidence. Frames the observation as a pattern from limited review ' +
                 'data without asserting high certainty.',
    detection_patterns: Object.freeze([
      /^reviews?\s+suggest\s+that/i,
      /^review\s+data\s+suggests/i,
      /^reviews?\s+indicate\s+that/i,
    ]),
  }),

  // ── HP_LIGHT_001 ─ Light hedge (low confidence + weak claim) ─────────────────
  //
  // Evidence floor is low. Weak claim can survive but requires explicit
  // data-availability qualification so the reader understands the basis.
  //
  Object.freeze({
    pattern_id:  'HP_LIGHT_001',
    behavior:    'light',
    prefix:      'Based on current data,',
    connector:   ' ',
    join_mode:   'preserve',
    description: 'Light hedge — data availability qualification for weak claims at low ' +
                 'confidence. Signals that the observation is derived from limited evidence ' +
                 'without entirely undermining the factual assertion.',
    detection_patterns: Object.freeze([
      /^based\s+on\s+current\s+data/i,
      /^based\s+on\s+available\s+data/i,
      /^based\s+on\s+limited\s+data/i,
    ]),
  }),

]);

// Pattern lookup index for O(1) access by pattern_id
const HEDGE_PATTERN_INDEX = Object.freeze(
  Object.fromEntries(HEDGE_PATTERNS.map(p => [p.pattern_id, p]))
);

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL HEDGE INDICATORS
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiled RegExp patterns that detect hedge language NOT covered by the
// registered pattern detection_patterns. These catch:
//   - Hedge language from phrase_library templates
//   - Future pattern additions not yet in the registry
//   - Dynamic text from explanation_engine assembly
//
// Checked in _alreadyHedged() after registered pattern detection.
// This ensures idempotency even for unregistered hedge forms.
//
// ─────────────────────────────────────────────────────────────────────────────

const GENERAL_HEDGE_INDICATORS = Object.freeze([
  /^(?:many|most|some|several|numerous|various)\s+guests?/i,
  /^(?:reviews?|feedback|guest\s+data)\s+(?:suggest|indicate|show|highlight)/i,
  /^based\s+on\s+(?:available|limited|current|the\s+available)/i,
  /^available\s+(?:data|evidence|review\s+data|feedback)/i,
  /^early\s+indicators?\s+suggest/i,
  /^(?:it\s+appears|it\s+seems|there\s+are\s+indications)/i,
  /^according\s+to\s+(?:reviews?|available)/i,
  /^(?:initial|preliminary)\s+(?:data|evidence|review)/i,
  /^data\s+(?:suggests?|indicates?)\s+that/i,
  /^(?:where|when)\s+(?:data|evidence)\s+is\s+(?:available|sufficient)/i,
]);

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the HEDGE_MATRIX cell for a given confidence_level and claim_strength.
 * Returns the action string: 'HP_NONE', '__suppress__', or a hedge pattern_id.
 * Throws TypeError for unrecognised dimension values.
 *
 * @param  {string} confidence_level
 * @param  {string} claim_strength
 * @returns {string}
 */
function _lookupMatrix(confidence_level, claim_strength) {
  if (!CONFIDENCE_LEVELS.includes(confidence_level)) {
    throw new TypeError(
      `_lookupMatrix: unknown confidence_level "${confidence_level}". ` +
      `Valid values: ${CONFIDENCE_LEVELS.join(', ')}`
    );
  }
  if (!CLAIM_STRENGTHS.includes(claim_strength)) {
    throw new TypeError(
      `_lookupMatrix: unknown claim_strength "${claim_strength}". ` +
      `Valid values: ${CLAIM_STRENGTHS.join(', ')}`
    );
  }
  return HEDGE_MATRIX[confidence_level][claim_strength];
}

/**
 * Returns the HedgePattern entry for a given pattern_id, or null if absent.
 *
 * @param  {string} pattern_id
 * @returns {Object|null}
 */
function _findPattern(pattern_id) {
  return HEDGE_PATTERN_INDEX[pattern_id] || null;
}

/**
 * Returns true if the text already contains recognisable hedge language.
 * Prevents stacking multiple certainty modifiers on the same claim.
 *
 * Detection order:
 *   1. Registered detection_patterns from each HedgePattern entry
 *   2. General hedge indicators (broader catch-all)
 *
 * A hedge is detected only at the START of the text (trimmed). Mid-sentence
 * hedge words are not flagged — only leading hedge constructions are caught,
 * since that is where prepended hedge prefixes appear.
 *
 * @param  {string} text
 * @returns {boolean}
 */
function _alreadyHedged(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  for (const pattern of HEDGE_PATTERNS) {
    for (const detector of pattern.detection_patterns) {
      if (detector.test(trimmed)) return true;
    }
  }

  for (const indicator of GENERAL_HEDGE_INDICATORS) {
    if (indicator.test(trimmed)) return true;
  }

  return false;
}

/**
 * Lowercases the first character of a string, with two exceptions:
 *   - First character is not an uppercase ASCII letter → no change
 *   - First TWO characters are both uppercase (abbreviation: "OTA", "VAT") → no change
 *
 * Preserves numeric openers ("4.7/5..."), symbols, and abbreviations.
 *
 * @param  {string} text
 * @returns {string}
 */
function _lowercaseFirst(text) {
  if (!text || text.length === 0) return text;
  const first = text[0];
  if (!/[A-Z]/.test(first)) return text;                         // non-uppercase — preserve
  if (text.length > 1 && /[A-Z]/.test(text[1])) return text;   // abbreviation  — preserve
  return first.toLowerCase() + text.slice(1);
}

/**
 * Assembles the final hedged text from a pattern entry and the original text.
 *
 * Join modes:
 *   'direct'    — return originalText unchanged (HP_NONE pass-through)
 *   'preserve'  — prefix + connector + originalText (no case modification)
 *   'lowercase' — prefix + connector + lowercased-first(originalText)
 *
 * @param  {Object} patternEntry — a HedgePattern object from HEDGE_PATTERN_INDEX
 * @param  {string} originalText
 * @returns {string}
 */
function _joinHedge(patternEntry, originalText) {
  const { prefix, connector, join_mode } = patternEntry;

  if (join_mode === 'direct')    return originalText;
  if (join_mode === 'lowercase') return prefix + connector + _lowercaseFirst(originalText);
  return prefix + connector + originalText;  // 'preserve'
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT AND AUDIT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a frozen EnforcementResult.
 *
 * @param  {Object} fields
 * @returns {Object} EnforcementResult (frozen)
 */
function _buildResult({
  final_text,
  hedged,
  suppressed,
  suppression_reason,
  hedge_pattern,
  confidence_level,
  claim_strength,
  audit_log,
}) {
  return Object.freeze({
    final_text:         final_text !== undefined ? final_text : null,
    hedged:             hedged === true,
    suppressed:         suppressed === true,
    suppression_reason: suppression_reason || null,
    hedge_pattern:      hedge_pattern || null,
    confidence_level:   confidence_level || null,
    claim_strength:     claim_strength || null,
    enforcer_version:   ENFORCER_VERSION,
    audit_log:          Object.freeze(Array.isArray(audit_log) ? audit_log : []),
  });
}

/**
 * Assembles a frozen audit entry for appending to the audit_log.
 *
 * outcome values:
 *   'direct'        — HP_NONE; no modification
 *   'hedged'        — hedge pattern applied
 *   'suppressed'    — matrix suppression
 *   'idempotent'    — text already hedged; no action taken
 *   'invalid_input' — malformed input; suppressed defensively
 *
 * @param  {Object} fields
 * @returns {Object} AuditEntry (frozen)
 */
function _buildAuditEntry({
  outcome,
  resolved_pattern,
  already_hedged,
  confidence_level,
  claim_strength,
  reason,
}) {
  return Object.freeze({
    stage:            'confidence_enforcement',
    enforcer_version: ENFORCER_VERSION,
    confidence_level: confidence_level !== undefined ? confidence_level : null,
    claim_strength:   claim_strength   !== undefined ? claim_strength   : null,
    resolved_pattern: resolved_pattern || null,
    already_hedged:   already_hedged === true,
    outcome,
    reason:           reason || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENFORCEMENT PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies certainty calibration to a single validated claim.
 *
 * The pipeline is deterministic and short-circuiting: the first applicable
 * stage produces the result. No stage modifies the factual content of the
 * original claim; only the certainty framing may change.
 *
 * @param  {Object}   input
 * @param  {Object}   input.validated_claim   — PhraseResult from phrase_library
 * @param  {string}   input.confidence_level  — 'high'|'medium'|'low'|'insufficient'
 * @param  {string}   input.claim_strength    — 'weak'|'moderate'|'strong'
 * @param  {number}   [input.review_count]    — for audit context only
 * @param  {Object[]} [input.audit_log]       — upstream audit entries to extend
 * @returns {Object} EnforcementResult
 */
function enforce(input) {

  // ── Stage 1: Input validation ─────────────────────────────────────────────

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return _buildResult({
      final_text:         null,
      hedged:             false,
      suppressed:         true,
      suppression_reason: 'enforce() requires a plain object input',
      hedge_pattern:      null,
      confidence_level:   null,
      claim_strength:     null,
      audit_log: [_buildAuditEntry({
        outcome:          'invalid_input',
        resolved_pattern: null,
        already_hedged:   false,
        confidence_level: null,
        claim_strength:   null,
        reason:           'enforce() received non-object input',
      })],
    });
  }

  const {
    validated_claim,
    confidence_level,
    claim_strength,
    audit_log: upstreamAudit,
  } = input;

  const priorAudit = Array.isArray(upstreamAudit) ? upstreamAudit.slice() : [];

  // validated_claim must be a plain object
  if (!validated_claim || typeof validated_claim !== 'object' || Array.isArray(validated_claim)) {
    const entry = _buildAuditEntry({
      outcome:          'invalid_input',
      resolved_pattern: null,
      already_hedged:   false,
      confidence_level,
      claim_strength,
      reason:           'validated_claim is absent or not a plain object',
    });
    return _buildResult({
      final_text:         null,
      hedged:             false,
      suppressed:         true,
      suppression_reason: 'validated_claim is absent or not a plain object',
      hedge_pattern:      null,
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  // rendered_text must be a non-empty string
  const rendered_text = validated_claim.rendered_text;
  if (!rendered_text || typeof rendered_text !== 'string' || rendered_text.trim() === '') {
    const entry = _buildAuditEntry({
      outcome:          'invalid_input',
      resolved_pattern: null,
      already_hedged:   false,
      confidence_level,
      claim_strength,
      reason:           'validated_claim.rendered_text is absent, null, or empty',
    });
    return _buildResult({
      final_text:         null,
      hedged:             false,
      suppressed:         true,
      suppression_reason: 'validated_claim.rendered_text is absent, null, or empty',
      hedge_pattern:      null,
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  // confidence_level must be a recognised value
  if (!CONFIDENCE_LEVELS.includes(confidence_level)) {
    const entry = _buildAuditEntry({
      outcome:          'invalid_input',
      resolved_pattern: null,
      already_hedged:   false,
      confidence_level,
      claim_strength,
      reason:           `Unknown confidence_level: "${confidence_level}"`,
    });
    return _buildResult({
      final_text:         null,
      hedged:             false,
      suppressed:         true,
      suppression_reason: `Unknown confidence_level: "${confidence_level}"`,
      hedge_pattern:      null,
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  // claim_strength must be a recognised value
  if (!CLAIM_STRENGTHS.includes(claim_strength)) {
    const entry = _buildAuditEntry({
      outcome:          'invalid_input',
      resolved_pattern: null,
      already_hedged:   false,
      confidence_level,
      claim_strength,
      reason:           `Unknown claim_strength: "${claim_strength}"`,
    });
    return _buildResult({
      final_text:         null,
      hedged:             false,
      suppressed:         true,
      suppression_reason: `Unknown claim_strength: "${claim_strength}"`,
      hedge_pattern:      null,
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  // ── Stage 2: Matrix lookup ────────────────────────────────────────────────

  const patternId = _lookupMatrix(confidence_level, claim_strength);

  // ── Stage 3: Suppression check ────────────────────────────────────────────

  if (patternId === SUPPRESS_SENTINEL) {
    const reason =
      `HedgeMatrix suppression: confidence_level="${confidence_level}" + ` +
      `claim_strength="${claim_strength}" — claim strength exceeds evidence quality`;
    const entry = _buildAuditEntry({
      outcome:          'suppressed',
      resolved_pattern: SUPPRESS_SENTINEL,
      already_hedged:   false,
      confidence_level,
      claim_strength,
      reason,
    });
    return _buildResult({
      final_text:         null,
      hedged:             false,
      suppressed:         true,
      suppression_reason: reason,
      hedge_pattern:      null,
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  // ── Stage 4: Direct assertion (HP_NONE) ───────────────────────────────────

  if (patternId === 'HP_NONE') {
    const entry = _buildAuditEntry({
      outcome:          'direct',
      resolved_pattern: 'HP_NONE',
      already_hedged:   false,
      confidence_level,
      claim_strength,
      reason:           'Full confidence — direct assertion; no hedge required',
    });
    return _buildResult({
      final_text:         rendered_text,
      hedged:             false,
      suppressed:         false,
      suppression_reason: null,
      hedge_pattern:      null,
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  // ── Stage 5: Idempotency check ────────────────────────────────────────────
  //
  // If the text already starts with hedge language (from phrase_library or a
  // prior enforcement pass), do not stack an additional hedge. Return the
  // text unchanged with hedged=false to signal no new modification was made.
  //
  // The hedge_pattern field is set to the intended pattern (for audit context)
  // even though it was not applied.

  const alreadyHedgedFlag = _alreadyHedged(rendered_text);
  if (alreadyHedgedFlag) {
    const entry = _buildAuditEntry({
      outcome:          'idempotent',
      resolved_pattern: patternId,
      already_hedged:   true,
      confidence_level,
      claim_strength,
      reason:           `Text already contains hedge language — pattern "${patternId}" not re-applied`,
    });
    return _buildResult({
      final_text:         rendered_text,
      hedged:             false,
      suppressed:         false,
      suppression_reason: null,
      hedge_pattern:      patternId,    // intended pattern — useful for audit
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  // ── Stage 6: Hedge application ────────────────────────────────────────────

  const patternEntry = _findPattern(patternId);
  if (!patternEntry) {
    // Defensive: pattern_id is in the matrix but missing from the registry.
    // Fall through to direct assertion rather than crashing or producing noise.
    const entry = _buildAuditEntry({
      outcome:          'direct',
      resolved_pattern: patternId,
      already_hedged:   false,
      confidence_level,
      claim_strength,
      reason:           `Pattern "${patternId}" referenced in HedgeMatrix but absent from ` +
                        `registry — direct assertion fallback`,
    });
    return _buildResult({
      final_text:         rendered_text,
      hedged:             false,
      suppressed:         false,
      suppression_reason: null,
      hedge_pattern:      null,
      confidence_level,
      claim_strength,
      audit_log:          [...priorAudit, entry],
    });
  }

  const final_text = _joinHedge(patternEntry, rendered_text);
  const entry = _buildAuditEntry({
    outcome:          'hedged',
    resolved_pattern: patternId,
    already_hedged:   false,
    confidence_level,
    claim_strength,
    reason:           `Applied hedge pattern "${patternId}" (${patternEntry.behavior}): ` +
                      `prefix "${patternEntry.prefix}"`,
  });

  return _buildResult({
    final_text,
    hedged:             true,
    suppressed:         false,
    suppression_reason: null,
    hedge_pattern:      patternId,
    confidence_level,
    claim_strength,
    audit_log:          [...priorAudit, entry],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies confidence enforcement to an array of inputs independently.
 * One suppression does not affect others. Returns a parallel array of
 * EnforcementResult objects.
 *
 * @param  {Object[]} inputs
 * @returns {Object[]}
 */
function enforceBatch(inputs) {
  if (!Array.isArray(inputs)) {
    throw new TypeError('enforceBatch: first argument must be an array');
  }
  return inputs.map(input => enforce(input));
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: DERIVE CONFIDENCE LEVEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives a confidence_level string from a numeric review_count.
 * Calibrated to match hallucination_guard.js REVIEW_THRESHOLDS.
 *
 * Intended for use by explanation_engine.js before calling enforce().
 *
 * @param  {number} review_count
 * @returns {'high'|'medium'|'low'|'insufficient'}
 */
function deriveConfidenceLevel(review_count) {
  if (typeof review_count !== 'number' || isNaN(review_count) || review_count < 0) {
    return 'insufficient';
  }
  if (review_count < CONFIDENCE_REVIEW_THRESHOLDS.INSUFFICIENT) return 'insufficient';
  if (review_count < CONFIDENCE_REVIEW_THRESHOLDS.LOW)          return 'low';
  if (review_count < CONFIDENCE_REVIEW_THRESHOLDS.MEDIUM)       return 'medium';
  return 'high';
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: DERIVE CLAIM STRENGTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives a claim_strength string from a claim_type and optional score.
 * Intended as a utility for explanation_engine.js — not part of the
 * enforcement pipeline itself.
 *
 * Type rules:
 *   'boolean'     → always 'weak' (binary verified fact; no strength gradient)
 *   'descriptive' → always 'weak' (narrative; no scored assertion)
 *   'numeric'     → calibrated to score (requires score argument)
 *   'comparative' → calibrated to score (requires score argument)
 *   unknown       → 'weak' (conservative default)
 *
 * @param  {string}  claim_type
 * @param  {number}  [score]     — 0–100 scale
 * @returns {'strong'|'moderate'|'weak'}
 */
function deriveClaimStrength(claim_type, score) {
  // Boolean claims are binary verified facts (hallucination_guard Stage 2 already
  // confirmed the flag is true). Hedging "Beachfront confirmed" with "Guests
  // frequently note that..." is semantically incoherent. 'weak' routes
  // medium+weak → HP_NONE (direct assertion), which is the correct calibration.
  if (claim_type === 'boolean')     return 'weak';
  if (claim_type === 'descriptive') return 'weak';

  if (claim_type === 'numeric' || claim_type === 'comparative') {
    if (typeof score !== 'number' || isNaN(score)) return 'weak';
    if (score >= CLAIM_STRENGTH_SCORE_THRESHOLDS.STRONG)   return 'strong';
    if (score >= CLAIM_STRENGTH_SCORE_THRESHOLDS.MODERATE) return 'moderate';
    return 'weak';
  }

  return 'weak';  // unknown claim type — conservative default
}

// ─────────────────────────────────────────────────────────────────────────────
// INTROSPECTION
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the HedgeMatrix (frozen). */
function getHedgeMatrix() {
  return HEDGE_MATRIX;
}

/**
 * Returns a safe snapshot of the hedge pattern registry.
 * Compiled RegExp objects are not exposed; detection_pattern_count is
 * provided instead so callers can verify completeness without needing
 * to interact with regex internals.
 *
 * @returns {Object[]}
 */
function getHedgePatternRegistry() {
  return HEDGE_PATTERNS.map(p => Object.freeze({
    pattern_id:              p.pattern_id,
    behavior:                p.behavior,
    prefix:                  p.prefix,
    connector:               p.connector,
    join_mode:               p.join_mode,
    description:             p.description,
    detection_pattern_count: p.detection_patterns.length,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Primary API
  enforce,
  enforceBatch,

  // Utilities for explanation_engine.js
  deriveConfidenceLevel,
  deriveClaimStrength,

  // Introspection
  getHedgeMatrix,
  getHedgePatternRegistry,

  // Internal utilities — exported for testing only
  _lookupMatrix,
  _findPattern,
  _alreadyHedged,
  _lowercaseFirst,
  _joinHedge,

  // Constants
  ENFORCER_VERSION,
  CONFIDENCE_LEVELS,
  CLAIM_STRENGTHS,
  HEDGE_MATRIX,
  HEDGE_PATTERNS,
  CONFIDENCE_REVIEW_THRESHOLDS,
  CLAIM_STRENGTH_SCORE_THRESHOLDS,
  SUPPRESS_SENTINEL,
};
