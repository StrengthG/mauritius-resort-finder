/**
 * social_card_engine.test.js
 * Mauritius Resort Finder — Social Card Engine Test Suite
 *
 * Self-running. No test framework required.
 * Run: node social_card_engine.test.js
 */

'use strict';

const os   = require('os');
const fs   = require('fs');
const path = require('path');

const {
  getSellingPoint,
  buildCardSVG,
  wrapText,
  contentHash,
  getHue,
  socialCardUrl,
  generateSocialCards,
} = require('./social_card_engine.js');

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL:', label); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else {
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

const HOTEL_BASIC = {
  hotel_id:       'MQ001',
  hotel_name:     'Royal Palm Beachcomber Luxury',
  overall_rating: 9.2,
  star_rating:    5,
  region:         'Grand Baie',
  amenities:      { spa: true, private_beach: true, butler_service: true, fine_dining: true, pool: true },
  _brand_tier:    9,
};

const HOTEL_OVERWATER = {
  hotel_id:       'MQ002',
  hotel_name:     'Four Seasons Anahita',
  overall_rating: 9.1,
  star_rating:    5,
  region:         'Beau Champ',
  amenities:      { overwater_villa: true, spa: true, private_beach: true, butler_service: true },
  _brand_tier:    10,
};

const HOTEL_ADULTS = {
  hotel_id:       'MQ010',
  hotel_name:     'Paradise Cove Boutique Hotel Adults Only',
  overall_rating: 9.0,
  star_rating:    5,
  region:         'Cap Malheureux',
  amenities:      { adults_only: true, spa: true, private_beach: true },
  _brand_tier:    7,
};

const HOTEL_FAMILY = {
  hotel_id:       'MQ020',
  hotel_name:     'Club Med La Plantation D\'Or',
  overall_rating: 8.4,
  star_rating:    4,
  region:         'Flic en Flac',
  amenities:      { kids_club: true, water_sports: true, pool: true, all_inclusive: true },
  _brand_tier:    6,
};

const HOTEL_GOLF = {
  hotel_id:       'MQ015',
  hotel_name:     'Heritage Awali Golf & Spa Resort',
  overall_rating: 8.4,
  star_rating:    5,
  region:         'Bel Ombre',
  amenities:      { golf: true, spa: true, private_beach: true, butler_service: false },
  _brand_tier:    7,
};

const HOTEL_WELLNESS = {
  hotel_id:       'MQ030',
  hotel_name:     'Shanti Maurice Resort & Spa',
  overall_rating: 8.8,
  star_rating:    5,
  region:         'Saint Felix',
  amenities:      { wellness_programmes: true, yoga: true, spa: true, naturopath: true },
  _brand_tier:    8,
};

const BASE_URL = 'https://mauritiusresortfinder.com';

// ─────────────────────────────────────────────────────────────────────────────
// wrapText
// ─────────────────────────────────────────────────────────────────────────────

suite('wrapText', function () {
  const single = wrapText('Short name', 32);
  assert(Array.isArray(single),       'returns an array');
  assertEqual(single.length, 1,       'single line for short text');
  assertEqual(single[0], 'Short name', 'content preserved');

  const multi = wrapText('Royal Palm Beachcomber Luxury Resort Mauritius', 32);
  assert(multi.length >= 2,           'wraps long text onto multiple lines');
  assert(multi.every(l => l.length <= 32 + 10), 'lines respect max chars (±word boundary)');

  const empty = wrapText('', 32);
  assert(Array.isArray(empty),        'handles empty string without crash');

  const oneWord = wrapText('Constance', 32);
  assertEqual(oneWord.length, 1,      'single word stays on one line');
  assertEqual(oneWord[0], 'Constance', 'single word preserved');
});

// ─────────────────────────────────────────────────────────────────────────────
// contentHash
// ─────────────────────────────────────────────────────────────────────────────

