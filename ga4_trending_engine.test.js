/**
 * ga4_trending_engine.test.js
 * Tests for the GA4 Trending Engine (pure-function coverage; no network calls).
 */

'use strict';

const {
  _buildJWT,
  _isCacheFresh,
  _buildSlugMap,
  _parsePageViewResponse,
  _parseEventResponse,
  _calculateTrending,
  _calculateFastestGrowing,
  _calculateMostCompared,
  _calculateMostSaved,
  _defaultData,
  _slugify,
  _base64url,
  generateTrendingData,
  CACHE_TTL_MS,
  MAX_TRENDING,
  MAX_GROWING,
  MAX_COMPARED,
  MAX_SAVED,
} = require('./ga4_trending_engine.js');

const crypto = require('crypto');

// ── Test runner (mirrors pattern used elsewhere in this project) ──────────────

let _passed = 0;
let _failed = 0;
const _failures = [];

function test(name, fn) {
  try {
    fn();
    _passed++;
  } catch (err) {
    _failed++;
    _failures.push({ name, msg: err.message });
    process.stdout.write(`  ✗ ${name}: ${err.message}\n`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertDeepEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg || `deep-equal failed:\nA: ${JSON.stringify(a)}\nB: ${JSON.stringify(b)}`);
  }
}

function assertThrows(fn, msgContains) {
  try { fn(); throw new Error('expected throw but did not'); }
  catch (e) {
    if (e.message === 'expected throw but did not') throw e;
    if (msgContains && !e.message.includes(msgContains)) {
      throw new Error(`expected error containing "${msgContains}", got "${e.message}"`);
    }
  }
}

// ── Sample data ───────────────────────────────────────────────────────────────

const HOTEL_A = {
  hotel_id:       'MQ001',
  hotel_name:     'Royal Palm Beachcomber Luxury',
  overall_rating: 9.2,
  star_rating:    5,
  region:         'Grand Baie',
  _status:        'active',
  amenities:      { spa: true, private_beach: true },
};

const HOTEL_B = {
  hotel_id:       'MQ002',
  hotel_name:     'Four Seasons Resort Mauritius at Anahita',
  overall_rating: 9.1,
  star_rating:    5,
  region:         'Beau Champ',
  _status:        'active',
  amenities:      { overwater_villa: true },
};

const HOTEL_C = {
  hotel_id:       'MQ003',
  hotel_name:     'One&Only Le Saint Géran',
  overall_rating: 9.0,
  star_rating:    5,
  region:         'Belle Mare',
  _status:        'active',
  amenities:      { adults_only: true, spa: true },
};

const HOTEL_INACTIVE = {
  hotel_id:       'MQ099',
  hotel_name:     'Closed Hotel',
  overall_rating: 7.0,
  star_rating:    3,
  region:         'Port Louis',
  _status:        'inactive',
  amenities:      {},
};

const SAMPLE_HOTELS = [HOTEL_A, HOTEL_B, HOTEL_C, HOTEL_INACTIVE];

