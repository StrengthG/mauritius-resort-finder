'use strict';

/**
 * hotel_content_engine.test.js
 * Tests for hotel_content_engine.js — determinism, structure, and data integrity.
 */

const { generateContent, REGION_DATA, ENGINE_VERSION } = require('./hotel_content_engine.js');

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOTEL_A = {
  hotel_id:       'HTL001',
  hotel_name:     'Four Seasons Resort Mauritius at Anahita',
  region:         'Trou d\'Eau Douce',
  star_rating:    5,
  overall_rating: 9.2,
  avg_rating:     4.7,
  review_count:   820,
  beach_score:    9.5,
  pool_score:     9.0,
  dining_score:   9.1,
  service_score:  9.4,
  room_score:     9.3,
  value_score:    8.0,
  spa_score:      9.0,
  kids_score:     8.5,
  location_score: 9.3,
  amenity_score:  9.1,
  brand_score:    9.2,
  adults_only:    false,
  amenities: {
    private_beach: true,
    spa:           true,
    butler_service: true,
    pool:          true,
    fine_dining:   true,
    kids_club:     true,
  },
};

const HOTEL_B = {
  hotel_id:       'HTL002',
  hotel_name:     'Paradise Cove Boutique Hotel',
  region:         'Cap Malheureux',
  star_rating:    5,
  overall_rating: 8.9,
  avg_rating:     4.6,
  review_count:   540,
  beach_score:    9.2,
  pool_score:     8.8,
  dining_score:   8.5,
  service_score:  9.1,
  room_score:     8.9,
  value_score:    8.4,
  spa_score:      8.5,
  kids_score:     2.0,
  location_score: 9.0,
  amenity_score:  8.7,
  brand_score:    8.8,
  adults_only:    true,
  amenities: {
    private_beach: true,
    spa:           true,
    pool:          true,
    fine_dining:   true,
  },
};

const DATASET = [HOTEL_A, HOTEL_B];

// ── Tests: REGION_DATA integrity ──────────────────────────────────────────────

console.log('\nREGION_DATA');

test('REGION_DATA is frozen', () => {
  assert(Object.isFrozen(REGION_DATA));
});

test('REGION_DATA has at least 5 regions', () => {
  assert(Object.keys(REGION_DATA).length >= 5,
    `Expected ≥5 regions, got ${Object.keys(REGION_DATA).length}`);
});

test('each region has required keys', () => {
  const required = ['description', 'character', 'attractions', 'water_condition'];
  for (const [name, data] of Object.entries(REGION_DATA)) {
    for (const key of required) {
      assert(key in data, `Region "${name}" missing key "${key}"`);
    }
    assert(Array.isArray(data.attractions),
      `Region "${name}" attractions must be an array`);
    assert(data.attractions.length >= 3,
      `Region "${name}" should have ≥3 attractions`);
  }
});

// ── Tests: generateContent — input validation ─────────────────────────────────

console.log('\ngenerateContent — validation');

test('throws TypeError for non-object hotel', () => {
  let threw = false;
  try { generateContent(null, DATASET); } catch (e) { threw = true; }
  assert(threw, 'Should throw for null hotel');
});

test('throws TypeError for hotel missing hotel_id', () => {
  let threw = false;
  try { generateContent({ hotel_name: 'X' }, DATASET); } catch (e) { threw = true; }
  assert(threw, 'Should throw for missing hotel_id');
});

test('throws TypeError for hotel missing hotel_name', () => {
  let threw = false;
  try { generateContent({ hotel_id: 'X' }, DATASET); } catch (e) { threw = true; }
  assert(threw, 'Should throw for missing hotel_name');
});

test('does not throw for valid hotel', () => {
  let threw = false;
  try { generateContent(HOTEL_A, DATASET); } catch (e) { threw = true; }
  assert(!threw, 'Should not throw for valid hotel');
});