suite('contentHash', function () {
  const h1 = contentHash({ a: 1 });
  const h2 = contentHash({ a: 1 });
  const h3 = contentHash({ a: 2 });

  assertEqual(h1, h2,     'same input → same hash (deterministic)');
  assert(h1 !== h3,       'different input → different hash');
  assertEqual(h1.length, 16, 'hash is 16 hex chars');
  assert(/^[0-9a-f]+$/.test(h1), 'hash is hex string');
});

// ─────────────────────────────────────────────────────────────────────────────
// getHue
// ─────────────────────────────────────────────────────────────────────────────

suite('getHue', function () {
  const hue = getHue('MQ001');
  assert(typeof hue === 'number',   'returns a number');
  assert(hue >= 0 && hue <= 360,   'hue is in 0-360 range');

  const hueUnknown = getHue('ZZZZZZ_MISSING');
  assert(typeof hueUnknown === 'number', 'fallback for unknown hotel returns number');
  assert(hueUnknown >= 170 && hueUnknown <= 229, 'fallback hue in range 170-229');

  const h1 = getHue('ALPHA');
  const h2 = getHue('ALPHA');
  assertEqual(h1, h2, 'same hotel_id → same hue (deterministic)');

  const h3 = getHue('BETA');
  // ALPHA and BETA could theoretically collide, but almost never do
  assert(typeof h3 === 'number', 'different hotel produces a valid hue');
});

// ─────────────────────────────────────────────────────────────────────────────
// getSellingPoint
// ─────────────────────────────────────────────────────────────────────────────

suite('getSellingPoint', function () {
  const ptOverwater = getSellingPoint(HOTEL_OVERWATER);
  assert(ptOverwater.toLowerCase().includes('overwater'),
    'overwater villa hotel mentions "overwater"');

  const ptAdults = getSellingPoint(HOTEL_ADULTS);
  assert(ptAdults.toLowerCase().includes('adults'),
    'adults-only hotel mentions "adults"');

  // HOTEL_FAMILY has all_inclusive which hits before kids_club check — that's correct
  const ptFamily = getSellingPoint(HOTEL_FAMILY);
  assert(typeof ptFamily === 'string' && ptFamily.length > 0,
    'family hotel returns a non-empty selling point');
  // A family hotel without all_inclusive should mention family/kids
  const ptFamilyOnly = getSellingPoint({ amenities: { kids_club: true, water_sports: true }, overall_rating: 8 });
  assert(ptFamilyOnly.toLowerCase().includes('famil') || ptFamilyOnly.toLowerCase().includes('kids'),
    'kids_club + water_sports hotel mentions "family" or "kids"');

  const ptGolf = getSellingPoint(HOTEL_GOLF);
  assert(ptGolf.toLowerCase().includes('golf'),
    'golf resort mentions "golf"');

  const ptWellness = getSellingPoint(HOTEL_WELLNESS);
  assert(
    ptWellness.toLowerCase().includes('wellness') ||
    ptWellness.toLowerCase().includes('spa') ||
    ptWellness.toLowerCase().includes('yoga'),
    'wellness hotel mentions wellness/spa/yoga'
  );

  const ptBasic = getSellingPoint(HOTEL_BASIC);
  assert(typeof ptBasic === 'string' && ptBasic.length > 0,
    'returns a non-empty string for basic hotel');

  const ptMinimal = getSellingPoint({ hotel_id: 'X', amenities: {}, overall_rating: 7 });
  assert(typeof ptMinimal === 'string' && ptMinimal.length > 0,
    'returns fallback string for hotel with no special amenities');
});

// ─────────────────────────────────────────────────────────────────────────────
// socialCardUrl
// ─────────────────────────────────────────────────────────────────────────────

