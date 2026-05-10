/**
 * confidence_enforcer.test.js
 * Mauritius Resort Finder — ConfidenceEnforcer Test Suite
 *
 * Self-running. No test framework required.
 * Run: node confidence_enforcer.test.js
 *
 * Exit code 0 = all tests passed.
 * Exit code 1 = one or more failures.
 *
 * Coverage:
 *   - Module constants and configuration
 *   - HedgeMatrix completeness and correctness
 *   - _lookupMatrix() boundary conditions and error throwing
 *   - Hedge pattern registry integrity
 *   - _alreadyHedged() — registered patterns, general indicators, clean text
 *   - _lowercaseFirst() — abbreviation preservation, numeric openers
 *   - _joinHedge() — all three join modes
 *   - enforce() — suppression cases (4 cells: low+strong, insufficient+all)
 *   - enforce() — direct assertion cases (HP_NONE cells)
 *   - enforce() — hedge application cases (all 4 hedge patterns)
 *   - enforce() — idempotency (already-hedged text not re-hedged)
 *   - enforce() — input validation and edge cases
 *   - enforce() — audit log completeness and structure
 *   - enforceBatch() — parallel enforcement, independence
 *   - deriveConfidenceLevel() — all threshold boundaries
 *   - deriveClaimStrength() — all claim types and score boundaries
 *   - Integration: enforce() chained with deriveConfidenceLevel/deriveClaimStrength
 */

'use strict';

const {
  enforce,
  enforceBatch,
  deriveConfidenceLevel,
  deriveClaimStrength,
  getHedgeMatrix,
  getHedgePatternRegistry,
  _lookupMatrix,
  _findPattern,
  _alreadyHedged,
  _lowercaseFirst,
  _joinHedge,
  ENFORCER_VERSION,
  CONFIDENCE_LEVELS,
  CLAIM_STRENGTHS,
  HEDGE_MATRIX,
  HEDGE_PATTERNS,
  CONFIDENCE_REVIEW_THRESHOLDS,
  CLAIM_STRENGTH_SCORE_THRESHOLDS,
  SUPPRESS_SENTINEL,
} = require('./confidence_enforcer');

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