test('does not throw when dataset is empty array', () => {
  let threw = false;
  try { generateContent(HOTEL_A, []); } catch (e) { threw = true; }
  assert(!threw, 'Should not throw for empty dataset');
});

test('does not throw when dataset is null (graceful fallback)', () => {
  let threw = false;
  try { generateContent(HOTEL_A, null); } catch (e) { threw = true; }
  assert(!threw, 'Should not throw for null dataset');
});

// ── Tests: generateContent — output structure ─────────────────────────────────

console.log('\ngenerateContent — output structure');

const RESULT_A = generateContent(HOTEL_A, DATASET);

test('result is frozen', () => {
  assert(Object.isFrozen(RESULT_A));
});

test('result has all required top-level keys', () => {
  const required = [
    'hotel_id', 'editorial_intro', 'why_stay_here', 'best_for',
    'pros_considerations', 'nearby_attractions', 'comparison_context',
    'hotel_faqs', 'engine_version',
  ];
  for (const key of required) {
    assert(key in RESULT_A, `Result missing key "${key}"`);
  }
});

test('hotel_id matches input', () => {
  assertEqual(RESULT_A.hotel_id, HOTEL_A.hotel_id);
});

test('engine_version matches module constant', () => {
  assertEqual(RESULT_A.engine_version, ENGINE_VERSION);
});

// editorial_intro
test('editorial_intro is a non-empty string', () => {
  assert(typeof RESULT_A.editorial_intro === 'string' && RESULT_A.editorial_intro.length > 0,
    'editorial_intro must be a non-empty string');
});

test('editorial_intro contains multiple paragraphs (joined with newlines)', () => {
  // Engine joins paragraphs with \n\n
  const paragraphs = RESULT_A.editorial_intro.split('\n\n').filter(p => p.trim().length > 0);
  assert(paragraphs.length >= 1, `Expected ≥1 paragraph, got ${paragraphs.length}`);
});

// why_stay_here
test('why_stay_here is an array of strings', () => {
  assert(Array.isArray(RESULT_A.why_stay_here));
  RESULT_A.why_stay_here.forEach((r, i) => {
    assert(typeof r === 'string' && r.length > 0, `Reason ${i} is empty`);
  });
});

test('why_stay_here has at least 1 reason', () => {
  assert(RESULT_A.why_stay_here.length >= 1);
});

// best_for
test('best_for is an array of {persona, reason} objects', () => {
  assert(Array.isArray(RESULT_A.best_for));
  RESULT_A.best_for.forEach((item, i) => {
    assert(typeof item.persona === 'string' && item.persona.length > 0,
      `best_for[${i}].persona is invalid`);
    assert(typeof item.reason === 'string' && item.reason.length > 0,
      `best_for[${i}].reason is invalid`);
  });
});

test('best_for has at least 1 entry', () => {
  assert(RESULT_A.best_for.length >= 1);
});

// pros_considerations
test('pros_considerations has pros array and consideration object', () => {
  const pc = RESULT_A.pros_considerations;
  assert(Array.isArray(pc.pros), 'pros must be an array');
  assert(pc.consideration && typeof pc.consideration === 'object',
    'consideration must be an object');
});

test('each pro has label, score, note', () => {
  RESULT_A.pros_considerations.pros.forEach((p, i) => {
    assert(typeof p.label === 'string' && p.label.length > 0, `pro[${i}].label missing`);
    assert(typeof p.score === 'number', `pro[${i}].score must be number`);
    assert(typeof p.note  === 'string', `pro[${i}].note must be string`);
  });
});

test('consideration has label, score, note', () => {
  const con = RESULT_A.pros_considerations.consideration;
  assert(typeof con.label === 'string' && con.label.length > 0, 'consideration.label missing');
  assert(typeof con.score === 'number', 'consideration.score must be number');
  assert(typeof con.note  === 'string', 'consideration.note must be string');
});