// ── Fake RSA key pair for JWT tests ──────────────────────────────────────────

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const FAKE_SA_KEY = {
  client_email: 'test@project.iam.gserviceaccount.com',
  private_key:  privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: _base64url
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _base64url\n');

test('encodes string without padding', () => {
  const result = _base64url('hello');
  assert(!result.includes('='), 'no padding');
  assert(!result.includes('+'), 'no +');
  assert(!result.includes('/'), 'no /');
});

test('encodes JSON consistently', () => {
  const a = _base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const b = _base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  assertEqual(a, b, 'should be idempotent');
});

test('uses base64url alphabet only', () => {
  const result = _base64url('Man is distinguished from brute');
  assert(/^[A-Za-z0-9\-_]+$/.test(result), 'only base64url chars');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: _buildJWT
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _buildJWT\n');

test('produces three-part JWT', () => {
  const jwt    = _buildJWT(FAKE_SA_KEY);
  const parts  = jwt.split('.');
  assertEqual(parts.length, 3, '3 parts (header.payload.signature)');
});

test('header decodes to RS256 JWT', () => {
  const jwt    = _buildJWT(FAKE_SA_KEY);
  const header = JSON.parse(Buffer.from(jwt.split('.')[0], 'base64').toString('utf8'));
  assertEqual(header.alg, 'RS256');
  assertEqual(header.typ, 'JWT');
});

test('payload contains required fields', () => {
  const jwt     = _buildJWT(FAKE_SA_KEY);
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
  assertEqual(payload.iss, FAKE_SA_KEY.client_email);
  assert(payload.exp > payload.iat, 'exp > iat');
  assert(payload.scope.includes('analytics'), 'analytics scope');
  assert(payload.aud.includes('oauth2'), 'google auth audience');
});

test('signature is RS256-verifiable', () => {
  const jwt    = _buildJWT(FAKE_SA_KEY);
  const [h, p, sig] = jwt.split('.');
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(`${h}.${p}`, 'utf8');
  const sigBuf = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const valid  = verify.verify(publicKey, sigBuf);
  assert(valid, 'signature must verify with matching public key');
});

test('throws on missing client_email', () => {
  assertThrows(() => _buildJWT({ private_key: FAKE_SA_KEY.private_key }), 'client_email');
});

test('throws on missing private_key', () => {
  assertThrows(() => _buildJWT({ client_email: FAKE_SA_KEY.client_email }), 'private_key');
});

test('throws on null key', () => {
  assertThrows(() => _buildJWT(null), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: _isCacheFresh
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _isCacheFresh\n');

test('returns false for null', () => {
  assert(!_isCacheFresh(null), 'null → not fresh');
});

test('returns false for missing generated_at', () => {
  assert(!_isCacheFresh({ trending: [] }), 'no generated_at → not fresh');
});

test('returns true for recent timestamp', () => {
  const cache = { generated_at: new Date().toISOString() };
  assert(_isCacheFresh(cache), 'just-written cache should be fresh');
});

test('returns false for old timestamp', () => {
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();  // 25h ago
  assert(!_isCacheFresh({ generated_at: old }), '25h old cache should be stale');
});

test('returns true just under TTL', () => {
  const recent = new Date(Date.now() - (CACHE_TTL_MS - 60000)).toISOString();  // 1 minute before expiry
  assert(_isCacheFresh({ generated_at: recent }), 'under TTL → fresh');
});

test('returns false just over TTL', () => {
  const old = new Date(Date.now() - (CACHE_TTL_MS + 60000)).toISOString();  // 1 minute after expiry
  assert(!_isCacheFresh({ generated_at: old }), 'over TTL → stale');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: _buildSlugMap
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _buildSlugMap\n');

test('maps hotel slug path to hotel_id', () => {
  const map = _buildSlugMap([HOTEL_A]);
  assertEqual(map.get('/hotels/royal-palm-beachcomber-luxury/'), 'MQ001');
});

test('handles accented names', () => {
  const map = _buildSlugMap([HOTEL_C]);
  // _slugify strips accents: "One&Only Le Saint Géran" → "one-and-only-le-saint-g-ran"
  assert(map.size === 1, 'one entry');
  const key = [...map.keys()][0];
  assert(key.startsWith('/hotels/'), 'path format');
  assert(key.endsWith('/'), 'trailing slash');
});

test('maps multiple hotels', () => {
  const map = _buildSlugMap([HOTEL_A, HOTEL_B, HOTEL_C]);
  assertEqual(map.size, 3);
  assertEqual(map.get('/hotels/royal-palm-beachcomber-luxury/'), 'MQ001');
  assertEqual(map.get('/hotels/four-seasons-resort-mauritius-at-anahita/'), 'MQ002');
});

test('skips hotels with no hotel_id', () => {
  const map = _buildSlugMap([HOTEL_A, { hotel_name: 'Unnamed', overall_rating: 8.0 }]);
  assertEqual(map.size, 1, 'only one valid hotel');
});

test('skips hotels with no hotel_name', () => {
  const map = _buildSlugMap([HOTEL_A, { hotel_id: 'MQ099' }]);
  assertEqual(map.size, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5: _parsePageViewResponse
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _parsePageViewResponse\n');

function makePageViewRow(path, dateRange, views) {
  return {
    dimensionValues: [{ value: path }, { value: dateRange }],
    metricValues:    [{ value: String(views) }],
  };
}

test('returns empty maps for null response', () => {
  const { current, previous } = _parsePageViewResponse(null);
  assertEqual(current.size, 0);
  assertEqual(previous.size, 0);
});

test('returns empty maps for no rows', () => {
  const { current, previous } = _parsePageViewResponse({ rows: [] });
  assertEqual(current.size, 0);
  assertEqual(previous.size, 0);
});

test('parses current period rows', () => {
  const resp = {
    rows: [makePageViewRow('/hotels/royal-palm/', 'current', 150)],
  };
  const { current } = _parsePageViewResponse(resp);
  assertEqual(current.get('/hotels/royal-palm/'), 150);
});

test('parses previous period rows', () => {
  const resp = {
    rows: [makePageViewRow('/hotels/royal-palm/', 'previous', 90)],
  };
  const { previous } = _parsePageViewResponse(resp);
  assertEqual(previous.get('/hotels/royal-palm/'), 90);
});

test('ignores non-hotel paths', () => {
  const resp = {
    rows: [
      makePageViewRow('/best-luxury-hotels/', 'current', 500),
      makePageViewRow('/hotels/royal-palm/', 'current', 150),
    ],
  };
  const { current } = _parsePageViewResponse(resp);
  assertEqual(current.size, 1, 'only hotel paths included');
});

test('accumulates views for same path', () => {
  const resp = {
    rows: [
      makePageViewRow('/hotels/royal-palm/', 'current', 100),
      makePageViewRow('/hotels/royal-palm/', 'current', 50),
    ],
  };
  const { current } = _parsePageViewResponse(resp);
  assertEqual(current.get('/hotels/royal-palm/'), 150);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6: _parseEventResponse
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _parseEventResponse\n');

function makeEventRow(eventName, hotelId, count) {
  return {
    dimensionValues: [{ value: eventName }, { value: hotelId }],
    metricValues:    [{ value: String(count) }],
  };
}

test('returns empty maps for null', () => {
  const { clicks, wishlist, compares } = _parseEventResponse(null);
  assertEqual(clicks.size, 0);
  assertEqual(wishlist.size, 0);
  assertEqual(compares.size, 0);
});

test('parses resort_click events', () => {
  const resp = { rows: [makeEventRow('resort_click', 'MQ001', 42)] };
  const { clicks } = _parseEventResponse(resp);
  assertEqual(clicks.get('MQ001'), 42);
});

test('parses wishlist_add events', () => {
  const resp = { rows: [makeEventRow('wishlist_add', 'MQ002', 17)] };
  const { wishlist } = _parseEventResponse(resp);
  assertEqual(wishlist.get('MQ002'), 17);
});

test('parses compare_add events', () => {
  const resp = { rows: [makeEventRow('compare_add', 'MQ003', 8)] };
  const { compares } = _parseEventResponse(resp);
  assertEqual(compares.get('MQ003'), 8);
});

test('skips (not set) hotel_id', () => {
  const resp = { rows: [makeEventRow('resort_click', '(not set)', 99)] };
  const { clicks } = _parseEventResponse(resp);
  assertEqual(clicks.size, 0);
});

test('skips empty hotel_id', () => {
  const resp = { rows: [makeEventRow('wishlist_add', '', 5)] };
  const { wishlist } = _parseEventResponse(resp);
  assertEqual(wishlist.size, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7: _calculateTrending
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _calculateTrending\n');

test('returns empty array for no data', () => {
  const result = _calculateTrending(new Map(), {
    clicks:   new Map(),
    wishlist: new Map(),
    compares: new Map(),
  }, SAMPLE_HOTELS);
  assert(Array.isArray(result), 'is array');
  assertEqual(result.length, 0, 'no scored hotels → empty');
});

test('ranks hotel with most signals highest', () => {
  const pageViews = new Map([
    ['/hotels/royal-palm-beachcomber-luxury/',              500],
    ['/hotels/four-seasons-resort-mauritius-at-anahita/', 100],
  ]);
  const events = { clicks: new Map(), wishlist: new Map(), compares: new Map() };
  const result = _calculateTrending(pageViews, events, [HOTEL_A, HOTEL_B]);

  assertEqual(result[0].hotel_id, 'MQ001', 'MQ001 has most views');
  assertEqual(result[1].hotel_id, 'MQ002');
});

test('wishlist signals outweigh page views (weight 5 vs 1)', () => {
  const pageViews = new Map([
    ['/hotels/royal-palm-beachcomber-luxury/', 100],
  ]);
  const events = {
    clicks:   new Map(),
    wishlist: new Map([['MQ002', 100]]),  // 100 * 5 = 500 > 100 * 1
    compares: new Map(),
  };
  const result = _calculateTrending(pageViews, events, [HOTEL_A, HOTEL_B]);
  assertEqual(result[0].hotel_id, 'MQ002', 'MQ002 wins on wishlist weight');
});

test('top hotel has score of 100', () => {
  const pageViews = new Map([
    ['/hotels/royal-palm-beachcomber-luxury/', 200],
    ['/hotels/four-seasons-resort-mauritius-at-anahita/', 100],
  ]);
  const events = { clicks: new Map(), wishlist: new Map(), compares: new Map() };
  const result = _calculateTrending(pageViews, events, [HOTEL_A, HOTEL_B]);
  assertEqual(result[0].score, 100, 'top hotel scores 100');
});

test('limits output to MAX_TRENDING', () => {
  const hotels = Array.from({ length: 20 }, (_, i) => ({
    hotel_id:       `MQ${100 + i}`,
    hotel_name:     `Hotel ${i}`,
    overall_rating: 8.0 + (i * 0.01),
    star_rating:    5,
    region:         'Grand Baie',
    _status:        'active',
    amenities:      {},
  }));
  const pageViews = new Map(hotels.map(h => [
    `/hotels/${_slugify(h.hotel_name)}/`, Math.floor(Math.random() * 100) + 10,
  ]));
  const events = { clicks: new Map(), wishlist: new Map(), compares: new Map() };
  const result = _calculateTrending(pageViews, events, hotels);
  assert(result.length <= MAX_TRENDING, `max ${MAX_TRENDING} results`);
});

test('result includes slug, region, rating', () => {
  const pageViews = new Map([['/hotels/royal-palm-beachcomber-luxury/', 100]]);
  const events = { clicks: new Map(), wishlist: new Map(), compares: new Map() };
  const result = _calculateTrending(pageViews, events, [HOTEL_A]);
  assert(result.length > 0);
  assertEqual(result[0].slug, 'royal-palm-beachcomber-luxury');
  assertEqual(result[0].region, 'Grand Baie');
  assertEqual(result[0].rating, 9.2);
});

test('ignores paths that do not map to any hotel', () => {
  const pageViews = new Map([['/hotels/nonexistent-hotel/', 1000]]);
  const events = { clicks: new Map(), wishlist: new Map(), compares: new Map() };
  const result = _calculateTrending(pageViews, events, [HOTEL_A]);
  assertEqual(result.length, 0, 'unmapped path produces no result');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8: _calculateFastestGrowing
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _calculateFastestGrowing\n');

test('returns empty for empty inputs', () => {
  const result = _calculateFastestGrowing(new Map(), new Map(), SAMPLE_HOTELS);
  assertEqual(result.length, 0);
});

test('calculates positive growth correctly', () => {
  const cur  = new Map([['/hotels/royal-palm-beachcomber-luxury/', 200]]);
  const prev = new Map([['/hotels/royal-palm-beachcomber-luxury/', 100]]);
  const result = _calculateFastestGrowing(cur, prev, [HOTEL_A]);
  assertEqual(result[0].hotel_id, 'MQ001');
  assertEqual(result[0].growth_pct, 100, '100% growth');
  assertEqual(result[0].current_views, 200);
  assertEqual(result[0].prev_views, 100);
});

test('ranks higher growth percentage first', () => {
  const cur  = new Map([
    ['/hotels/royal-palm-beachcomber-luxury/',              100],
    ['/hotels/four-seasons-resort-mauritius-at-anahita/', 150],
  ]);
  const prev = new Map([
    ['/hotels/royal-palm-beachcomber-luxury/',              50],   // 100% growth
    ['/hotels/four-seasons-resort-mauritius-at-anahita/', 50],   // 200% growth
  ]);
  const result = _calculateFastestGrowing(cur, prev, [HOTEL_A, HOTEL_B]);
  assertEqual(result[0].hotel_id, 'MQ002', 'MQ002 has higher growth');
});

test('handles new hotel with no previous views', () => {
  const cur  = new Map([['/hotels/royal-palm-beachcomber-luxury/', 50]]);
  const prev = new Map();
  const result = _calculateFastestGrowing(cur, prev, [HOTEL_A]);
  assertEqual(result[0].hotel_id, 'MQ001');
  assertEqual(result[0].growth_pct, 999, 'no prev → 999% sentinel');
});

test('suppresses low-volume hotels (< 5 views)', () => {
  const cur  = new Map([['/hotels/royal-palm-beachcomber-luxury/', 3]]);
  const prev = new Map([['/hotels/royal-palm-beachcomber-luxury/', 1]]);
  const result = _calculateFastestGrowing(cur, prev, [HOTEL_A]);
  assertEqual(result.length, 0, 'below minimum view threshold');
});

test('limits output to MAX_GROWING', () => {
  const hotels = Array.from({ length: 20 }, (_, i) => ({
    hotel_id:       `MQ${200 + i}`,
    hotel_name:     `Growing Hotel ${i}`,
    overall_rating: 8.0,
    star_rating:    5,
    region:         'Grand Baie',
    _status:        'active',
    amenities:      {},
  }));
  const cur  = new Map(hotels.map((h, i) => [`/hotels/${_slugify(h.hotel_name)}/`, 50 + i]));
  const prev = new Map(hotels.map((h)    => [`/hotels/${_slugify(h.hotel_name)}/`, 10]));
  const result = _calculateFastestGrowing(cur, prev, hotels);
  assert(result.length <= MAX_GROWING, `max ${MAX_GROWING}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 9: _calculateMostCompared / _calculateMostSaved
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _calculateMostCompared / _calculateMostSaved\n');

test('most compared: sorts by count desc', () => {
  const events = {
    clicks:   new Map(),
    wishlist: new Map(),
    compares: new Map([['MQ001', 40], ['MQ002', 80], ['MQ003', 20]]),
  };
  const result = _calculateMostCompared(events, SAMPLE_HOTELS);
  assertEqual(result[0].hotel_id, 'MQ002', 'highest compare count first');
  assertEqual(result[0].compare_count, 80);
  assertEqual(result[1].hotel_id, 'MQ001');
  assertEqual(result[2].hotel_id, 'MQ003');
});

test('most compared: returns empty for no data', () => {
  const events = { clicks: new Map(), wishlist: new Map(), compares: new Map() };
  const result = _calculateMostCompared(events, SAMPLE_HOTELS);
  assertEqual(result.length, 0);
});

test('most saved: sorts by count desc', () => {
  const events = {
    clicks:   new Map(),
    wishlist: new Map([['MQ001', 10], ['MQ003', 55]]),
    compares: new Map(),
  };
  const result = _calculateMostSaved(events, SAMPLE_HOTELS);
  assertEqual(result[0].hotel_id, 'MQ003');
  assertEqual(result[0].save_count, 55);
  assertEqual(result[1].hotel_id, 'MQ001');
});

test('most compared: limits to MAX_COMPARED', () => {
  const compares = new Map(
    Array.from({ length: 20 }, (_, i) => [`MQ${100 + i}`, 100 - i])
  );
  const manyHotels = Array.from({ length: 20 }, (_, i) => ({
    hotel_id: `MQ${100 + i}`, hotel_name: `H${i}`, region: 'GB', _status: 'active', amenities: {},
  }));
  const result = _calculateMostCompared({ clicks: new Map(), wishlist: new Map(), compares }, manyHotels);
  assert(result.length <= MAX_COMPARED);
});

test('skips unknown hotel_ids in events', () => {
  const events = {
    clicks:   new Map(),
    wishlist: new Map(),
    compares: new Map([['UNKNOWN_ID', 99]]),
  };
  const result = _calculateMostCompared(events, [HOTEL_A]);
  assertEqual(result.length, 0, 'unknown hotel_id filtered out');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 10: _defaultData
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _defaultData\n');

test('returns valid structure', () => {
  const data = _defaultData(SAMPLE_HOTELS);
  assert(data.generated_at, 'has generated_at');
  assertEqual(data.source, 'default');
  assert(Array.isArray(data.trending), 'trending is array');
  assert(Array.isArray(data.fastest_growing), 'fastest_growing is array');
  assert(Array.isArray(data.most_compared), 'most_compared is array');
  assert(Array.isArray(data.most_saved), 'most_saved is array');
});

test('excludes inactive hotels', () => {
  const data = _defaultData(SAMPLE_HOTELS);
  const allIds = [
    ...data.trending.map(h => h.hotel_id),
    ...data.fastest_growing.map(h => h.hotel_id),
    ...data.most_compared.map(h => h.hotel_id),
    ...data.most_saved.map(h => h.hotel_id),
  ];
  assert(!allIds.includes('MQ099'), 'inactive hotel not in any list');
});

test('trending sorted by rating descending', () => {
  const data = _defaultData([HOTEL_A, HOTEL_B, HOTEL_C]);
  assert(data.trending[0].rating >= data.trending[1].rating, 'descending rating');
});

test('works with empty hotel array', () => {
  const data = _defaultData([]);
  assertEqual(data.trending.length, 0);
  assertEqual(data.fastest_growing.length, 0);
});

test('all trending items have required fields', () => {
  const data = _defaultData(SAMPLE_HOTELS);
  for (const h of data.trending) {
    assert(h.hotel_id, 'has hotel_id');
    assert(h.name,     'has name');
    assert(h.slug,     'has slug');
    assert('score' in h, 'has score');
  }
});

test('all fastest_growing items have growth_pct', () => {
  const data = _defaultData(SAMPLE_HOTELS);
  for (const h of data.fastest_growing) {
    assert('growth_pct' in h, 'has growth_pct');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 11: generateTrendingData (no API credentials)
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  generateTrendingData (no credentials)\n');

const origPropertyId = process.env.GA4_PROPERTY_ID;
const origSaKey      = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

test('returns default data when no env vars set', async () => {
  delete process.env.GA4_PROPERTY_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  const data = await generateTrendingData(SAMPLE_HOTELS);
  assert(data.source === 'default' || data.source === 'cache' || data.source === 'cache_stale',
    'valid source value');
  assert(Array.isArray(data.trending), 'trending is array');
  assert(Array.isArray(data.fastest_growing), 'fastest_growing is array');
});

test('result has generated_at ISO timestamp', async () => {
  const data = await generateTrendingData(SAMPLE_HOTELS);
  assert(data.generated_at, 'has generated_at');
  assert(!isNaN(new Date(data.generated_at).getTime()), 'valid ISO date');
});

test('works with empty hotels array', async () => {
  const data = await generateTrendingData([]);
  assert(Array.isArray(data.trending), 'array even for empty input');
});

// Restore env vars
process.env.GA4_PROPERTY_ID            = origPropertyId || '';
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = origSaKey      || '';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 12: _slugify (engine's copy)
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n  _slugify\n');

test('lowercases and strips accents', () => {
  assertEqual(_slugify('Géran'), 'geran');
});

test('replaces & with and', () => {
  assert(_slugify('One&Only').includes('and'), 'ampersand → and');
});

test('collapses multiple dashes', () => {
  const result = _slugify('Four   Seasons');
  assert(!result.includes('--'), 'no double dash');
});

test('empty string → empty string', () => {
  assertEqual(_slugify(''), '');
  assertEqual(_slugify(null), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────

process.stdout.write('\n');

// Handle async tests completion
setTimeout(() => {
  if (_failed === 0) {
    process.stdout.write(`  ALL ${_passed} TESTS PASSED\n`);
    process.exit(0);
  } else {
    process.stdout.write(`  ${_passed} passed, ${_failed} FAILED\n`);
    _failures.forEach(f => process.stdout.write(`    ✗ ${f.name}: ${f.msg}\n`));
    process.exit(1);
  }
}, 200);