suite('socialCardUrl', function () {
  const hotelUrl = socialCardUrl('MQ001', BASE_URL);
  assert(hotelUrl.startsWith(BASE_URL),          'hotel URL starts with baseUrl');
  assert(hotelUrl.endsWith('MQ001.svg'),          'hotel URL ends with hotel_id.svg');
  assert(hotelUrl.includes('/assets/social/'),    'URL contains /assets/social/');

  const genericUrl = socialCardUrl(null, BASE_URL);
  assert(genericUrl.endsWith('generic.svg'),      'null hotel_id → generic.svg');

  const trailingSlash = socialCardUrl('MQ001', BASE_URL + '/');
  assert(!trailingSlash.includes('//assets'),     'trailing slash on baseUrl normalised');

  const withoutBase = socialCardUrl('MQ001', '');
  assert(withoutBase.includes('MQ001.svg'),       'works with empty baseUrl');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCardSVG — hotel card
// ─────────────────────────────────────────────────────────────────────────────

suite('buildCardSVG — hotel card', function () {
  const svg = buildCardSVG({
    hotelId:      'MQ001',
    hotelName:    'Royal Palm Beachcomber Luxury',
    rating:       9.2,
    region:       'Grand Baie',
    starRating:   5,
    sellingPoint: 'Pristine private beach & world-class spa',
    hue:          205,
    isGeneric:    false,
  });

  assert(svg.startsWith('<?xml'),          'starts with XML declaration');
  assert(svg.includes('<svg'),             'contains svg element');
  assert(svg.includes('width="1200"'),     'has correct width');
  assert(svg.includes('height="630"'),     'has correct height');
  assert(svg.includes('viewBox="0 0 1200 630"'), 'has correct viewBox');
  assert(svg.includes('Royal Palm'),       'hotel name in card');
  assert(svg.includes('9.2'),             'rating in card');
  assert(svg.includes('GRAND BAIE'),       'region in uppercase in card');
  assert(svg.includes('private beach') || svg.includes('Pristine'), 'selling point present');
  assert(svg.includes('mauritiusresortfinder.com'), 'brand URL in card');
  assert(svg.includes('MRF'),             'logo mark in card');
  assert(svg.includes('RATING'),          'rating label in card');
  assert(svg.includes('url(#bg)'),        'background gradient applied');
  assert(svg.includes('url(#gold-v)'),    'gold accent bar applied');
  assert(!svg.includes('<script'),        'no script tags (safe)');
  assert(!svg.includes('onerror'),        'no event handlers (XSS safe)');
  assert(svg.includes('</svg>'),          'SVG is properly closed');
});

suite('buildCardSVG — hotel card XSS safety', function () {
  const xss = '<script>alert(1)</script>';
  const svg = buildCardSVG({
    hotelId:      'MQ999',
    hotelName:    xss,
    rating:       8.0,
    region:       xss,
    starRating:   5,
    sellingPoint: xss,
    hue:          200,
    isGeneric:    false,
  });
  // esc() encodes < > so <script> becomes &lt;script&gt; — alert(1) text may
  // still appear as encoded text, but is not executable as HTML/JS
  assert(!svg.includes('<script>'),       'unescaped script tag not injected');
  assert(!svg.includes('</script>'),      'unescaped closing script tag not present');
  assert(svg.includes('&lt;script&gt;') || !svg.includes('<script>'), 'angle brackets are entity-escaped');
});

suite('buildCardSVG — name wrapping', function () {
  const longName = 'Paradise Cove Boutique Hotel Adults Only';
  const svg = buildCardSVG({
    hotelId:      'MQ010',
    hotelName:    longName,
    rating:       9.0,
    region:       'Cap Malheureux',
    starRating:   5,
    sellingPoint: 'Exclusive adults-only hideaway',
    hue:          195,
    isGeneric:    false,
  });
  assert(svg.includes('Paradise Cove'),  'first line of name present');
  assert(svg.includes('Adults Only') || svg.includes('Boutique'), 'wrapped line present');
  assert(svg.includes('</svg>'),         'SVG closes correctly after long name');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCardSVG — generic card
// ─────────────────────────────────────────────────────────────────────────────

suite('buildCardSVG — generic card', function () {
  const svg = buildCardSVG({
    hotelId:      '__generic__',
    hotelName:    '',
    rating:       null,
    region:       '',
    starRating:   5,
    sellingPoint: '',
    hue:          205,
    isGeneric:    true,
  });

  assert(svg.includes('<svg'),                  'valid SVG element');
  assert(svg.includes('Mauritius Resort'),      'site name in generic card');
  assert(svg.includes('Finder'),                'site name part 2 in generic card');
  assert(svg.includes('36 RESORTS'),            'hotel count in generic card');
  assert(svg.includes('mauritiusresortfinder.com'), 'brand URL in generic card');
  assert(!svg.includes('RATING'),              'no rating badge on generic card');
  assert(!svg.includes('/10'),                 'no rating value on generic card');
  assert(svg.includes('</svg>'),               'generic SVG closes correctly');
});

// ─────────────────────────────────────────────────────────────────────────────
// generateSocialCards
// ─────────────────────────────────────────────────────────────────────────────

suite('generateSocialCards — writes files to outDir', function () {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrf-social-test-'));

  const hotels = [HOTEL_BASIC, HOTEL_OVERWATER];
  const result = generateSocialCards(hotels, tmpDir);

  assert(typeof result === 'object',           'returns stats object');
  assert(typeof result.generated === 'number', 'has generated count');
  assert(typeof result.cached    === 'number', 'has cached count');
  assert(typeof result.total     === 'number', 'has total count');
  assertEqual(result.total, 3,                 'total = 2 hotels + 1 generic');

  const socialDir = path.join(tmpDir, 'assets', 'social');
  assert(fs.existsSync(socialDir),                              'social/ directory created');
  assert(fs.existsSync(path.join(socialDir, 'MQ001.svg')),      'MQ001.svg written');
  assert(fs.existsSync(path.join(socialDir, 'MQ002.svg')),      'MQ002.svg written');
  assert(fs.existsSync(path.join(socialDir, 'generic.svg')),    'generic.svg written');

  // Validate file contents
  const mq1Svg = fs.readFileSync(path.join(socialDir, 'MQ001.svg'), 'utf8');
  assert(mq1Svg.startsWith('<?xml'),   'MQ001.svg starts with XML declaration');
  assert(mq1Svg.includes('Royal Palm'), 'MQ001.svg contains hotel name');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

suite('generateSocialCards — cache skips unchanged hotels', function () {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'mrf-social-cache-'));
  const hotels  = [HOTEL_BASIC];

  // First run — generates everything
  const run1 = generateSocialCards(hotels, tmpDir);
  assert(run1.generated >= 1,             'first run generates cards');

  // Second run — all cached
  const run2 = generateSocialCards(hotels, tmpDir);
  assertEqual(run2.generated, 0,          'second run generates nothing (cached)');
  assertEqual(run2.cached,    run1.total, 'all cards reported as cached');

  // Mutate a hotel — should regenerate that hotel
  const mutated = [{ ...HOTEL_BASIC, overall_rating: 9.5 }];
  const run3 = generateSocialCards(mutated, tmpDir);
  assert(run3.generated >= 1,             'mutated hotel causes regeneration');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

suite('generateSocialCards — empty hotels array', function () {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrf-social-empty-'));
  const result = generateSocialCards([], tmpDir);

  assertEqual(result.total, 1,            'total = 1 (generic card only)');
  assert(
    fs.existsSync(path.join(tmpDir, 'assets', 'social', 'generic.svg')),
    'generic.svg still generated with empty hotel array'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────────────────────────────────');
console.log('social_card_engine.test.js:', passed, 'passed,', failed, 'failed');
console.log('─────────────────────────────────────────────────────────────');

if (failed > 0) process.exit(1);
