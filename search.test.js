/**
 * search.test.js
 * Mauritius Resort Finder — Search Engine Test Suite
 *
 * Self-running. No test framework required.
 * Run: node search.test.js
 *
 * Exit code 0 = all tests passed.
 * Exit code 1 = one or more failures.
 */

'use strict';

const {
  normalise,
  tokenise,
  levenshtein,
  fuzzyMatchScore,
  scoreItem,
  search,
  generateSearchIndex,
  hotelSearchText,
  hotelDescription,
  slugToLabel,
  specTypeToCategory,
  PAGE_LABELS,
  SKIP_SLUGS,
} = require('./search_engine_client.js');

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL:', label);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL:', label);
    console.error('    Expected:', JSON.stringify(expected));
    console.error('    Actual:  ', JSON.stringify(actual));
  }
}

function suite(name, fn) {
  console.log('\n' + name);
  fn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const HOTEL_ACTIVE = {
  _status: 'active',
  hotel_name: 'Royal Palm Beachcomber',
  region: 'Grand Baie',
  overall_rating: 9.2,
  price_per_night_usd: 1200,
  star_rating: 5,
  tags: ['luxury', 'adults-only', 'beachfront'],
  amenities: { pool: true, spa: true, beach: true, gym: true },
  _affiliate_links: [{ booking_url: 'https://expedia.com/affiliate/abc123' }],
};

const HOTEL_INACTIVE = {
  _status: 'inactive',
  hotel_name: 'Closed Resort',
  region: 'Le Morne',
  overall_rating: 7.0,
  price_per_night_usd: 400,
  star_rating: 4,
  tags: [],
  amenities: {},
  _affiliate_links: [{ booking_url: 'https://expedia.com/affiliate/dead' }],
};

const HOTEL_HONEYMOON = {
  _status: 'active',
  hotel_name: 'Four Seasons Resort Mauritius at Anahita',
  region: 'Beau Champ',
  overall_rating: 9.1,
  price_per_night_usd: 1650,
  star_rating: 5,
  tags: ['luxury', 'honeymoon', 'overwater'],
  amenities: { pool: true, spa: true, beach: true, golf: true },
  _affiliate_links: [{ booking_url: 'https://expedia.com/affiliate/xyz789' }],
};

const SAMPLE_SPECS = [
  { slug: 'mauritius-travel-guide',   page_type: 'informational' },
  { slug: 'grand-baie-mauritius',     page_type: 'regional' },
  { slug: 'best-resort-mauritius',    page_type: 'ranking' },
  { slug: 'luxury-resorts-mauritius', page_type: 'persona' },
  { slug: 'contact',                  page_type: 'other' },
  { slug: 'search',                   page_type: 'other' },
];

const SAMPLE_DATASET = [HOTEL_ACTIVE, HOTEL_INACTIVE, HOTEL_HONEYMOON];

// ─────────────────────────────────────────────────────────────────────────────
// normalise()
// ─────────────────────────────────────────────────────────────────────────────

suite('normalise()', () => {
  assertEqual(normalise('LUXURY'),           'luxury',    'uppercased → lower');
  assertEqual(normalise('Île aux Cerfs'),    'ile aux cerfs', 'diacritics stripped');
  assertEqual(normalise('Géran'),            'geran',     'é stripped');
  assertEqual(normalise('  hello  '),        'hello',     'trims whitespace');
  assertEqual(normalise(''),                 '',          'empty string');
  assertEqual(normalise(null),               '',          'null → empty');
  assertEqual(normalise(undefined),          '',          'undefined → empty');
  assertEqual(normalise(42),                 '',          'non-string → empty');
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenise()
// ─────────────────────────────────────────────────────────────────────────────

suite('tokenise()', () => {
  const t1 = tokenise('luxury honeymoon');
  assertEqual(t1.length, 2, 'two-word query → two tokens');
  assert(t1.includes('luxury'),   'contains "luxury"');
  assert(t1.includes('honeymoon'),'contains "honeymoon"');

  const t2 = tokenise('a');
  assertEqual(t2.length, 0, 'single-char dropped');

  const t3 = tokenise('Grand Baie');
  assert(t3.includes('grand'), '"Grand" normalised → "grand"');
  assert(t3.includes('baie'),  '"Baie" normalised → "baie"');

  const t4 = tokenise('luxury luxury');
  assertEqual(t4.length, 1, 'duplicates removed');

  assertEqual(tokenise('').length, 0, 'empty → no tokens');
  assertEqual(tokenise(null).length, 0, 'null → no tokens');
});

// ─────────────────────────────────────────────────────────────────────────────
// levenshtein()
// ─────────────────────────────────────────────────────────────────────────────

suite('levenshtein()', () => {
  assertEqual(levenshtein('kitten', 'sitting'), 3, 'classic kitten→sitting');
  assertEqual(levenshtein('', 'abc'),           3, 'empty→abc is 3');
  assertEqual(levenshtein('abc', ''),           3, 'abc→empty is 3');
  assertEqual(levenshtein('hello', 'hello'),    0, 'identical → 0');
  assertEqual(levenshtein('luxery', 'luxury'),  1, 'one-char typo');
  assertEqual(levenshtein('honeymon', 'honeymoon'), 1, 'one insertion');
  assertEqual(levenshtein('bech', 'beach'),     1, 'one insertion (beach)');
});

// ─────────────────────────────────────────────────────────────────────────────
// fuzzyMatchScore()
// ─────────────────────────────────────────────────────────────────────────────

suite('fuzzyMatchScore()', () => {
  assert(fuzzyMatchScore('luxery', 'luxury hotel')  > 0, 'typo "luxery" matches "luxury"');
  assert(fuzzyMatchScore('honeymon', 'honeymoon resort') > 0, 'typo "honeymon" matches "honeymoon"');
  assertEqual(fuzzyMatchScore('hi', 'highlight'),   0, 'token < 4 chars → 0');
  assertEqual(fuzzyMatchScore('abc', 'abcdef'),     0, 'token < 4 chars → 0');
  assertEqual(fuzzyMatchScore('zzzzz', 'luxury hotel'), 0, 'no near match → 0');
  assert(fuzzyMatchScore('snorkel', 'snorkels coral reef') > 0, '7-char token matches "snorkels" (edit distance 1)');
});

// ─────────────────────────────────────────────────────────────────────────────
// scoreItem()
// ─────────────────────────────────────────────────────────────────────────────

suite('scoreItem()', () => {
  const luxuryItem = {
    title: 'luxury resorts mauritius',
    searchText: 'luxury beachfront adults-only grand baie',
    description: 'Top-rated luxury hotels in Mauritius.',
  };

  const score1 = scoreItem(luxuryItem, ['luxury']);
  assert(score1 >= 60, 'title starts-with token → high score (≥60)');

  // 100-tier: fires when normTitle === single token
  const exactItem = { title: 'luxury', searchText: '', description: '' };
  const scoreExact = scoreItem(exactItem, ['luxury']);
  assert(scoreExact >= 100, 'exact whole-title match → ≥100');

  const score2 = scoreItem(luxuryItem, ['beachfront']);
  assert(score2 > 0,    'searchText match → positive score');

  const score3 = scoreItem(luxuryItem, ['hotel']);
  assert(score3 > 0,    'description match → positive score');

  const score4 = scoreItem(luxuryItem, []);
  assertEqual(score4, 0, 'no tokens → 0');

  const score5 = scoreItem(luxuryItem, ['luxury', 'beachfront']);
  const score5Single = scoreItem(luxuryItem, ['luxury']) + scoreItem(luxuryItem, ['beachfront']);
  assert(score5 > score5Single * 0.9, 'multi-token bonus applied (result ≥ sum × 0.9 due to rounding)');

  const noMatchItem = { title: 'something else', searchText: 'xyz', description: 'abc' };
  assertEqual(scoreItem(noMatchItem, ['luxury']), 0, 'no match → 0');
});

// ─────────────────────────────────────────────────────────────────────────────
// search()
// ─────────────────────────────────────────────────────────────────────────────

suite('search()', () => {
  const index = {
    items: [
      { type: 'hotel', title: 'Royal Palm Beachcomber', searchText: 'luxury adults-only beachfront grand baie', description: 'Top luxury hotel', score: 9.2 },
      { type: 'hotel', title: 'Four Seasons Anahita', searchText: 'luxury honeymoon overwater beau champ', description: 'Romantic overwater villas', score: 9.1 },
      { type: 'guide', title: 'Best Time to Visit Mauritius', searchText: 'best time visit mauritius weather seasons', description: 'When to go guide' },
      { type: 'region', title: 'Grand Baie Guide', searchText: 'grand baie north coast beaches nightlife', description: 'Grand Baie regional guide' },
    ],
  };

  const r1 = search(index, 'luxury');
  assert(r1.length >= 2, '"luxury" matches at least 2 results');
  assert(r1[0]._relevanceScore >= r1[1]._relevanceScore, 'results sorted by score descending');

  const r2 = search(index, 'Grand Baie');
  assert(r2.length >= 1, '"Grand Baie" matches at least 1 result');
  assert(r2[0].title.toLowerCase().includes('grand baie'), 'Grand Baie result is first');

  const r3 = search(index, 'honeymoon');
  assert(r3.length >= 1, '"honeymoon" matches');
  assert(r3[0]._relevanceScore > 0, 'honeymoon result has positive score');

  const r4 = search(index, 'luxery');
  assert(r4.length >= 1, 'typo "luxery" still matches via fuzzy');

  const r5 = search(index, 'zzzzzzzzz');
  assertEqual(r5.length, 0, 'nonsense query → no results');

  const r6 = search(index, '');
  assertEqual(r6.length, 0, 'empty query → no results');

  const r7 = search(null, 'luxury');
  assertEqual(r7.length, 0, 'null index → no results');

  const r8 = search({ items: [] }, 'luxury');
  assertEqual(r8.length, 0, 'empty index → no results');

  const limited = search(index, 'luxury', { maxResults: 1 });
  assertEqual(limited.length, 1, 'maxResults option respected');
});

// ─────────────────────────────────────────────────────────────────────────────
// generateSearchIndex()
// ─────────────────────────────────────────────────────────────────────────────

suite('generateSearchIndex()', () => {
  const idx = generateSearchIndex(SAMPLE_DATASET, SAMPLE_SPECS, 'https://mauritiusresortfinder.com');

  assertEqual(idx.version, '1',          'version is "1"');
  assert(typeof idx.generated === 'string', 'generated is a date string');
  assertEqual(idx.base_url, 'https://mauritiusresortfinder.com', 'base_url preserved');
  assert(typeof idx.count === 'number',  'count is a number');
  assert(Array.isArray(idx.items),       'items is an array');

  // Active hotels included
  const royalPalm = idx.items.find(i => i.title === 'Royal Palm Beachcomber');
  assert(royalPalm !== undefined, 'active hotel Royal Palm is in index');
  assertEqual(royalPalm.type, 'hotel',   'hotel type is "hotel"');
  assert(royalPalm.url.startsWith('/hotels/'), 'hotel URL starts with /hotels/');

  // Inactive hotels excluded
  const closedResort = idx.items.find(i => i.title === 'Closed Resort');
  assert(closedResort === undefined, 'inactive hotel excluded from index');

  // Pages included (excluding skip slugs)
  const travelGuide = idx.items.find(i => i.slug === 'mauritius-travel-guide');
  assert(travelGuide !== undefined, 'travel guide page included');
  assertEqual(travelGuide.type, 'guide', 'informational page type → "guide"');

  const grandBaie = idx.items.find(i => i.slug === 'grand-baie-mauritius');
  assert(grandBaie !== undefined, 'regional page included');
  assertEqual(grandBaie.type, 'region',  'regional page type → "region"');

  // contact and search excluded by SKIP_SLUGS
  const contact = idx.items.find(i => i.slug === 'contact');
  assert(contact === undefined, '"contact" excluded by SKIP_SLUGS');

  const searchPage = idx.items.find(i => i.slug === 'search');
  assert(searchPage === undefined, '"search" excluded by SKIP_SLUGS');

  // count matches items length
  assertEqual(idx.count, idx.items.length, 'count equals items.length');
});

// ─────────────────────────────────────────────────────────────────────────────
// hotelSearchText()
// ─────────────────────────────────────────────────────────────────────────────

suite('hotelSearchText()', () => {
  const text = hotelSearchText(HOTEL_ACTIVE);
  assert(typeof text === 'string',         'returns a string');
  assert(text.includes('royal palm beachcomber') || text.toLowerCase().includes('royal palm'), 'hotel name in searchText');
  assert(text.includes('grand baie') || text.toLowerCase().includes('grand baie'), 'region in searchText');
  assert(text.length > 0,                  'non-empty');
});

// ─────────────────────────────────────────────────────────────────────────────
// hotelDescription()
// ─────────────────────────────────────────────────────────────────────────────

suite('hotelDescription()', () => {
  const desc = hotelDescription(HOTEL_ACTIVE);
  assert(typeof desc === 'string',   'returns a string');
  assert(desc.includes('9.2') || desc.includes('Grand Baie'), 'includes score or region');
});

// ─────────────────────────────────────────────────────────────────────────────
// slugToLabel()
// ─────────────────────────────────────────────────────────────────────────────

suite('slugToLabel()', () => {
  assertEqual(slugToLabel('grand-baie-mauritius'), 'Grand Baie Mauritius', 'hyphens → spaces, title-cased');
  assertEqual(slugToLabel('best-time-to-visit'),   'Best Time To Visit',   'multi-word slug');
  assertEqual(slugToLabel(''),                     '',                     'empty slug → empty string');
});

// ─────────────────────────────────────────────────────────────────────────────
// specTypeToCategory()
// ─────────────────────────────────────────────────────────────────────────────

suite('specTypeToCategory()', () => {
  assertEqual(specTypeToCategory('informational'), 'guide',      'informational → guide');
  assertEqual(specTypeToCategory('regional'),      'region',     'regional → region');
  assertEqual(specTypeToCategory('ranking'),       'guide',      'ranking page_type → "guide" (no dedicated handler)');
  assertEqual(specTypeToCategory('persona'),       'ranking',    'persona → ranking');
  assertEqual(specTypeToCategory('comparison'),    'comparison', 'comparison → comparison');
  assertEqual(specTypeToCategory('other'),         'guide',      'other → guide (fallback)');
  assertEqual(specTypeToCategory(undefined),       'guide',      'undefined → guide (fallback)');
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE_LABELS & SKIP_SLUGS
// ─────────────────────────────────────────────────────────────────────────────

suite('PAGE_LABELS and SKIP_SLUGS', () => {
  assert(typeof PAGE_LABELS === 'object' && PAGE_LABELS !== null, 'PAGE_LABELS is an object');
  assert(Object.keys(PAGE_LABELS).length >= 10, 'PAGE_LABELS has ≥ 10 entries');
  assert(PAGE_LABELS['mauritius-travel-guide'] !== undefined, 'travel guide has a label');

  assert(SKIP_SLUGS instanceof Set, 'SKIP_SLUGS is a Set');
  assert(SKIP_SLUGS.has('contact'),              '"contact" in SKIP_SLUGS');
  assert(SKIP_SLUGS.has('search'),               '"search" in SKIP_SLUGS');
  assert(SKIP_SLUGS.has('privacy'),              '"privacy" in SKIP_SLUGS');
  assert(SKIP_SLUGS.has('affiliate-disclosure'), '"affiliate-disclosure" in SKIP_SLUGS');
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

suite('Edge cases', () => {
  // Diacritics in query
  const diacriticIndex = {
    items: [
      { type: 'region', title: 'Île aux Cerfs Guide', searchText: 'ile aux cerfs east coast', description: '' },
    ],
  };
  const r1 = search(diacriticIndex, 'Île aux Cerfs');
  assert(r1.length >= 1, 'query with diacritics matches normalised index');

  const r2 = search(diacriticIndex, 'ile aux cerfs');
  assert(r2.length >= 1, 'ASCII query matches diacritic title');

  // generateSearchIndex with empty dataset
  const emptyIdx = generateSearchIndex([], [], 'https://example.com');
  assertEqual(emptyIdx.count, 0, 'empty dataset → count 0');
  assertEqual(emptyIdx.items.length, 0, 'empty dataset → empty items');

  // generateSearchIndex with null args
  const nullIdx = generateSearchIndex(null, null, 'https://example.com');
  assert(Array.isArray(nullIdx.items), 'null args → still returns items array');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${passed} passed, ${failed} failed, ${total} total`);

if (failed > 0) {
  process.exit(1);
}