function assertThrows(fn, expectedFragment, message) {
  try {
    fn();
    failed++;
    failures.push(message);
    process.stdout.write(`  ✗ FAIL (no throw): ${message}\n`);
  } catch (e) {
    if (expectedFragment && !e.message.includes(expectedFragment)) {
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

/** Minimal valid PhraseResult (bound HotelRecord format, post-hallucination_guard). */
const VALIDATED_CLAIM = Object.freeze({
  phrase_id:          'OS_STR_90_GENERIC',
  rendered_text:      'Overall score 88/100 — consistently above segment median.',
  injected_values:    { 'score_breakdown.overall_score': 88.0 },
  suppressed:         false,
  suppression_reason: null,
  produces_claim:     true,
  claim_source_field: 'score_breakdown.overall_score',
  claim_type:         'numeric',
});

/** Builds a minimal valid enforce() input object. */
function buildInput(overrides = {}) {
  return {
    validated_claim:  VALIDATED_CLAIM,
    confidence_level: 'high',
    claim_strength:   'strong',
    review_count:     847,
    audit_log:        [],
    ...overrides,
  };
}

/** Builds a validated_claim with custom rendered_text. */
function claimWithText(text) {
  return { ...VALIDATED_CLAIM, rendered_text: text };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: MODULE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

section('1. Module constants and configuration');

assert(typeof ENFORCER_VERSION === 'string' && ENFORCER_VERSION.length > 0,
  'ENFORCER_VERSION is a non-empty string');

assert(Object.isFrozen(CONFIDENCE_LEVELS),
  'CONFIDENCE_LEVELS is frozen');

assert(CONFIDENCE_LEVELS.length === 4,
  'CONFIDENCE_LEVELS has exactly 4 entries');

assert(Object.isFrozen(CLAIM_STRENGTHS),
  'CLAIM_STRENGTHS is frozen');

assert(CLAIM_STRENGTHS.length === 3,
  'CLAIM_STRENGTHS has exactly 3 entries');

assert(Object.isFrozen(HEDGE_MATRIX),
  'HEDGE_MATRIX is frozen');

assert(Object.isFrozen(HEDGE_PATTERNS),
  'HEDGE_PATTERNS is frozen');

assert(typeof SUPPRESS_SENTINEL === 'string' && SUPPRESS_SENTINEL.length > 0,
  'SUPPRESS_SENTINEL is a non-empty string');

assert(Object.isFrozen(CONFIDENCE_REVIEW_THRESHOLDS),
  'CONFIDENCE_REVIEW_THRESHOLDS is frozen');

assert(
  CONFIDENCE_REVIEW_THRESHOLDS.INSUFFICIENT <
  CONFIDENCE_REVIEW_THRESHOLDS.LOW &&
  CONFIDENCE_REVIEW_THRESHOLDS.LOW <
  CONFIDENCE_REVIEW_THRESHOLDS.MEDIUM,
  'CONFIDENCE_REVIEW_THRESHOLDS are ordered: INSUFFICIENT < LOW < MEDIUM'
);

assert(Object.isFrozen(CLAIM_STRENGTH_SCORE_THRESHOLDS),
  'CLAIM_STRENGTH_SCORE_THRESHOLDS is frozen');

assert(
  CLAIM_STRENGTH_SCORE_THRESHOLDS.MODERATE <
  CLAIM_STRENGTH_SCORE_THRESHOLDS.STRONG,
  'CLAIM_STRENGTH_SCORE_THRESHOLDS: MODERATE < STRONG'
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: HEDGE MATRIX COMPLETENESS
// ─────────────────────────────────────────────────────────────────────────────

section('2. HedgeMatrix completeness');

// All 12 cells must be defined
{
  let defined = 0;
  for (const cl of CONFIDENCE_LEVELS) {
    for (const cs of CLAIM_STRENGTHS) {
      if (HEDGE_MATRIX[cl] && HEDGE_MATRIX[cl][cs] !== undefined) defined++;
    }
  }
  assert(defined === 12, 'All 12 matrix cells are defined');
}

// All non-sentinel cells reference a valid registered pattern_id
{
  const registeredIds = new Set(HEDGE_PATTERNS.map(p => p.pattern_id));
  let valid = true;
  for (const cl of CONFIDENCE_LEVELS) {
    for (const cs of CLAIM_STRENGTHS) {
      const cell = HEDGE_MATRIX[cl][cs];
      if (cell !== SUPPRESS_SENTINEL && !registeredIds.has(cell)) valid = false;
    }
  }
  assert(valid, 'All non-sentinel matrix cells reference a registered pattern_id');
}

// Specific cell values
assert(HEDGE_MATRIX.high.weak     === 'HP_NONE',          'high + weak     → HP_NONE');
assert(HEDGE_MATRIX.high.moderate === 'HP_NONE',          'high + moderate → HP_NONE');
assert(HEDGE_MATRIX.high.strong   === 'HP_NONE',          'high + strong   → HP_NONE');
assert(HEDGE_MATRIX.medium.weak   === 'HP_NONE',          'medium + weak   → HP_NONE');
assert(HEDGE_MATRIX.medium.moderate === 'HP_SOFT_001',    'medium + moderate → HP_SOFT_001');
assert(HEDGE_MATRIX.medium.strong   === 'HP_SOFT_002',    'medium + strong   → HP_SOFT_002');
assert(HEDGE_MATRIX.low.weak        === 'HP_LIGHT_001',   'low + weak        → HP_LIGHT_001');
assert(HEDGE_MATRIX.low.moderate    === 'HP_TENTATIVE_001', 'low + moderate  → HP_TENTATIVE_001');
assert(HEDGE_MATRIX.low.strong      === SUPPRESS_SENTINEL, 'low + strong    → suppress');
assert(HEDGE_MATRIX.insufficient.weak     === SUPPRESS_SENTINEL, 'insufficient + weak     → suppress');
assert(HEDGE_MATRIX.insufficient.moderate === SUPPRESS_SENTINEL, 'insufficient + moderate → suppress');
assert(HEDGE_MATRIX.insufficient.strong   === SUPPRESS_SENTINEL, 'insufficient + strong   → suppress');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: _lookupMatrix
// ─────────────────────────────────────────────────────────────────────────────

section('3. _lookupMatrix()');

assert(_lookupMatrix('high', 'strong')   === 'HP_NONE',          '_lookupMatrix: high + strong → HP_NONE');
assert(_lookupMatrix('high', 'moderate') === 'HP_NONE',          '_lookupMatrix: high + moderate → HP_NONE');
assert(_lookupMatrix('medium', 'moderate') === 'HP_SOFT_001',    '_lookupMatrix: medium + moderate → HP_SOFT_001');
assert(_lookupMatrix('medium', 'strong')   === 'HP_SOFT_002',    '_lookupMatrix: medium + strong → HP_SOFT_002');
assert(_lookupMatrix('low', 'weak')        === 'HP_LIGHT_001',   '_lookupMatrix: low + weak → HP_LIGHT_001');
assert(_lookupMatrix('low', 'moderate')    === 'HP_TENTATIVE_001', '_lookupMatrix: low + moderate → HP_TENTATIVE_001');
assert(_lookupMatrix('low', 'strong')      === SUPPRESS_SENTINEL, '_lookupMatrix: low + strong → suppress');
assert(_lookupMatrix('insufficient', 'weak') === SUPPRESS_SENTINEL, '_lookupMatrix: insufficient + weak → suppress');

assertThrows(
  () => _lookupMatrix('unknown', 'strong'),
  'confidence_level',
  '_lookupMatrix: unknown confidence_level throws TypeError'
);

assertThrows(
  () => _lookupMatrix('high', 'extreme'),
  'claim_strength',
  '_lookupMatrix: unknown claim_strength throws TypeError'
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: HEDGE PATTERN REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

section('4. Hedge pattern registry integrity');

assert(HEDGE_PATTERNS.length >= 5, `Registry has ≥5 entries (has ${HEDGE_PATTERNS.length})`);

// All pattern_ids are unique
{
  const ids = HEDGE_PATTERNS.map(p => p.pattern_id);
  assert(new Set(ids).size === ids.length, 'All pattern_ids are unique');
}

// All patterns have required properties
{
  const required = ['pattern_id', 'behavior', 'prefix', 'connector', 'join_mode',
                    'description', 'detection_patterns'];
  const allValid = HEDGE_PATTERNS.every(p => required.every(k => k in p));
  assert(allValid, 'All patterns have required schema properties');
}

// All detection_patterns entries are compiled RegExp
{
  const allRegExp = HEDGE_PATTERNS.every(p =>
    p.detection_patterns.every(d => d instanceof RegExp)
  );
  assert(allRegExp, 'All detection_patterns entries are compiled RegExp');
}

// HP_NONE has an empty prefix and is in the registry
assert(_findPattern('HP_NONE') !== null,       'HP_NONE is in the registry');
assert(_findPattern('HP_NONE').prefix === '',  'HP_NONE has empty prefix');
assert(_findPattern('HP_NONE').join_mode === 'direct', 'HP_NONE join_mode is "direct"');

// getHedgePatternRegistry() returns safe snapshots (no RegExp)
{
  const registry = getHedgePatternRegistry();
  assert(Array.isArray(registry), 'getHedgePatternRegistry returns an array');
  assert(registry.length === HEDGE_PATTERNS.length, 'getHedgePatternRegistry count matches HEDGE_PATTERNS.length');
  const noRegExp = registry.every(p =>
    !Object.values(p).some(v => v instanceof RegExp)
  );
  assert(noRegExp, 'getHedgePatternRegistry does not expose compiled RegExp objects');
  const hasCount = registry.every(p => typeof p.detection_pattern_count === 'number');
  assert(hasCount, 'getHedgePatternRegistry entries have detection_pattern_count');
}

// _findPattern returns null for unknown id
assert(_findPattern('HP_NONEXISTENT') === null, '_findPattern: unknown id returns null');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: _alreadyHedged()
// ─────────────────────────────────────────────────────────────────────────────

section('5. _alreadyHedged()');

// Clean texts → false
assert(!_alreadyHedged(null),   '_alreadyHedged: null input → false');
assert(!_alreadyHedged(''),     '_alreadyHedged: empty string → false');
assert(!_alreadyHedged('   '), '_alreadyHedged: whitespace-only → false');
assert(!_alreadyHedged('Overall score 88/100 — consistently above segment median.'),
  '_alreadyHedged: clean factual text → false');
assert(!_alreadyHedged('4.7/5 guest average sustained across 847 reviews.'),
  '_alreadyHedged: numeric opener text → false');
assert(!_alreadyHedged('Beachfront placement confirmed — direct sand access.'),
  '_alreadyHedged: direct boolean claim → false');

// Registered pattern detection_patterns → true
assert(_alreadyHedged('Guests frequently note that beachfront access is excellent.'),
  '_alreadyHedged: "Guests frequently note" (HP_SOFT_001) → true');
assert(_alreadyHedged('Consistently observed across this review set — amenity score is strong.'),
  '_alreadyHedged: "Consistently observed across" (HP_SOFT_002) → true');
assert(_alreadyHedged('Reviews suggest that the wellness offering is notable.'),
  '_alreadyHedged: "Reviews suggest that" (HP_TENTATIVE_001) → true');
assert(_alreadyHedged('Based on current data, location score remains high.'),
  '_alreadyHedged: "Based on current data" (HP_LIGHT_001) → true');

// General hedge indicators → true
assert(_alreadyHedged('Many guests highlight the beachfront access.'),
  '_alreadyHedged: "Many guests highlight" (general) → true');
assert(_alreadyHedged('Some guests note that check-in is smooth.'),
  '_alreadyHedged: "Some guests" (general) → true');
assert(_alreadyHedged('Based on available data, the spa is well regarded.'),
  '_alreadyHedged: "Based on available data" (general) → true');
assert(_alreadyHedged('Early indicators suggest strong repeat visit rate.'),
  '_alreadyHedged: "Early indicators suggest" (general) → true');

// Hedge word in middle of sentence → NOT flagged (only leading hedge matters)
assert(!_alreadyHedged('The spa review suggests top-tier performance.'),
  '_alreadyHedged: mid-sentence "suggests" does not trigger → false');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: _lowercaseFirst()
// ─────────────────────────────────────────────────────────────────────────────

section('6. _lowercaseFirst()');

assert(_lowercaseFirst('Overall score 88/100') === 'overall score 88/100',
  '_lowercaseFirst: standard capital → lowercased');
assert(_lowercaseFirst('Amenity score: 90/100') === 'amenity score: 90/100',
  '_lowercaseFirst: standard capital → lowercased');
assert(_lowercaseFirst('OTA ranking confirms strong placement') === 'OTA ranking confirms strong placement',
  '_lowercaseFirst: two-char abbreviation (OTA) → preserved');
assert(_lowercaseFirst('AAA-rated property') === 'AAA-rated property',
  '_lowercaseFirst: uppercase abbreviation (AAA) → preserved');
assert(_lowercaseFirst('4.7/5 guest average') === '4.7/5 guest average',
  '_lowercaseFirst: numeric opener → preserved');
assert(_lowercaseFirst('') === '',
  '_lowercaseFirst: empty string → empty string');
assert(_lowercaseFirst('already lowercase') === 'already lowercase',
  '_lowercaseFirst: already lowercase → unchanged');
assert(_lowercaseFirst('S') === 's',
  '_lowercaseFirst: single uppercase char → lowercased');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: _joinHedge()
// ─────────────────────────────────────────────────────────────────────────────

section('7. _joinHedge()');

{
  const nonePattern = _findPattern('HP_NONE');
  const text = 'Overall score 88/100 — consistently above segment median.';
  assert(_joinHedge(nonePattern, text) === text,
    '_joinHedge: HP_NONE (direct) returns text unchanged');
}

{
  const softPattern = _findPattern('HP_SOFT_001');
  const text = 'Overall score 88/100 — consistently above segment median.';
  const result = _joinHedge(softPattern, text);
  assert(result.startsWith('Guests frequently note that '),
    '_joinHedge: HP_SOFT_001 (lowercase) starts with correct prefix+connector');
  assert(result.includes('overall score'),
    '_joinHedge: HP_SOFT_001 lowercases the first letter of the body');
  assert(!result.includes('Overall score'),
    '_joinHedge: HP_SOFT_001 does not preserve the original capital');
}

{
  const soft2Pattern = _findPattern('HP_SOFT_002');
  const text = 'Overall score 88/100 — consistently above segment median.';
  const result = _joinHedge(soft2Pattern, text);
  assert(result.startsWith('Consistently observed across this review set — '),
    '_joinHedge: HP_SOFT_002 (preserve) starts with correct prefix+connector');
  assert(result.includes('Overall score'),
    '_joinHedge: HP_SOFT_002 preserves original capitalisation');
}

{
  const tentativePattern = _findPattern('HP_TENTATIVE_001');
  const text = 'Strong spa offering with award-rated facilities.';
  const result = _joinHedge(tentativePattern, text);
  assert(result.startsWith('Reviews suggest that '),
    '_joinHedge: HP_TENTATIVE_001 starts with correct prefix+connector');
  assert(result.includes('strong spa'),
    '_joinHedge: HP_TENTATIVE_001 lowercases body correctly');
}

{
  const lightPattern = _findPattern('HP_LIGHT_001');
  const text = 'Location score 72/100 — above regional floor.';
  const result = _joinHedge(lightPattern, text);
  assert(result.startsWith('Based on current data, '),
    '_joinHedge: HP_LIGHT_001 (preserve) starts with correct prefix+connector');
  assert(result.includes('Location score'),
    '_joinHedge: HP_LIGHT_001 preserves original capitalisation');
}

// Numeric opener preserved through lowercase join_mode
{
  const softPattern = _findPattern('HP_SOFT_001');
  const result = _joinHedge(softPattern, '4.7/5 guest average sustained across 847 reviews.');
  assert(result.startsWith('Guests frequently note that 4.7/5'),
    '_joinHedge: numeric opener preserved through lowercase join_mode');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: enforce() — suppression cases
// ─────────────────────────────────────────────────────────────────────────────

section('8. enforce() — suppression cases');

// low + strong → suppress
{
  const result = enforce(buildInput({ confidence_level: 'low', claim_strength: 'strong' }));
  assert(result.suppressed,                             'Suppress: low + strong → suppressed=true');
  assert(!result.hedged,                                'Suppress: low + strong → hedged=false');
  assert(result.final_text === null,                    'Suppress: low + strong → final_text=null');
  assert(result.hedge_pattern === null,                 'Suppress: low + strong → hedge_pattern=null');
  assert(typeof result.suppression_reason === 'string', 'Suppress: low + strong → suppression_reason is a string');
  assert(result.suppression_reason.includes('low'),    'Suppress: reason cites confidence_level');
  assert(result.suppression_reason.includes('strong'), 'Suppress: reason cites claim_strength');
}

// insufficient + weak → suppress
{
  const result = enforce(buildInput({ confidence_level: 'insufficient', claim_strength: 'weak' }));
  assert(result.suppressed,                 'Suppress: insufficient + weak → suppressed=true');
  assert(result.final_text === null,        'Suppress: insufficient + weak → final_text=null');
}

// insufficient + moderate → suppress
{
  const result = enforce(buildInput({ confidence_level: 'insufficient', claim_strength: 'moderate' }));
  assert(result.suppressed, 'Suppress: insufficient + moderate → suppressed=true');
}

// insufficient + strong → suppress
{
  const result = enforce(buildInput({ confidence_level: 'insufficient', claim_strength: 'strong' }));
  assert(result.suppressed, 'Suppress: insufficient + strong → suppressed=true');
}

// Suppress audit entry is correct
{
  const result = enforce(buildInput({ confidence_level: 'low', claim_strength: 'strong' }));
  assert(result.audit_log.length === 1,                             'Suppress: audit_log has exactly 1 entry');
  assert(result.audit_log[0].outcome === 'suppressed',             'Suppress: audit entry outcome = suppressed');
  assert(result.audit_log[0].stage === 'confidence_enforcement',   'Suppress: audit entry stage correct');
  assert(result.audit_log[0].resolved_pattern === SUPPRESS_SENTINEL, 'Suppress: audit entry resolved_pattern = sentinel');
}

// Upstream audit is preserved and extended
{
  const prior = [{ stage: 'hallucination_guard', outcome: 'passed' }];
  const result = enforce(buildInput({
    confidence_level: 'insufficient',
    claim_strength:   'strong',
    audit_log:        prior,
  }));
  assert(result.audit_log.length === 2,            'Suppress: upstream audit preserved + new entry appended');
  assert(result.audit_log[0].stage === 'hallucination_guard', 'Suppress: upstream audit entry is first');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: enforce() — direct assertion cases
// ─────────────────────────────────────────────────────────────────────────────

section('9. enforce() — direct assertion cases');

const originalText = 'Overall score 88/100 — consistently above segment median.';

// All HIGH cells → direct
for (const cs of ['weak', 'moderate', 'strong']) {
  const result = enforce(buildInput({ confidence_level: 'high', claim_strength: cs }));
  assert(!result.suppressed,                  `Direct: high + ${cs} → suppressed=false`);
  assert(!result.hedged,                      `Direct: high + ${cs} → hedged=false`);
  assert(result.final_text === originalText,  `Direct: high + ${cs} → final_text unchanged`);
  assert(result.hedge_pattern === null,       `Direct: high + ${cs} → hedge_pattern=null`);
}

// MEDIUM + weak → direct
{
  const result = enforce(buildInput({ confidence_level: 'medium', claim_strength: 'weak' }));
  assert(!result.suppressed,                 'Direct: medium + weak → suppressed=false');
  assert(!result.hedged,                     'Direct: medium + weak → hedged=false');
  assert(result.final_text === originalText, 'Direct: medium + weak → final_text unchanged');
}

// Direct audit outcome is 'direct'
{
  const result = enforce(buildInput({ confidence_level: 'high', claim_strength: 'strong' }));
  assert(result.audit_log[result.audit_log.length - 1].outcome === 'direct',
    'Direct: audit entry outcome = "direct"');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: enforce() — hedge application cases
// ─────────────────────────────────────────────────────────────────────────────

section('10. enforce() — hedge application cases');

// medium + moderate → HP_SOFT_001
{
  const result = enforce(buildInput({ confidence_level: 'medium', claim_strength: 'moderate' }));
  assert(result.hedged,                         'Hedge: medium + moderate → hedged=true');
  assert(!result.suppressed,                    'Hedge: medium + moderate → suppressed=false');
  assert(result.hedge_pattern === 'HP_SOFT_001', 'Hedge: medium + moderate → hedge_pattern=HP_SOFT_001');
  assert(result.final_text.startsWith('Guests frequently note that '),
    'Hedge: medium + moderate → final_text starts with HP_SOFT_001 prefix');
  assert(result.final_text.includes('overall score'),
    'Hedge: medium + moderate → original content present (lowercased)');
  assert(!result.final_text.startsWith('Guests frequently note that Overall'),
    'Hedge: HP_SOFT_001 lowercases first letter of body');
}

// medium + strong → HP_SOFT_002
{
  const result = enforce(buildInput({ confidence_level: 'medium', claim_strength: 'strong' }));
  assert(result.hedged,                         'Hedge: medium + strong → hedged=true');
  assert(result.hedge_pattern === 'HP_SOFT_002', 'Hedge: medium + strong → hedge_pattern=HP_SOFT_002');
  assert(result.final_text.startsWith('Consistently observed across this review set — '),
    'Hedge: medium + strong → final_text starts with HP_SOFT_002 prefix');
  assert(result.final_text.includes('Overall score'),
    'Hedge: HP_SOFT_002 preserves original capitalisation');
}

// low + weak → HP_LIGHT_001
{
  const result = enforce(buildInput({ confidence_level: 'low', claim_strength: 'weak' }));
  assert(result.hedged,                          'Hedge: low + weak → hedged=true');
  assert(result.hedge_pattern === 'HP_LIGHT_001', 'Hedge: low + weak → hedge_pattern=HP_LIGHT_001');
  assert(result.final_text.startsWith('Based on current data, '),
    'Hedge: low + weak → final_text starts with HP_LIGHT_001 prefix');
  assert(result.final_text.includes('Overall score'),
    'Hedge: HP_LIGHT_001 preserves original capitalisation');
}

// low + moderate → HP_TENTATIVE_001
{
  const result = enforce(buildInput({ confidence_level: 'low', claim_strength: 'moderate' }));
  assert(result.hedged,                              'Hedge: low + moderate → hedged=true');
  assert(result.hedge_pattern === 'HP_TENTATIVE_001', 'Hedge: low + moderate → hedge_pattern=HP_TENTATIVE_001');
  assert(result.final_text.startsWith('Reviews suggest that '),
    'Hedge: low + moderate → final_text starts with HP_TENTATIVE_001 prefix');
  assert(result.final_text.includes('overall score'),
    'Hedge: HP_TENTATIVE_001 lowercases body correctly');
}

// Hedge audit outcome is 'hedged'
{
  const result = enforce(buildInput({ confidence_level: 'medium', claim_strength: 'moderate' }));
  const enforceEntry = result.audit_log[result.audit_log.length - 1];
  assert(enforceEntry.outcome === 'hedged',               'Hedge: audit outcome = "hedged"');
  assert(enforceEntry.resolved_pattern === 'HP_SOFT_001', 'Hedge: audit resolved_pattern correct');
  assert(enforceEntry.stage === 'confidence_enforcement', 'Hedge: audit stage correct');
}

// Hedge preserves factual content — original numbers present in final_text
{
  const claim = claimWithText('Amenity score: 90/100 — top-tier facility profile.');
  const result = enforce(buildInput({
    validated_claim:  claim,
    confidence_level: 'medium',
    claim_strength:   'moderate',
  }));
  assert(result.final_text.includes('90/100'),
    'Hedge: factual numbers preserved in hedged output');
  assert(result.final_text.includes('90/100 — top-tier facility profile'),
    'Hedge: factual content fully intact in hedged output');
}

// Different texts all get hedged correctly
{
  const texts = [
    'Spa offering scores 92/100 — highest in wellness segment.',
    'Location score 85/100: beachfront placement confirmed.',
    '4.7/5 guest rating sustained across 847 reviews.',
  ];
  for (const text of texts) {
    const result = enforce(buildInput({
      validated_claim:  claimWithText(text),
      confidence_level: 'medium',
      claim_strength:   'moderate',
    }));
    assert(result.hedged && result.final_text.startsWith('Guests frequently note that '),
      `Hedge: HP_SOFT_001 applied to: "${text.substring(0, 40)}..."`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: enforce() — idempotency
// ─────────────────────────────────────────────────────────────────────────────

section('11. enforce() — idempotency (no double-hedging)');

// Text already starting with HP_SOFT_001 prefix → idempotent
{
  const preHedgedClaim = claimWithText(
    'Guests frequently note that overall score 88/100 — consistently above segment median.'
  );
  const result = enforce(buildInput({
    validated_claim:  preHedgedClaim,
    confidence_level: 'medium',
    claim_strength:   'moderate',
  }));
  assert(!result.hedged,                       'Idempotent: already-hedged text → hedged=false');
  assert(!result.suppressed,                   'Idempotent: already-hedged text → suppressed=false');
  assert(result.final_text === preHedgedClaim.rendered_text,
    'Idempotent: final_text equals original (no additional prefix)');
  assert(result.hedge_pattern === 'HP_SOFT_001',
    'Idempotent: hedge_pattern records intended pattern for audit');
  const entry = result.audit_log[result.audit_log.length - 1];
  assert(entry.outcome === 'idempotent',       'Idempotent: audit outcome = "idempotent"');
  assert(entry.already_hedged === true,        'Idempotent: audit already_hedged = true');
}

// Text starting with HP_SOFT_002 prefix → idempotent
{
  const claim = claimWithText('Consistently observed across this review set — strong value profile.');
  const result = enforce(buildInput({
    validated_claim:  claim,
    confidence_level: 'medium',
    claim_strength:   'strong',
  }));
  assert(!result.hedged && result.final_text === claim.rendered_text,
    'Idempotent: HP_SOFT_002 prefix detected → no re-hedge');
}

// Text with general hedge indicator → idempotent
{
  const claim = claimWithText('Many guests highlight the beachfront quality.');
  const result = enforce(buildInput({
    validated_claim:  claim,
    confidence_level: 'low',
    claim_strength:   'moderate',
  }));
  assert(!result.hedged && result.final_text === claim.rendered_text,
    'Idempotent: general hedge indicator "Many guests" → no re-hedge');
  const entry = result.audit_log[result.audit_log.length - 1];
  assert(entry.outcome === 'idempotent', 'Idempotent: general indicator triggers idempotent outcome');
}

// "Early indicators suggest..." text → idempotent even with low+weak
{
  const claim = claimWithText('Early indicators suggest strong repeat-visit engagement.');
  const result = enforce(buildInput({
    validated_claim:  claim,
    confidence_level: 'low',
    claim_strength:   'weak',
  }));
  assert(!result.hedged, 'Idempotent: "Early indicators suggest" → no re-hedge');
}

// Confirmed: stacked hedge is prevented
{
  const claim = claimWithText('Reviews suggest that the spa is noteworthy.');
  const result = enforce(buildInput({
    validated_claim:  claim,
    confidence_level: 'low',
    claim_strength:   'moderate',
  }));
  assert(
    !result.final_text.startsWith('Reviews suggest that reviews suggest'),
    'Idempotent: hedge stacking prevented — no "Reviews suggest that reviews suggest..."'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: enforce() — input validation and edge cases
// ─────────────────────────────────────────────────────────────────────────────

section('12. enforce() — input validation and edge cases');

// null input
{
  const result = enforce(null);
  assert(result.suppressed,             'Edge: null input → suppressed');
  assert(!result.hedged,                'Edge: null input → hedged=false');
  assert(result.final_text === null,    'Edge: null input → final_text=null');
}

// array input
{
  const result = enforce([]);
  assert(result.suppressed, 'Edge: array input → suppressed');
}

// null validated_claim
{
  const result = enforce(buildInput({ validated_claim: null }));
  assert(result.suppressed, 'Edge: null validated_claim → suppressed');
  assert(result.suppression_reason.includes('validated_claim'),
    'Edge: null validated_claim reason mentions field');
}

// null rendered_text
{
  const result = enforce(buildInput({ validated_claim: { ...VALIDATED_CLAIM, rendered_text: null } }));
  assert(result.suppressed, 'Edge: null rendered_text → suppressed');
}

// empty rendered_text
{
  const result = enforce(buildInput({ validated_claim: claimWithText('') }));
  assert(result.suppressed, 'Edge: empty rendered_text → suppressed');
}

// whitespace-only rendered_text
{
  const result = enforce(buildInput({ validated_claim: claimWithText('   ') }));
  assert(result.suppressed, 'Edge: whitespace-only rendered_text → suppressed');
}

// unknown confidence_level
{
  const result = enforce(buildInput({ confidence_level: 'super_high' }));
  assert(result.suppressed, 'Edge: unknown confidence_level → suppressed');
  assert(result.suppression_reason.includes('super_high'),
    'Edge: unknown confidence_level reason cites the value');
}

// unknown claim_strength
{
  const result = enforce(buildInput({ claim_strength: 'extreme' }));
  assert(result.suppressed, 'Edge: unknown claim_strength → suppressed');
  assert(result.suppression_reason.includes('extreme'),
    'Edge: unknown claim_strength reason cites the value');
}

// missing audit_log → treated as empty
{
  const input = {
    validated_claim:  VALIDATED_CLAIM,
    confidence_level: 'high',
    claim_strength:   'strong',
  };
  const result = enforce(input);
  assert(!result.suppressed,             'Edge: missing audit_log → not suppressed');
  assert(Array.isArray(result.audit_log), 'Edge: missing audit_log → audit_log is array');
}

// missing review_count → not required, no error
{
  const input = {
    validated_claim:  VALIDATED_CLAIM,
    confidence_level: 'high',
    claim_strength:   'strong',
    audit_log:        [],
  };
  const result = enforce(input);
  assert(!result.suppressed, 'Edge: missing review_count → not suppressed');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: enforce() — audit log structure
// ─────────────────────────────────────────────────────────────────────────────

section('13. enforce() — audit log structure');

// Single audit entry appended per enforce() call
{
  const priorAudit = [
    { stage: 'field_presence', outcome: 'passed' },
    { stage: 'boolean_consistency', outcome: 'passed' },
  ];
  const result = enforce(buildInput({ audit_log: priorAudit, confidence_level: 'high', claim_strength: 'strong' }));
  assert(result.audit_log.length === 3,
    'Audit: upstream 2 entries + 1 enforcement entry = 3 total');
}

// Enforcement audit entry has all required fields
{
  const result = enforce(buildInput({ confidence_level: 'medium', claim_strength: 'moderate' }));
  const entry = result.audit_log[result.audit_log.length - 1];
  assert(entry.stage            === 'confidence_enforcement', 'Audit: stage field correct');
  assert(entry.enforcer_version === ENFORCER_VERSION,         'Audit: enforcer_version present');
  assert(entry.confidence_level === 'medium',                 'Audit: confidence_level echoed');
  assert(entry.claim_strength   === 'moderate',               'Audit: claim_strength echoed');
  assert(entry.resolved_pattern === 'HP_SOFT_001',            'Audit: resolved_pattern correct');
  assert('already_hedged' in entry,                          'Audit: already_hedged field present');
  assert('outcome' in entry,                                  'Audit: outcome field present');
}

// Suppression audit entry has resolved_pattern = SUPPRESS_SENTINEL
{
  const result = enforce(buildInput({ confidence_level: 'insufficient', claim_strength: 'strong' }));
  assert(result.audit_log[0].resolved_pattern === SUPPRESS_SENTINEL,
    'Audit: suppression entry resolved_pattern = SUPPRESS_SENTINEL');
}

// Null upstream audit handled gracefully
{
  const result = enforce({
    validated_claim:  VALIDATED_CLAIM,
    confidence_level: 'high',
    claim_strength:   'strong',
    audit_log:        null,
  });
  assert(Array.isArray(result.audit_log), 'Audit: null upstream audit_log handled gracefully');
  assert(result.audit_log.length === 1,  'Audit: null upstream → 1 entry (enforcement only)');
}

// result is frozen
{
  const result = enforce(buildInput());
  assert(Object.isFrozen(result), 'Audit: EnforcementResult is frozen');
  assert(Object.isFrozen(result.audit_log), 'Audit: audit_log array is frozen');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: enforceBatch()
// ─────────────────────────────────────────────────────────────────────────────

section('14. enforceBatch()');

// Empty array → empty array
{
  const results = enforceBatch([]);
  assert(Array.isArray(results) && results.length === 0,
    'Batch: empty array → empty array');
}

// Single input → array of 1
{
  const results = enforceBatch([buildInput()]);
  assert(results.length === 1,  'Batch: 1 input → 1 result');
  assert(!results[0].suppressed, 'Batch: single valid input → not suppressed');
}

// Length matches input
{
  const inputs = [
    buildInput({ confidence_level: 'high',   claim_strength: 'strong' }),
    buildInput({ confidence_level: 'low',    claim_strength: 'strong' }),
    buildInput({ confidence_level: 'medium', claim_strength: 'moderate' }),
  ];
  const results = enforceBatch(inputs);
  assert(results.length === 3, 'Batch: 3 inputs → 3 results');
}

// Independence: one suppression does not affect others
{
  const inputs = [
    buildInput({ confidence_level: 'high',         claim_strength: 'strong' }),
    buildInput({ confidence_level: 'insufficient', claim_strength: 'strong' }),
    buildInput({ confidence_level: 'medium',       claim_strength: 'moderate' }),
  ];
  const results = enforceBatch(inputs);
  assert(!results[0].suppressed, 'Batch: first (high+strong) → not suppressed');
  assert(results[1].suppressed,  'Batch: second (insufficient+strong) → suppressed');
  assert(!results[2].suppressed, 'Batch: third (medium+moderate) → not suppressed');
  assert(results[2].hedged,      'Batch: third (medium+moderate) → hedged');
}

// Non-array input throws TypeError
assertThrows(
  () => enforceBatch('not an array'),
  'array',
  'Batch: non-array input throws TypeError'
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15: deriveConfidenceLevel()
// ─────────────────────────────────────────────────────────────────────────────

section('15. deriveConfidenceLevel()');

assert(deriveConfidenceLevel(0)   === 'insufficient', 'deriveConfidenceLevel: 0 → insufficient');
assert(deriveConfidenceLevel(9)   === 'insufficient', 'deriveConfidenceLevel: 9 → insufficient (< 10)');
assert(deriveConfidenceLevel(10)  === 'low',          'deriveConfidenceLevel: 10 → low (= INSUFFICIENT threshold)');
assert(deriveConfidenceLevel(25)  === 'low',          'deriveConfidenceLevel: 25 → low');
assert(deriveConfidenceLevel(49)  === 'low',          'deriveConfidenceLevel: 49 → low (< 50)');
assert(deriveConfidenceLevel(50)  === 'medium',       'deriveConfidenceLevel: 50 → medium (= LOW threshold)');
assert(deriveConfidenceLevel(100) === 'medium',       'deriveConfidenceLevel: 100 → medium');
assert(deriveConfidenceLevel(199) === 'medium',       'deriveConfidenceLevel: 199 → medium (< 200)');
assert(deriveConfidenceLevel(200) === 'high',         'deriveConfidenceLevel: 200 → high (= MEDIUM threshold)');
assert(deriveConfidenceLevel(847) === 'high',         'deriveConfidenceLevel: 847 → high');

// Edge cases
assert(deriveConfidenceLevel(null)      === 'insufficient', 'deriveConfidenceLevel: null → insufficient');
assert(deriveConfidenceLevel(undefined) === 'insufficient', 'deriveConfidenceLevel: undefined → insufficient');
assert(deriveConfidenceLevel(NaN)       === 'insufficient', 'deriveConfidenceLevel: NaN → insufficient');
assert(deriveConfidenceLevel(-1)        === 'insufficient', 'deriveConfidenceLevel: -1 → insufficient');
assert(deriveConfidenceLevel('847')     === 'insufficient', 'deriveConfidenceLevel: string "847" → insufficient');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16: deriveClaimStrength()
// ─────────────────────────────────────────────────────────────────────────────

section('16. deriveClaimStrength()');

// boolean → always weak (binary verified fact; no strength gradient;
// routes medium+weak → HP_NONE so "Confirmed" facts are stated directly)
assert(deriveClaimStrength('boolean')        === 'weak', 'deriveClaimStrength: boolean → weak (no strength gradient for binary facts)');
assert(deriveClaimStrength('boolean', 95)    === 'weak', 'deriveClaimStrength: boolean + score → weak (score irrelevant for binary)');

// descriptive → always weak
assert(deriveClaimStrength('descriptive')    === 'weak', 'deriveClaimStrength: descriptive → weak');
assert(deriveClaimStrength('descriptive', 99) === 'weak', 'deriveClaimStrength: descriptive + score → weak (score ignored)');

// numeric, score-based
assert(deriveClaimStrength('numeric', 80)  === 'strong',   'deriveClaimStrength: numeric + 80 → strong (boundary)');
assert(deriveClaimStrength('numeric', 90)  === 'strong',   'deriveClaimStrength: numeric + 90 → strong');
assert(deriveClaimStrength('numeric', 79)  === 'moderate', 'deriveClaimStrength: numeric + 79 → moderate');
assert(deriveClaimStrength('numeric', 60)  === 'moderate', 'deriveClaimStrength: numeric + 60 → moderate (boundary)');
assert(deriveClaimStrength('numeric', 59)  === 'weak',     'deriveClaimStrength: numeric + 59 → weak');
assert(deriveClaimStrength('numeric', 0)   === 'weak',     'deriveClaimStrength: numeric + 0 → weak');

// comparative, score-based
assert(deriveClaimStrength('comparative', 85) === 'strong',   'deriveClaimStrength: comparative + 85 → strong');
assert(deriveClaimStrength('comparative', 65) === 'moderate', 'deriveClaimStrength: comparative + 65 → moderate');
assert(deriveClaimStrength('comparative', 50) === 'weak',     'deriveClaimStrength: comparative + 50 → weak');

// missing/invalid score → weak
assert(deriveClaimStrength('numeric')        === 'weak', 'deriveClaimStrength: numeric + no score → weak');
assert(deriveClaimStrength('numeric', null)  === 'weak', 'deriveClaimStrength: numeric + null score → weak');
assert(deriveClaimStrength('numeric', NaN)   === 'weak', 'deriveClaimStrength: numeric + NaN score → weak');

// unknown claim type → weak (conservative)
assert(deriveClaimStrength('unknown_type') === 'weak', 'deriveClaimStrength: unknown type → weak');
assert(deriveClaimStrength(null)           === 'weak', 'deriveClaimStrength: null type → weak');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17: Integration
// ─────────────────────────────────────────────────────────────────────────────

section('17. Integration — deriveConfidenceLevel + deriveClaimStrength + enforce');

// High-volume hotel, high score → direct
{
  const cl = deriveConfidenceLevel(847);
  const cs = deriveClaimStrength('numeric', 88);
  const result = enforce(buildInput({ confidence_level: cl, claim_strength: cs }));
  assert(!result.hedged && !result.suppressed,
    'Integration: 847 reviews + score 88 → direct assertion');
  assert(result.final_text === originalText,
    'Integration: direct result final_text = original claim text');
}

// Low-volume hotel, high score, moderate claim → tentative hedge
{
  const cl = deriveConfidenceLevel(30);     // low
  const cs = deriveClaimStrength('numeric', 75);  // moderate
  const result = enforce(buildInput({ confidence_level: cl, claim_strength: cs }));
  assert(result.hedged,                              'Integration: 30 reviews + score 75 → hedged');
  assert(result.hedge_pattern === 'HP_TENTATIVE_001', 'Integration: low+moderate → HP_TENTATIVE_001');
  assert(result.final_text.startsWith('Reviews suggest that '),
    'Integration: HP_TENTATIVE_001 prefix applied');
}

// Very low volume, high score, strong claim → suppressed
{
  const cl = deriveConfidenceLevel(5);       // insufficient
  const cs = deriveClaimStrength('numeric', 91);  // strong
  const result = enforce(buildInput({ confidence_level: cl, claim_strength: cs }));
  assert(result.suppressed,
    'Integration: 5 reviews + score 91 → suppressed (insufficient evidence for strong claim)');
}

// Medium volume, boolean claim → direct (HP_NONE for medium+weak)
// boolean returns 'weak' → medium+weak = HP_NONE → direct assertion.
// This is semantically correct: a verified binary fact needs no hedge.
{
  const cl = deriveConfidenceLevel(80);         // medium
  const cs = deriveClaimStrength('boolean');    // weak (binary fact — no gradient)
  const result = enforce(buildInput({
    confidence_level: cl,
    claim_strength:   cs,
    validated_claim:  claimWithText('Beachfront placement confirmed — direct sand access.'),
  }));
  assert(!result.hedged && !result.suppressed,
    'Integration: medium + boolean(weak) → direct assertion (HP_NONE)');
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
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