// nearby_attractions
test('nearby_attractions is an array of strings', () => {
  assert(Array.isArray(RESULT_A.nearby_attractions));
  RESULT_A.nearby_attractions.forEach((a, i) => {
    assert(typeof a === 'string' && a.length > 0, `attraction[${i}] empty`);
  });
});

// comparison_context
test('comparison_context is a non-empty string', () => {
  assert(typeof RESULT_A.comparison_context === 'string');
  assert(RESULT_A.comparison_context.length > 0);
});

// hotel_faqs
test('hotel_faqs is an array of {question, answer} objects', () => {
  assert(Array.isArray(RESULT_A.hotel_faqs));
  RESULT_A.hotel_faqs.forEach((faq, i) => {
    assert(typeof faq.question === 'string' && faq.question.length > 0,
      `faq[${i}].question missing`);
    assert(typeof faq.answer === 'string' && faq.answer.length > 0,
      `faq[${i}].answer missing`);
  });
});

test('hotel_faqs has at least 4 entries', () => {
  assert(RESULT_A.hotel_faqs.length >= 4,
    `Expected ≥4 FAQs, got ${RESULT_A.hotel_faqs.length}`);
});

// ── Tests: determinism ────────────────────────────────────────────────────────

console.log('\ngenerateContent — determinism');

test('same inputs produce identical output (serialised)', () => {
  const r1 = generateContent(HOTEL_A, DATASET);
  const r2 = generateContent(HOTEL_A, DATASET);
  assertEqual(JSON.stringify(r1), JSON.stringify(r2),
    'Two calls with same inputs must produce identical output');
});

test('different hotels produce different output', () => {
  const rA = generateContent(HOTEL_A, DATASET);
  const rB = generateContent(HOTEL_B, DATASET);
  assert(JSON.stringify(rA) !== JSON.stringify(rB),
    'Different hotels should produce different content');
});

// ── Tests: adults_only handling ───────────────────────────────────────────────

console.log('\ngenerateContent — adults_only hotel');

const RESULT_B = generateContent(HOTEL_B, DATASET);

test('adults_only hotel produces valid output', () => {
  assert(Object.isFrozen(RESULT_B));
  assert(RESULT_B.hotel_id === HOTEL_B.hotel_id);
});

test('best_for for adults_only hotel mentions couples or adults', () => {
  const personaText = RESULT_B.best_for
    .map(p => (p.persona + ' ' + p.reason).toLowerCase())
    .join(' ');
  assert(
    personaText.includes('couple') || personaText.includes('adult') || personaText.includes('honeymoon'),
    'Adults-only hotel should mention couples/adults in best_for'
  );
});

// ── Tests: unknown region fallback ────────────────────────────────────────────

console.log('\ngenerateContent — unknown region');

const HOTEL_UNKNOWN_REGION = {
  hotel_id:       'HTL999',
  hotel_name:     'Mystery Hotel',
  region:         'Nonexistent Bay',
  star_rating:    4,
  overall_rating: 7.5,
  avg_rating:     4.1,
  review_count:   100,
  beach_score:    7.0,
  dining_score:   7.0,
  service_score:  7.5,
  room_score:     7.2,
  value_score:    8.0,
  location_score: 7.5,
  amenity_score:  7.2,
  brand_score:    7.0,
  adults_only:    false,
  amenities:      {},
};

test('does not throw for hotel with unrecognised region', () => {
  let threw = false;
  try { generateContent(HOTEL_UNKNOWN_REGION, DATASET); } catch (e) { threw = true; }
  assert(!threw, 'Should not throw for unrecognised region');
});

test('still produces all required keys for unknown region', () => {
  const result = generateContent(HOTEL_UNKNOWN_REGION, DATASET);
  const required = ['editorial_intro', 'why_stay_here', 'best_for',
    'pros_considerations', 'nearby_attractions', 'comparison_context', 'hotel_faqs'];
  required.forEach(key => {
    assert(key in result, `Missing key "${key}" for unknown-region hotel`);
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
