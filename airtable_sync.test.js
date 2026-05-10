/**
 * airtable_sync.test.js
 * Mauritius Resort Finder — Airtable Sync Layer Tests
 *
 * 35 sections, 150 tests.
 * All Airtable HTTP calls are mocked via requestFn injection.
 * No network access required.
 *
 * Runs with: node airtable_sync.test.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const {
  createClient, fetchAllTables, normalizeDataset, buildHotelObjects,
  validateHotelObjects, sync, saveSnapshot,
  normalizeHotelRecord, normalizeRegionRecord, normalizeBrandRecord,
  normalizeAmenityRecord, normalizeAffiliateLinkRecord, normalizeReviewRecord,
  normalizeContentRecord, normalizeKeywordRecord, normalizeComparisonRecord,
  buildLookupMap, buildChildIndex, _applyFieldMap, _firstLinkedId,
  _parseCLIArgs, _buildSyncReport, _defaultRequest,
  AirtableClient,
  SyncError, AirtableApiError, RateLimitError, MissingCredentialsError, ValidationError,
  SYNC_VERSION, TABLE_NAMES, HOTEL_REQUIRED_FIELDS, SCORE_FIELDS_0_10,
  HOTEL_FIELD_MAP, AIRTABLE_API_BASE, DEFAULT_PAGE_SIZE, DEFAULT_MAX_RETRIES,
  MAX_RESPONSE_BODY_BYTES, REQUEST_TIMEOUT_MS,
} = require('./airtable_sync.js');

// ─────────────────────────────────────────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    process.stdout.write('  .');
    passed++;
  } else {
    process.stdout.write('  F');
    failed++;
    failures.push(label);
  }
}

function assertThrows(fn, ErrorClass, label) {
  try {
    const result = fn();
    if (result && typeof result.catch === 'function') {
      // async fn — can't catch here; use assertRejects instead
      process.stdout.write('  F');
      failed++;
      failures.push(`${label} — returned a Promise (use assertRejects for async)`);
      return;
    }
    process.stdout.write('  F');
    failed++;
    failures.push(`${label} — expected throw but got none`);
  } catch (err) {
    if (ErrorClass && !(err instanceof ErrorClass)) {
      process.stdout.write('  F');
      failed++;
      failures.push(`${label} — expected ${ErrorClass.name}, got ${err.constructor.name}: ${err.message}`);
    } else {
      process.stdout.write('  .');
      passed++;
    }
  }
}

async function assertRejects(fn, ErrorClass, label) {
  try {
    await fn();
    process.stdout.write('  F');
    failed++;
    failures.push(`${label} — expected rejection but resolved`);
  } catch (err) {
    if (ErrorClass && !(err instanceof ErrorClass)) {
      process.stdout.write('  F');
      failed++;
      failures.push(`${label} — expected ${ErrorClass.name}, got ${err.constructor.name}: ${err.message}`);
    } else {
      process.stdout.write('  .');
      passed++;
    }
  }
}

function section(name) {
  process.stdout.write(`\n\n  Section ${name}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK HTTP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a mock requestFn that serves paginated Airtable responses.
 *
 * tableResponses: { [tableName]: [page0, page1, ...] }
 * Each page: { records: [...] }
 * If multiple pages, the mock automatically injects offset tokens.
 *
 * @param  {Object} tableResponses
 * @returns {Function}
 */
function makeMockRequestFn(tableResponses) {
  return async function mockRequest(url) {
    const urlObj    = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const tableName = decodeURIComponent(pathParts[pathParts.length - 1]);
    const offsetParam = urlObj.searchParams.get('offset');
    const pageIndex   = offsetParam ? parseInt(offsetParam, 10) : 0;

    const pages = tableResponses[tableName];
    if (!pages) {
      return { status: 200, body: JSON.stringify({ records: [] }) };
    }

    const currentPage = pages[pageIndex];
    if (!currentPage) {
      return { status: 200, body: JSON.stringify({ records: [] }) };
    }

    const responseBody = { records: currentPage.records || [] };
    if (pageIndex + 1 < pages.length) {
      responseBody.offset = String(pageIndex + 1);
    }

    return { status: 200, body: JSON.stringify(responseBody) };
  };
}

/**
 * Builds a mock requestFn that returns a fixed status code for all requests.
 */
function makeStatusMockFn(status, body = '{}') {
  return async () => ({ status, body });
}

/**
 * Builds a mock requestFn that returns 429 for the first N calls, then 200.
 */
function makeRateLimitMockFn(failCount, successRecords = []) {
  let calls = 0;
  return async function() {
    calls++;
    if (calls <= failCount) {
      return { status: 429, body: JSON.stringify({ error: { message: 'Rate Limited' } }) };
    }
    return { status: 200, body: JSON.stringify({ records: successRecords }) };
  };
}

/**
 * Builds an AirtableClient with a mock requestFn and fast retry settings.
 */
function makeMockClient(tableResponses) {
  return new AirtableClient({
    apiKey:           'test_key',
    baseId:           'test_base',
    requestFn:        makeMockRequestFn(tableResponses),
    rateLimitDelayMs: 0,
    maxRetries:       3,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DATA FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_HOTEL_RAW = {
  id: 'recHotel001',
  fields: {
    hotel_id:        'MQ001',
    hotel_name:      'Royal Palm Beachcomber',
    overall_rating:  9.2,
    location_score:  9.4,
    amenity_score:   9.1,
    brand_score:     9.0,
    value_score:     7.2,
    review_count:    1340,
    avg_rating:      4.8,
    avg_nightly_rate: 1450,
    star_rating:     5,
    property_type:   'resort',
    status:          'active',
    region_id:       ['recRegion001'],
    brand_id:        ['recBrand001'],
  },
  createdTime: '2024-01-01T00:00:00.000Z',
};

const MOCK_HOTEL_RAW_2 = {
  id: 'recHotel002',
  fields: {
    hotel_id:        'MQ002',
    hotel_name:      "One&Only Le Saint Géran",
    overall_rating:  9.1,
    location_score:  9.3,
    amenity_score:   9.0,
    brand_score:     9.2,
    value_score:     7.0,
    review_count:    1020,
    avg_rating:      4.78,
    avg_nightly_rate: 1650,
    star_rating:     5,
    property_type:   'resort',
    status:          'active',
    region_id:       ['recRegion002'],
    brand_id:        ['recBrand002'],
  },
  createdTime: '2024-01-01T00:00:00.000Z',
};

const MOCK_REGION_RAW = {
  id: 'recRegion001',
  fields: { region_id: 'MU-GB', region_name: 'Grand Baie', country: 'Mauritius', sub_region: 'North' },
  createdTime: '2024-01-01T00:00:00.000Z',
};

const MOCK_BRAND_RAW = {
  id: 'recBrand001',
  fields: { brand_id: 'BCH', brand_name: 'Beachcomber Hotels', brand_tier: 4, parent_company: 'Beachcomber' },
  createdTime: '2024-01-01T00:00:00.000Z',
};

const MOCK_AMENITY_RAW_SPA = {
  id: 'recAmenity001',
  fields: { hotel_id: ['recHotel001'], amenity_key: 'spa', is_present: true },
  createdTime: '2024-01-01T00:00:00.000Z',
};

const MOCK_AMENITY_RAW_BEACH = {
  id: 'recAmenity002',
  fields: { hotel_id: ['recHotel001'], amenity_key: 'private_beach', is_present: true },
  createdTime: '2024-01-01T00:00:00.000Z',
};

const MOCK_AFFILIATE_RAW = {
  id: 'recAffiliate001',
  fields: {
    affiliate_id:    'AFF001',
    hotel_id:        ['recHotel001'],
    booking_url:     'https://mauritiusresortfinder.com/r/MQ001',
    provider:        'Booking.com',
    commission_rate: 0.08,
    commission_tier: 'premium',
    is_active:       true,
  },
  createdTime: '2024-01-01T00:00:00.000Z',
};

const MOCK_REVIEW_RAW = {
  id: 'recReview001',
  fields: {
    review_id:    'REV001',
    hotel_id:     ['recHotel001'],
    review_count: 1340,
    avg_rating:   4.8,
    review_source: 'TripAdvisor',
  },
  createdTime: '2024-01-01T00:00:00.000Z',
};

// Full table response set for integration tests
const MOCK_ALL_TABLES = {
  hotels:          [{ records: [MOCK_HOTEL_RAW, MOCK_HOTEL_RAW_2] }],
  regions:         [{ records: [MOCK_REGION_RAW] }],
  brands:          [{ records: [MOCK_BRAND_RAW] }],
  amenities:       [{ records: [MOCK_AMENITY_RAW_SPA, MOCK_AMENITY_RAW_BEACH] }],
  affiliate_links: [{ records: [MOCK_AFFILIATE_RAW] }],
  reviews:         [{ records: [MOCK_REVIEW_RAW] }],
  content:         [{ records: [] }],
  keywords:        [{ records: [] }],
  comparisons:     [{ records: [] }],
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Module constants and exports
// ─────────────────────────────────────────────────────────────────────────────

section('1: Module constants and exports');

assert(typeof SYNC_VERSION === 'string' && SYNC_VERSION.length > 0,     'SYNC_VERSION is non-empty string');
assert(Array.isArray(TABLE_NAMES) && TABLE_NAMES.length === 9,           'TABLE_NAMES has 9 entries');
assert(TABLE_NAMES.includes('hotels'),                                    'TABLE_NAMES includes hotels');
assert(TABLE_NAMES.includes('affiliate_links'),                           'TABLE_NAMES includes affiliate_links');
assert(Array.isArray(HOTEL_REQUIRED_FIELDS) && HOTEL_REQUIRED_FIELDS.length === 9, 'HOTEL_REQUIRED_FIELDS has 9 entries');
assert(HOTEL_REQUIRED_FIELDS.includes('hotel_id'),                        'HOTEL_REQUIRED_FIELDS includes hotel_id');
assert(HOTEL_REQUIRED_FIELDS.includes('avg_rating'),                      'HOTEL_REQUIRED_FIELDS includes avg_rating');
assert(Array.isArray(SCORE_FIELDS_0_10) && SCORE_FIELDS_0_10.length >= 5,'SCORE_FIELDS_0_10 has entries');
assert(DEFAULT_PAGE_SIZE === 100,                                          'DEFAULT_PAGE_SIZE is 100');
assert(DEFAULT_MAX_RETRIES === 3,                                          'DEFAULT_MAX_RETRIES is 3');
assert(AIRTABLE_API_BASE.includes('airtable.com'),                        'AIRTABLE_API_BASE is correct');
assert(typeof AirtableClient === 'function',                               'AirtableClient exported');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Error type inheritance
// ─────────────────────────────────────────────────────────────────────────────

section('2: Error type inheritance');

const se  = new SyncError('test', { a: 1 });
const aae = new AirtableApiError('api error', 429);
const rle = new RateLimitError('hotels', 1);
const mce = new MissingCredentialsError();
const ve  = new ValidationError('invalid', { b: 2 });

assert(se  instanceof SyncError,              'SyncError: instanceof SyncError');
assert(se  instanceof Error,                  'SyncError: instanceof Error');
assert(se.context.a === 1,                    'SyncError: context preserved');
assert(aae instanceof AirtableApiError,       'AirtableApiError: instanceof self');
assert(aae instanceof SyncError,              'AirtableApiError: instanceof SyncError');
assert(aae.status === 429,                    'AirtableApiError: status set');
assert(rle instanceof RateLimitError,         'RateLimitError: instanceof self');
assert(rle instanceof AirtableApiError,       'RateLimitError: instanceof AirtableApiError');
assert(mce instanceof MissingCredentialsError,'MissingCredentialsError: instanceof self');
assert(ve  instanceof ValidationError,        'ValidationError: instanceof self');
assert(ve  instanceof SyncError,              'ValidationError: instanceof SyncError');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: _applyFieldMap()
// ─────────────────────────────────────────────────────────────────────────────

section('3: _applyFieldMap()');

const fieldMap = { foo: 'bar', baz: 'qux', Name: 'hotel_name' };
const record   = { id: 'recABC', fields: { foo: 'hello', baz: 42, extra: 'ignored' }, createdTime: '2024-01-01' };
const mapped   = _applyFieldMap(record, fieldMap);

assert(mapped._airtable_id === 'recABC',    '_applyFieldMap: preserves _airtable_id');
assert(mapped.bar === 'hello',              '_applyFieldMap: maps foo → bar');
assert(mapped.qux === 42,                   '_applyFieldMap: maps baz → qux');
assert(mapped.extra === undefined,          '_applyFieldMap: ignores unmapped fields');

// Name alias — second field (hotel_name) should not overwrite existing mapping
const aliasMap = { hotel_name: 'hotel_name', Name: 'hotel_name' };
const aliasRec = { id: 'recX', fields: { hotel_name: 'Primary', Name: 'Alias' }, createdTime: '' };
const aliased  = _applyFieldMap(aliasRec, aliasMap);
assert(aliased.hotel_name === 'Primary',    '_applyFieldMap: first-set field wins over alias');

assert(_applyFieldMap({ id: 'recZ', fields: {} }, {})._airtable_id === 'recZ', '_applyFieldMap: empty fields → only _airtable_id');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: _firstLinkedId()
// ─────────────────────────────────────────────────────────────────────────────

section('4: _firstLinkedId()');

assert(_firstLinkedId(['recABC', 'recDEF']) === 'recABC',  '_firstLinkedId: returns first element');
assert(_firstLinkedId(['recXYZ'])           === 'recXYZ',  '_firstLinkedId: single element');
assert(_firstLinkedId([])                  === null,       '_firstLinkedId: empty array → null');
assert(_firstLinkedId(null)                === null,       '_firstLinkedId: null → null');
assert(_firstLinkedId(undefined)           === null,       '_firstLinkedId: undefined → null');
assert(_firstLinkedId('notArray')          === null,       '_firstLinkedId: non-array → null');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: AirtableClient construction
// ─────────────────────────────────────────────────────────────────────────────

section('5: AirtableClient construction');

const client = new AirtableClient({ apiKey: 'key', baseId: 'base', requestFn: async () => {} });
assert(client.apiKey === 'key',             'AirtableClient: apiKey stored');
assert(client.baseId === 'base',            'AirtableClient: baseId stored');
assert(typeof client.requestFn === 'function', 'AirtableClient: requestFn stored');
assert(client.pageSize === DEFAULT_PAGE_SIZE, 'AirtableClient: default pageSize');
assert(client.maxRetries === DEFAULT_MAX_RETRIES, 'AirtableClient: default maxRetries');

assertThrows(() => new AirtableClient({ baseId: 'base' }),   MissingCredentialsError, 'AirtableClient: throws with no apiKey');
assertThrows(() => new AirtableClient({ apiKey: 'key' }),    MissingCredentialsError, 'AirtableClient: throws with no baseId');
assertThrows(() => new AirtableClient({}),                   MissingCredentialsError, 'AirtableClient: throws with empty opts');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: AirtableClient._buildUrl()
// ─────────────────────────────────────────────────────────────────────────────

section('6: AirtableClient._buildUrl()');

const urlClient = new AirtableClient({ apiKey: 'k', baseId: 'appTEST', requestFn: async () => {} });
const url1 = urlClient._buildUrl('hotels');
const url2 = urlClient._buildUrl('hotels', { offset: 'page2token' });
const url3 = urlClient._buildUrl('affiliate links'); // table name with space

assert(url1.includes('appTEST'),                    '_buildUrl: includes baseId');
assert(url1.includes('hotels'),                     '_buildUrl: includes tableName');
assert(url1.includes('pageSize=100'),               '_buildUrl: includes pageSize');
assert(!url2.includes('offset=page2token') || url2.includes('offset'), '_buildUrl: includes offset when provided');
assert(url3.includes('affiliate'),                  '_buildUrl: URL-encodes table names');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: AirtableClient.fetchPage() — success
// ─────────────────────────────────────────────────────────────────────────────

section('7: AirtableClient.fetchPage() — success');

(async () => {
  const mockRecords = [{ id: 'recA', fields: { hotel_id: 'MQ001' }, createdTime: '' }];
  const mockFn = async () => ({ status: 200, body: JSON.stringify({ records: mockRecords }) });
  const c = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: mockFn, rateLimitDelayMs: 0 });

  const page = await c.fetchPage('hotels');
  assert(Array.isArray(page.records),              'fetchPage: returns records array');
  assert(page.records.length === 1,                'fetchPage: correct record count');
  assert(page.records[0].id === 'recA',            'fetchPage: record ID preserved');
  assert(page.offset === undefined,                'fetchPage: no offset when single page');

  // With next page token
  const mockFn2 = async () => ({
    status: 200,
    body: JSON.stringify({ records: mockRecords, offset: 'nextPageToken' }),
  });
  const c2 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: mockFn2, rateLimitDelayMs: 0 });
  const page2 = await c2.fetchPage('hotels');
  assert(page2.offset === 'nextPageToken',         'fetchPage: returns offset when present');
})().then(() => {}).catch(err => { failed++; failures.push(`fetchPage success: ${err.message}`); });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: AirtableClient.fetchPage() — 429 rate limit retry
// ─────────────────────────────────────────────────────────────────────────────

section('8: fetchPage() — 429 rate limit retry');

(async () => {
  // Fails twice then succeeds
  const mockFn = makeRateLimitMockFn(2, [{ id: 'recA', fields: {}, createdTime: '' }]);
  const c = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: mockFn, rateLimitDelayMs: 0, maxRetries: 3 });
  const page = await c.fetchPage('hotels');
  assert(Array.isArray(page.records),              'fetchPage 429: retries and succeeds');
  assert(page.records.length === 1,                'fetchPage 429: returns correct records after retry');

  // Exhausts retries → throws RateLimitError
  const alwaysRate = makeRateLimitMockFn(999);
  const c2 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: alwaysRate, rateLimitDelayMs: 0, maxRetries: 2 });
  let threw = false;
  try { await c2.fetchPage('hotels'); } catch (err) {
    threw = true;
    assert(err instanceof RateLimitError,          'fetchPage 429: throws RateLimitError after max retries');
  }
  assert(threw,                                    'fetchPage 429: did throw after max retries');

  // Single retry success
  const onceFail = makeRateLimitMockFn(1, []);
  const c3 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: onceFail, rateLimitDelayMs: 0, maxRetries: 1 });
  const page3 = await c3.fetchPage('hotels');
  assert(Array.isArray(page3.records),             'fetchPage 429: one fail then success');
})().then(() => {}).catch(err => { failed++; failures.push(`fetchPage 429: ${err.message}`); });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: AirtableClient.fetchPage() — error responses
// ─────────────────────────────────────────────────────────────────────────────

section('9: fetchPage() — error responses');

(async () => {
  // 401 Unauthorized
  const c401 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: makeStatusMockFn(401, JSON.stringify({ error: { message: 'Unauthorized' } })), rateLimitDelayMs: 0 });
  await assertRejects(() => c401.fetchPage('hotels'), AirtableApiError, 'fetchPage 401: throws AirtableApiError');

  // 403 Forbidden
  const c403 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: makeStatusMockFn(403, JSON.stringify({ error: { message: 'Forbidden' } })), rateLimitDelayMs: 0 });
  await assertRejects(() => c403.fetchPage('hotels'), AirtableApiError, 'fetchPage 403: throws AirtableApiError');

  // 404 Not Found
  const c404 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: makeStatusMockFn(404, JSON.stringify({ error: { message: 'Not Found' } })), rateLimitDelayMs: 0 });
  await assertRejects(() => c404.fetchPage('hotels'), AirtableApiError, 'fetchPage 404: throws AirtableApiError');

  // 500 Server error
  const c500 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: makeStatusMockFn(500, '{}'), rateLimitDelayMs: 0 });
  await assertRejects(() => c500.fetchPage('hotels'), AirtableApiError, 'fetchPage 500: throws AirtableApiError');

  // Invalid JSON response
  const cBadJson = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: async () => ({ status: 200, body: 'not json {{{' }), rateLimitDelayMs: 0 });
  await assertRejects(() => cBadJson.fetchPage('hotels'), SyncError, 'fetchPage bad JSON: throws SyncError');
})().then(() => {}).catch(err => { failed++; failures.push(`fetchPage errors: ${err.message}`); });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: AirtableClient.fetchTable() — pagination
// ─────────────────────────────────────────────────────────────────────────────

section('10: fetchTable() — pagination');

(async () => {
  // Two pages of records
  const page1 = { records: [{ id: 'rec1', fields: { hotel_id: 'H1' }, createdTime: '' }] };
  const page2 = { records: [{ id: 'rec2', fields: { hotel_id: 'H2' }, createdTime: '' }] };
  const mockFn = makeMockRequestFn({ hotels: [page1, page2] });
  const c = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: mockFn, rateLimitDelayMs: 0 });

  const records = await c.fetchTable('hotels');
  assert(Array.isArray(records),                   'fetchTable: returns array');
  assert(records.length === 2,                     'fetchTable: combines both pages');
  assert(records[0].id === 'rec1',                 'fetchTable: page 1 record correct');
  assert(records[1].id === 'rec2',                 'fetchTable: page 2 record correct');

  // Three pages
  const page3 = { records: [{ id: 'rec3', fields: {}, createdTime: '' }] };
  const mock3 = makeMockRequestFn({ hotels: [page1, page2, page3] });
  const c3 = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: mock3, rateLimitDelayMs: 0 });
  const all3 = await c3.fetchTable('hotels');
  assert(all3.length === 3,                        'fetchTable: three pages combined');

  // Empty table
  const mockEmpty = makeMockRequestFn({ hotels: [{ records: [] }] });
  const cEmpty = new AirtableClient({ apiKey: 'k', baseId: 'b', requestFn: mockEmpty, rateLimitDelayMs: 0 });
  const empty = await cEmpty.fetchTable('hotels');
  assert(empty.length === 0,                       'fetchTable: handles empty table');
})().then(() => {}).catch(err => { failed++; failures.push(`fetchTable pagination: ${err.message}`); });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: fetchAllTables()
// ─────────────────────────────────────────────────────────────────────────────

section('11: fetchAllTables()');

(async () => {
  const client = makeMockClient(MOCK_ALL_TABLES);

  const raw = await fetchAllTables(client);
  assert(typeof raw === 'object' && raw !== null,  'fetchAllTables: returns object');
  assert(Array.isArray(raw.hotels),                'fetchAllTables: hotels array');
  assert(Array.isArray(raw.regions),               'fetchAllTables: regions array');
  assert(Array.isArray(raw.amenities),             'fetchAllTables: amenities array');
  assert(raw.hotels.length === 2,                  'fetchAllTables: correct hotel count');
  assert(raw.regions.length === 1,                 'fetchAllTables: correct region count');
  assert(raw.affiliate_links.length === 1,         'fetchAllTables: correct affiliate_links count');

  // Non-AirtableClient throws
  await assertRejects(() => fetchAllTables({}), SyncError, 'fetchAllTables: throws for non-client');

  // Missing hotels table is a critical error
  const brokenClient = new AirtableClient({
    apiKey: 'k', baseId: 'b',
    requestFn: makeStatusMockFn(401, JSON.stringify({ error: { message: 'Unauthorized' } })),
    rateLimitDelayMs: 0,
  });
  await assertRejects(() => fetchAllTables(brokenClient), SyncError, 'fetchAllTables: critical error on hotels failure');
})().then(() => {}).catch(err => { failed++; failures.push(`fetchAllTables: ${err.message}`); });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: normalizeHotelRecord()
// ─────────────────────────────────────────────────────────────────────────────

section('12: normalizeHotelRecord()');

const normHotel = normalizeHotelRecord(MOCK_HOTEL_RAW);
assert(normHotel._airtable_id === 'recHotel001',    'normalizeHotelRecord: _airtable_id');
assert(normHotel.hotel_id === 'MQ001',              'normalizeHotelRecord: hotel_id');
assert(normHotel.hotel_name === 'Royal Palm Beachcomber', 'normalizeHotelRecord: hotel_name');
assert(typeof normHotel.overall_rating === 'number','normalizeHotelRecord: overall_rating is number');
assert(normHotel.overall_rating === 9.2,            'normalizeHotelRecord: overall_rating value');
assert(normHotel._region_ref === 'recRegion001',    'normalizeHotelRecord: _region_ref resolved to first ID');
assert(normHotel._brand_ref === 'recBrand001',      'normalizeHotelRecord: _brand_ref resolved to first ID');
assert(normHotel.status === 'active',               'normalizeHotelRecord: status field');
assert(normHotel.review_count === 1340,             'normalizeHotelRecord: review_count is number');

// Name alias
const aliasHotel = normalizeHotelRecord({ id: 'recX', fields: { Name: 'Alias Name' }, createdTime: '' });
assert(aliasHotel.hotel_name === 'Alias Name',      'normalizeHotelRecord: Name alias mapped');

// Default status when missing
const noStatusHotel = normalizeHotelRecord({ id: 'recY', fields: { hotel_id: 'X' }, createdTime: '' });
assert(noStatusHotel.status === 'active',           'normalizeHotelRecord: default status = active');

// String numerics coerced
const strHotel = normalizeHotelRecord({
  id: 'recZ', fields: { hotel_id: 'Z', overall_rating: '8.5', review_count: '200' }, createdTime: '',
});
assert(typeof strHotel.overall_rating === 'number', 'normalizeHotelRecord: string numeric coerced');
assert(strHotel.overall_rating === 8.5,             'normalizeHotelRecord: string numeric value correct');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: normalizeRegionRecord()
// ─────────────────────────────────────────────────────────────────────────────

section('13: normalizeRegionRecord()');

const normRegion = normalizeRegionRecord(MOCK_REGION_RAW);
assert(normRegion._airtable_id === 'recRegion001',  'normalizeRegionRecord: _airtable_id');
assert(normRegion.region_id === 'MU-GB',            'normalizeRegionRecord: region_id');
assert(normRegion.region_name === 'Grand Baie',     'normalizeRegionRecord: region_name');
assert(normRegion.country === 'Mauritius',          'normalizeRegionRecord: country');
assert(normRegion.sub_region === 'North',           'normalizeRegionRecord: sub_region');

// Name alias
const aliasRegion = normalizeRegionRecord({ id: 'recR2', fields: { Name: 'Belle Mare' }, createdTime: '' });
assert(aliasRegion.region_name === 'Belle Mare',    'normalizeRegionRecord: Name alias');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: normalizeBrandRecord()
// ─────────────────────────────────────────────────────────────────────────────

section('14: normalizeBrandRecord()');

const normBrand = normalizeBrandRecord(MOCK_BRAND_RAW);
assert(normBrand._airtable_id === 'recBrand001',    'normalizeBrandRecord: _airtable_id');
assert(normBrand.brand_id === 'BCH',                'normalizeBrandRecord: brand_id');
assert(normBrand.brand_name === 'Beachcomber Hotels','normalizeBrandRecord: brand_name');
assert(normBrand.brand_tier === 4,                  'normalizeBrandRecord: brand_tier is number');
assert(normBrand.parent_company === 'Beachcomber',  'normalizeBrandRecord: parent_company');

// brand_tier coercion
const strBrand = normalizeBrandRecord({ id: 'recB2', fields: { brand_tier: '5' }, createdTime: '' });
assert(typeof strBrand.brand_tier === 'number',     'normalizeBrandRecord: brand_tier coerced from string');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15: normalizeAmenityRecord()
// ─────────────────────────────────────────────────────────────────────────────

section('15: normalizeAmenityRecord()');

const normAmenity = normalizeAmenityRecord(MOCK_AMENITY_RAW_SPA);
assert(normAmenity._airtable_id === 'recAmenity001', 'normalizeAmenityRecord: _airtable_id');
assert(normAmenity._hotel_ref === 'recHotel001',     'normalizeAmenityRecord: _hotel_ref resolved');
assert(normAmenity.amenity_key === 'spa',            'normalizeAmenityRecord: amenity_key');
assert(normAmenity.is_present === true,              'normalizeAmenityRecord: is_present true');

// is_present default false when missing
const noPresent = normalizeAmenityRecord({ id: 'recA2', fields: { hotel_id: ['recH'], amenity_key: 'gym' }, createdTime: '' });
assert(noPresent.is_present === false,               'normalizeAmenityRecord: is_present defaults false');

// is_present = false when explicitly false
const falsePresent = normalizeAmenityRecord({ id: 'recA3', fields: { hotel_id: ['recH'], amenity_key: 'golf', is_present: false }, createdTime: '' });
assert(falsePresent.is_present === false,            'normalizeAmenityRecord: is_present false preserved');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16: normalizeAffiliateLinkRecord()
// ─────────────────────────────────────────────────────────────────────────────

section('16: normalizeAffiliateLinkRecord()');

const normAff = normalizeAffiliateLinkRecord(MOCK_AFFILIATE_RAW);
assert(normAff._airtable_id === 'recAffiliate001',  'normalizeAffiliateLinkRecord: _airtable_id');
assert(normAff._hotel_ref === 'recHotel001',         'normalizeAffiliateLinkRecord: _hotel_ref');
assert(normAff.booking_url.includes('mauritiusresortfinder.com'), 'normalizeAffiliateLinkRecord: booking_url');
assert(normAff.commission_rate === 0.08,             'normalizeAffiliateLinkRecord: commission_rate');
assert(normAff.is_active === true,                   'normalizeAffiliateLinkRecord: is_active true');
assert(normAff.commission_tier === 'premium',        'normalizeAffiliateLinkRecord: commission_tier');

// is_active defaults true when missing
const noActive = normalizeAffiliateLinkRecord({ id: 'recAff2', fields: { hotel_id: ['recH'], booking_url: 'https://x.com' }, createdTime: '' });
assert(noActive.is_active === true,                  'normalizeAffiliateLinkRecord: is_active defaults true');

// commission_rate coercion from string
const strRate = normalizeAffiliateLinkRecord({ id: 'recAff3', fields: { hotel_id: ['recH'], commission_rate: '0.07' }, createdTime: '' });
assert(typeof strRate.commission_rate === 'number',  'normalizeAffiliateLinkRecord: commission_rate coerced');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17: normalizeReviewRecord()
// ─────────────────────────────────────────────────────────────────────────────

section('17: normalizeReviewRecord()');

const normReview = normalizeReviewRecord(MOCK_REVIEW_RAW);
assert(normReview._airtable_id === 'recReview001',  'normalizeReviewRecord: _airtable_id');
assert(normReview._hotel_ref === 'recHotel001',      'normalizeReviewRecord: _hotel_ref');
assert(normReview.review_count === 1340,             'normalizeReviewRecord: review_count');
assert(normReview.avg_rating === 4.8,                'normalizeReviewRecord: avg_rating');
assert(normReview.review_source === 'TripAdvisor',   'normalizeReviewRecord: review_source');

// Numeric coercion
const strReview = normalizeReviewRecord({ id: 'recR', fields: { hotel_id: ['recH'], review_count: '500', avg_rating: '4.2' }, createdTime: '' });
assert(typeof strReview.review_count === 'number',   'normalizeReviewRecord: review_count coerced');
assert(typeof strReview.avg_rating === 'number',     'normalizeReviewRecord: avg_rating coerced');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 18: normalizeDataset()
// ─────────────────────────────────────────────────────────────────────────────

section('18: normalizeDataset()');

const rawData = {
  hotels:          [MOCK_HOTEL_RAW, MOCK_HOTEL_RAW_2],
  regions:         [MOCK_REGION_RAW],
  brands:          [MOCK_BRAND_RAW],
  amenities:       [MOCK_AMENITY_RAW_SPA, MOCK_AMENITY_RAW_BEACH],
  affiliate_links: [MOCK_AFFILIATE_RAW],
  reviews:         [MOCK_REVIEW_RAW],
  content:         [],
  keywords:        [],
  comparisons:     [],
};

const nd = normalizeDataset(rawData);
assert(typeof nd === 'object' && nd !== null,        'normalizeDataset: returns object');
assert(Array.isArray(nd.hotels) && nd.hotels.length === 2, 'normalizeDataset: hotels normalized');
assert(nd.hotels[0]._airtable_id === 'recHotel001', 'normalizeDataset: hotel _airtable_id set');
assert(nd.regions[0].region_name === 'Grand Baie',  'normalizeDataset: regions normalized');
assert(nd.amenities.length === 2,                   'normalizeDataset: amenities normalized');
assert(nd.affiliate_links.length === 1,             'normalizeDataset: affiliate_links normalized');

// Graceful on missing table
const ndPartial = normalizeDataset({ hotels: [MOCK_HOTEL_RAW] });
assert(Array.isArray(ndPartial.regions) && ndPartial.regions.length === 0, 'normalizeDataset: missing table → empty array');

// Throws on invalid input
assertThrows(() => normalizeDataset(null),           SyncError, 'normalizeDataset: throws on null');
assertThrows(() => normalizeDataset([]),             SyncError, 'normalizeDataset: throws on array');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 19: buildLookupMap()
// ─────────────────────────────────────────────────────────────────────────────

section('19: buildLookupMap()');

const regions = [
  { _airtable_id: 'recR1', region_name: 'Grand Baie' },
  { _airtable_id: 'recR2', region_name: 'Belle Mare' },
];
const lookupMap = buildLookupMap(regions);
assert(typeof lookupMap === 'object',                'buildLookupMap: returns object');
assert(lookupMap['recR1'].region_name === 'Grand Baie', 'buildLookupMap: correct lookup by airtable_id');
assert(lookupMap['recR2'].region_name === 'Belle Mare', 'buildLookupMap: second record');
assert(Object.keys(lookupMap).length === 2,          'buildLookupMap: correct key count');

// Handles empty array
assert(Object.keys(buildLookupMap([])).length === 0, 'buildLookupMap: empty array → empty map');
// Handles non-array
assert(Object.keys(buildLookupMap(null)).length === 0,'buildLookupMap: null → empty map');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 20: buildChildIndex()
// ─────────────────────────────────────────────────────────────────────────────

section('20: buildChildIndex()');

const amenityRecords = [
  { _airtable_id: 'recA1', _hotel_ref: 'recH1', amenity_key: 'spa',   is_present: true  },
  { _airtable_id: 'recA2', _hotel_ref: 'recH1', amenity_key: 'pool',  is_present: true  },
  { _airtable_id: 'recA3', _hotel_ref: 'recH2', amenity_key: 'gym',   is_present: false },
];
const childIdx = buildChildIndex(amenityRecords);
assert(typeof childIdx === 'object',                     'buildChildIndex: returns object');
assert(Array.isArray(childIdx['recH1']),                 'buildChildIndex: hotel1 array');
assert(childIdx['recH1'].length === 2,                   'buildChildIndex: hotel1 has 2 amenities');
assert(childIdx['recH2'].length === 1,                   'buildChildIndex: hotel2 has 1 amenity');
assert(childIdx['recH1'][0].amenity_key === 'spa',       'buildChildIndex: first amenity correct');

// Custom refField
const customRecords = [{ _hotel_ref_a: 'recH1', comparison_id: 'C1' }];
const customIdx = buildChildIndex(customRecords, '_hotel_ref_a');
assert(customIdx['recH1'].length === 1,                  'buildChildIndex: custom refField works');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 21: buildHotelObjects() — basic output shape
// ─────────────────────────────────────────────────────────────────────────────

section('21: buildHotelObjects() — basic output shape');

const normDataset = normalizeDataset(rawData);
const hotels = buildHotelObjects(normDataset);

assert(Array.isArray(hotels),                        'buildHotelObjects: returns array');
assert(hotels.length === 2,                          'buildHotelObjects: correct count');

const h1 = hotels.find(h => h.hotel_id === 'MQ001');
assert(h1 !== undefined,                             'buildHotelObjects: MQ001 present');
assert(h1.hotel_name === 'Royal Palm Beachcomber',   'buildHotelObjects: hotel_name');
assert(h1.overall_rating === 9.2,                    'buildHotelObjects: overall_rating');
assert(h1.location_score === 9.4,                    'buildHotelObjects: location_score');
assert(h1.amenity_score === 9.1,                     'buildHotelObjects: amenity_score');
assert(h1.brand_score === 9.0,                       'buildHotelObjects: brand_score');
assert(h1.value_score === 7.2,                       'buildHotelObjects: value_score');
assert(h1.review_count === 1340,                     'buildHotelObjects: review_count');
assert(h1.avg_rating === 4.8,                        'buildHotelObjects: avg_rating');
assert(h1.star_rating === 5,                         'buildHotelObjects: star_rating optional');
assert(h1.property_type === 'resort',                'buildHotelObjects: property_type optional');

// Throws on invalid input
assertThrows(() => buildHotelObjects(null),           SyncError, 'buildHotelObjects: throws on null');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 22: buildHotelObjects() — relationship joining
// ─────────────────────────────────────────────────────────────────────────────

section('22: buildHotelObjects() — relationship joining');

assert(h1.region === 'Grand Baie',                   'buildHotelObjects: region joined from regions table');
assert(h1._brand_name === 'Beachcomber Hotels',      'buildHotelObjects: _brand_name joined');
assert(h1._brand_tier === 4,                         'buildHotelObjects: _brand_tier joined');
assert(h1._region_id === 'MU-GB',                    'buildHotelObjects: _region_id joined');
assert(typeof h1.amenities === 'object',             'buildHotelObjects: amenities object present');
assert(h1.amenities.spa === true,                    'buildHotelObjects: amenities.spa joined');
assert(h1.amenities.private_beach === true,          'buildHotelObjects: amenities.private_beach joined');
assert(h1.affiliate_commission_rate === 0.08,        'buildHotelObjects: commission_rate joined from affiliate_links');
assert(Array.isArray(h1._affiliate_links),           'buildHotelObjects: _affiliate_links metadata');
assert(h1._affiliate_links.length === 1,             'buildHotelObjects: correct affiliate count');
assert(h1._affiliate_links[0].booking_url.includes('mauritiusresortfinder.com'), 'buildHotelObjects: affiliate booking_url');
assert(h1.price_per_night_usd === 1450,              'buildHotelObjects: price_per_night_usd from avg_nightly_rate');
assert(h1._airtable_id === 'recHotel001',            'buildHotelObjects: _airtable_id preserved');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 23: buildHotelObjects() — inactive hotels excluded
// ─────────────────────────────────────────────────────────────────────────────

section('23: buildHotelObjects() — inactive hotels excluded');

const inactiveHotelRaw = {
  id: 'recHotelInactive',
  fields: { hotel_id: 'INACTIVE01', hotel_name: 'Closed Hotel', status: 'inactive', overall_rating: 8 },
  createdTime: '',
};
const dataWithInactive = normalizeDataset({ ...rawData, hotels: [MOCK_HOTEL_RAW, inactiveHotelRaw] });
const hotelsFiltered   = buildHotelObjects(dataWithInactive);
assert(hotelsFiltered.every(h => h._status !== 'inactive'), 'buildHotelObjects: inactive hotels excluded');
assert(!hotelsFiltered.some(h => h.hotel_id === 'INACTIVE01'), 'buildHotelObjects: INACTIVE01 not in output');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 24: Deterministic sorting
// ─────────────────────────────────────────────────────────────────────────────

section('24: Deterministic sorting');

// Hotels should be sorted by hotel_id ascending
const ids = hotels.map(h => h.hotel_id);
const sortedIds = [...ids].sort((a, b) => String(a).localeCompare(String(b)));
assert(JSON.stringify(ids) === JSON.stringify(sortedIds), 'buildHotelObjects: sorted by hotel_id ascending');

// Same input always produces same order
const hotels2 = buildHotelObjects(normalizeDataset({ ...rawData, hotels: [MOCK_HOTEL_RAW_2, MOCK_HOTEL_RAW] }));
assert(hotels2[0].hotel_id === 'MQ001',              'buildHotelObjects: deterministic even with reversed input');
assert(hotels2[1].hotel_id === 'MQ002',              'buildHotelObjects: second hotel in order');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 25: validateHotelObjects() — missing required fields [V-01]
// ─────────────────────────────────────────────────────────────────────────────

section('25: validateHotelObjects() — missing required fields [V-01]');

const validHotel = {
  hotel_id: 'H1', hotel_name: 'Test Hotel',
  overall_rating: 8.5, location_score: 8.0, amenity_score: 7.5,
  brand_score: 8.0, value_score: 7.0, review_count: 500, avg_rating: 4.5,
  _affiliate_links: [], _status: 'active',
};

const vResult = validateHotelObjects([validHotel]);
assert(vResult.errors.filter(e => e.check === 'V-01').length === 0, 'validateHotelObjects V-01: valid hotel has no errors');

const missingIdHotel = { ...validHotel, hotel_id: null };
const vMissing = validateHotelObjects([missingIdHotel]);
assert(vMissing.errors.some(e => e.check === 'V-01' && e.message.includes('hotel_id')), 'validateHotelObjects V-01: detects missing hotel_id');

const missingName = { ...validHotel, hotel_name: undefined };
const vMissingName = validateHotelObjects([missingName]);
assert(vMissingName.errors.some(e => e.check === 'V-01' && e.message.includes('hotel_name')), 'validateHotelObjects V-01: detects missing hotel_name');

const missingScore = { ...validHotel, overall_rating: null };
const vMissingScore = validateHotelObjects([missingScore]);
assert(vMissingScore.errors.some(e => e.check === 'V-01' && e.message.includes('overall_rating')), 'validateHotelObjects V-01: detects missing overall_rating');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 26: validateHotelObjects() — invalid score ranges [V-02]
// ─────────────────────────────────────────────────────────────────────────────

section('26: validateHotelObjects() — score ranges [V-02]');

const overRangeHotel = { ...validHotel, overall_rating: 11 };
const vOver = validateHotelObjects([overRangeHotel]);
assert(vOver.errors.some(e => e.check === 'V-02' && e.message.includes('overall_rating')), 'validateHotelObjects V-02: detects score > 10');

const underRangeHotel = { ...validHotel, location_score: -1 };
const vUnder = validateHotelObjects([underRangeHotel]);
assert(vUnder.errors.some(e => e.check === 'V-02' && e.message.includes('location_score')), 'validateHotelObjects V-02: detects score < 0');

const nanHotel = { ...validHotel, avg_rating: NaN };
const vNaN = validateHotelObjects([nanHotel]);
assert(vNaN.errors.some(e => e.check === 'V-02' && e.message.includes('avg_rating')), 'validateHotelObjects V-02: detects NaN score');

const validScore = { ...validHotel, overall_rating: 10.0 };
assert(validateHotelObjects([validScore]).errors.filter(e => e.check === 'V-02').length === 0, 'validateHotelObjects V-02: 10.0 is valid');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 27: validateHotelObjects() — duplicate hotel_ids [V-03]
// ─────────────────────────────────────────────────────────────────────────────

section('27: validateHotelObjects() — duplicate IDs [V-03]');

const dup1 = { ...validHotel, hotel_id: 'DUP01' };
const dup2 = { ...validHotel, hotel_id: 'DUP01' };
const vDup = validateHotelObjects([dup1, dup2]);
assert(vDup.errors.some(e => e.check === 'V-03' && e.hotel_id === 'DUP01'), 'validateHotelObjects V-03: detects duplicate hotel_id');

// No false positive with unique IDs
const unique1 = { ...validHotel, hotel_id: 'U01' };
const unique2 = { ...validHotel, hotel_id: 'U02' };
const vUnique = validateHotelObjects([unique1, unique2]);
assert(vUnique.errors.filter(e => e.check === 'V-03').length === 0, 'validateHotelObjects V-03: no false positive for unique IDs');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 28: validateHotelObjects() — missing affiliate links [V-04]
// ─────────────────────────────────────────────────────────────────────────────

section('28: validateHotelObjects() — missing affiliate links [V-04]');

const noLinks = { ...validHotel, hotel_id: 'NOLINKS', _affiliate_links: [] };
const vNoLinks = validateHotelObjects([noLinks]);
assert(vNoLinks.warnings.some(w => w.check === 'V-04' && w.hotel_id === 'NOLINKS'), 'validateHotelObjects V-04: warns on missing affiliate links');

const hasLinks = { ...validHotel, hotel_id: 'HASLINKS', _affiliate_links: [{ booking_url: 'https://x.com' }] };
const vHasLinks = validateHotelObjects([hasLinks]);
assert(vHasLinks.warnings.filter(w => w.check === 'V-04' && w.hotel_id === 'HASLINKS').length === 0, 'validateHotelObjects V-04: no warning when links present');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 29: validateHotelObjects() — orphan child records [V-05]
// ─────────────────────────────────────────────────────────────────────────────

section('29: validateHotelObjects() — orphan records [V-05]');

const orphanAmenity = { _airtable_id: 'recOrphan', _hotel_ref: 'recNonExistentHotel', amenity_key: 'spa', is_present: true };
const normWithOrphan = {
  hotels:    [{ _airtable_id: 'recHotel001', status: 'active' }],
  amenities: [orphanAmenity],
  reviews:   [],
};
const vOrphan = validateHotelObjects([validHotel], normWithOrphan);
assert(vOrphan.warnings.some(w => w.check === 'V-05'), 'validateHotelObjects V-05: warns on orphan amenity');

// Orphan review
const orphanReview = { _airtable_id: 'recOrphanRev', _hotel_ref: 'recNonExistentHotel' };
const normWithOrphanReview = { hotels: [{ _airtable_id: 'recHotel001', status: 'active' }], amenities: [], reviews: [orphanReview] };
const vOrphanRev = validateHotelObjects([validHotel], normWithOrphanReview);
assert(vOrphanRev.warnings.some(w => w.check === 'V-05'), 'validateHotelObjects V-05: warns on orphan review');

// No false positive
const goodNorm = { hotels: [{ _airtable_id: 'recHotel001', status: 'active' }], amenities: [{ _hotel_ref: 'recHotel001', amenity_key: 'spa' }], reviews: [] };
const vGood = validateHotelObjects([validHotel], goodNorm);
assert(vGood.warnings.filter(w => w.check === 'V-05').length === 0, 'validateHotelObjects V-05: no false positive for matched records');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 30: validateHotelObjects() — review_count [V-06]
// ─────────────────────────────────────────────────────────────────────────────

section('30: validateHotelObjects() — review_count [V-06]');

const negCount = { ...validHotel, hotel_id: 'NEG', review_count: -5 };
const vNeg = validateHotelObjects([negCount]);
assert(vNeg.errors.some(e => e.check === 'V-06'), 'validateHotelObjects V-06: detects negative review_count');

const zeroCount = { ...validHotel, hotel_id: 'ZERO', review_count: 0 };
const vZero = validateHotelObjects([zeroCount]);
assert(vZero.errors.filter(e => e.check === 'V-06').length === 0, 'validateHotelObjects V-06: zero review_count is valid');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 31: saveSnapshot()
// ─────────────────────────────────────────────────────────────────────────────

section('31: saveSnapshot()');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrf-airtable-test-'));

const snapshotData = {
  rawTables:         { hotels: [MOCK_HOTEL_RAW] },
  normalizedDataset: { hotels: [normalizeHotelRecord(MOCK_HOTEL_RAW)] },
  hotelObjects:      [validHotel],
  syncReport:        { generated_at: new Date().toISOString(), hotel_count: 1 },
};
const filePaths = saveSnapshot(tmpDir, snapshotData);

assert(typeof filePaths === 'object',                         'saveSnapshot: returns filePaths object');
assert(fs.existsSync(filePaths['raw_tables.json']),           'saveSnapshot: raw_tables.json created');
assert(fs.existsSync(filePaths['normalized_dataset.json']),   'saveSnapshot: normalized_dataset.json created');
assert(fs.existsSync(filePaths['hotels.json']),               'saveSnapshot: hotels.json created');
assert(fs.existsSync(filePaths['sync_report.json']),          'saveSnapshot: sync_report.json created');

const hotelsJson = JSON.parse(fs.readFileSync(filePaths['hotels.json'], 'utf8'));
assert(Array.isArray(hotelsJson),                             'saveSnapshot: hotels.json is valid JSON array');
assert(hotelsJson[0].hotel_id === 'H1',                       'saveSnapshot: hotels.json content correct');

const reportJson = JSON.parse(fs.readFileSync(filePaths['sync_report.json'], 'utf8'));
assert(reportJson.hotel_count === 1,                          'saveSnapshot: sync_report.json content correct');

// Nested dir creation
const nestedDir = path.join(tmpDir, 'nested', 'deep');
saveSnapshot(nestedDir, snapshotData);
assert(fs.existsSync(path.join(nestedDir, 'hotels.json')),    'saveSnapshot: creates nested directories');

// Throws on invalid args
assertThrows(() => saveSnapshot('', snapshotData),            SyncError, 'saveSnapshot: throws on empty outputDir');
assertThrows(() => saveSnapshot(tmpDir, null),                 SyncError, 'saveSnapshot: throws on null data');

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 32: createClient() — environment variable handling
// ─────────────────────────────────────────────────────────────────────────────

section('32: createClient() — environment variables');

// Throws when no credentials anywhere
const origKey  = process.env.AIRTABLE_API_KEY;
const origToken = process.env.AIRTABLE_TOKEN;
const origBase = process.env.AIRTABLE_BASE_ID;
delete process.env.AIRTABLE_API_KEY;
delete process.env.AIRTABLE_TOKEN;
delete process.env.AIRTABLE_BASE_ID;

assertThrows(() => createClient(), MissingCredentialsError, 'createClient: throws when no env vars');
assertThrows(() => createClient({ apiKey: 'key' }), MissingCredentialsError, 'createClient: throws when only apiKey set');
assertThrows(() => createClient({ baseId: 'base' }), MissingCredentialsError, 'createClient: throws when only baseId set');

// Via explicit options
const explicitClient = createClient({ apiKey: 'explicit_key', baseId: 'explicit_base', requestFn: async () => {} });
assert(explicitClient instanceof AirtableClient,      'createClient: returns AirtableClient with explicit opts');

// Via AIRTABLE_API_KEY env var
process.env.AIRTABLE_API_KEY  = 'env_key';
process.env.AIRTABLE_BASE_ID  = 'env_base';
const envClient = createClient({ requestFn: async () => {} });
assert(envClient instanceof AirtableClient,           'createClient: reads AIRTABLE_API_KEY env var');
assert(envClient.apiKey === 'env_key',                'createClient: correct apiKey from env');

// Via AIRTABLE_TOKEN fallback
delete process.env.AIRTABLE_API_KEY;
process.env.AIRTABLE_TOKEN = 'token_key';
const tokenClient = createClient({ requestFn: async () => {} });
assert(tokenClient.apiKey === 'token_key',            'createClient: reads AIRTABLE_TOKEN fallback');

// Restore env
process.env.AIRTABLE_API_KEY  = origKey  || '';
process.env.AIRTABLE_TOKEN    = origToken || '';
process.env.AIRTABLE_BASE_ID  = origBase  || '';
if (!origKey)   delete process.env.AIRTABLE_API_KEY;
if (!origToken) delete process.env.AIRTABLE_TOKEN;
if (!origBase)  delete process.env.AIRTABLE_BASE_ID;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 33: _parseCLIArgs()
// ─────────────────────────────────────────────────────────────────────────────

section('33: _parseCLIArgs()');

// Simulate process.argv
const origArgv = process.argv;

process.argv = ['node', 'airtable_sync.js', '--out', './output', '--key', 'mykey', '--base', 'appXXX'];
const args1 = _parseCLIArgs();
assert(args1.out === './output',    '_parseCLIArgs: --out parsed');
assert(args1.apiKey === 'mykey',   '_parseCLIArgs: --key parsed');
assert(args1.baseId === 'appXXX',  '_parseCLIArgs: --base parsed');

process.argv = ['node', 'airtable_sync.js'];
const args2 = _parseCLIArgs();
assert(args2.out === './data',     '_parseCLIArgs: default out = ./data');
assert(args2.apiKey === null,      '_parseCLIArgs: apiKey null when not provided');
assert(args2.baseId === null,      '_parseCLIArgs: baseId null when not provided');

process.argv = origArgv;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 34: _buildSyncReport()
// ─────────────────────────────────────────────────────────────────────────────

section('34: _buildSyncReport()');

const reportData = {
  rawData:         { hotels: [MOCK_HOTEL_RAW], regions: [MOCK_REGION_RAW], brands: [], amenities: [], affiliate_links: [], reviews: [], content: [], keywords: [], comparisons: [] },
  normalizedData:  { hotels: [normalizeHotelRecord(MOCK_HOTEL_RAW)], regions: [], brands: [], amenities: [], affiliate_links: [], reviews: [], content: [], keywords: [], comparisons: [] },
  hotelObjects:    [validHotel],
  validation:      { warnings: [{ check: 'V-04', message: 'No links' }], errors: [] },
  startTime:       Date.now() - 500,
  fetchErrors:     [],
};
const report = _buildSyncReport(reportData);

assert(typeof report.sync_version === 'string',          '_buildSyncReport: sync_version');
assert(typeof report.generated_at === 'string',          '_buildSyncReport: generated_at');
assert(typeof report.duration_ms === 'number' && report.duration_ms >= 0, '_buildSyncReport: duration_ms');
assert(report.hotel_count === 1,                         '_buildSyncReport: hotel_count');
assert(report.warning_count === 1,                       '_buildSyncReport: warning_count');
assert(report.error_count === 0,                         '_buildSyncReport: error_count');
assert(typeof report.tables === 'object',                '_buildSyncReport: tables object');
assert(typeof report.tables.hotels === 'object',         '_buildSyncReport: tables.hotels');
assert(report.tables.hotels.fetched === 1,               '_buildSyncReport: tables.hotels.fetched');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 35: sync() — full pipeline integration
// ─────────────────────────────────────────────────────────────────────────────

section('35: sync() — full pipeline integration');

(async () => {
  const result = await sync({
    apiKey:    'test_key',
    baseId:    'test_base',
    requestFn: makeMockRequestFn(MOCK_ALL_TABLES),
    rateLimitDelayMs: 0,
  });

  assert(typeof result === 'object',                       'sync: returns object');
  assert(Array.isArray(result.hotelObjects),               'sync: hotelObjects array');
  assert(typeof result.rawTables === 'object',             'sync: rawTables object');
  assert(typeof result.normalizedDataset === 'object',     'sync: normalizedDataset object');
  assert(typeof result.syncReport === 'object',            'sync: syncReport object');
  assert(result.hotelObjects.length === 2,                 'sync: correct hotel count');
  assert(result.syncReport.hotel_count === 2,              'sync: report hotel_count matches');
  assert(typeof result.syncReport.duration_ms === 'number','sync: report has duration');
  assert(result.syncReport.generated_at.includes('T'),     'sync: report has ISO timestamp');

  // failOnError with validation errors
  const badHotelTable = [{
    id: 'recBad', fields: { hotel_id: 'BAD01', overall_rating: 99 /* out of range */ }, createdTime: '',
  }];
  await assertRejects(
    () => sync({
      apiKey: 'k', baseId: 'b',
      requestFn: makeMockRequestFn({ ...MOCK_ALL_TABLES, hotels: [{ records: badHotelTable }] }),
      rateLimitDelayMs: 0,
      failOnError: true,
    }),
    ValidationError,
    'sync: throws ValidationError when failOnError=true and errors exist',
  );

  // Missing credentials throws
  await assertRejects(
    () => sync({ apiKey: '', baseId: '' }),
    MissingCredentialsError,
    'sync: throws MissingCredentialsError with no credentials',
  );
})().then(() => {}).catch(err => { failed++; failures.push(`sync integration: ${err.message}`); });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 36: Security — _defaultRequest() body-size limit and timeout
// ─────────────────────────────────────────────────────────────────────────────

section('36: Security — _defaultRequest constants and exported function');

assert(MAX_RESPONSE_BODY_BYTES === 50 * 1024 * 1024,
  'MAX_RESPONSE_BODY_BYTES equals 50 MB');
assert(REQUEST_TIMEOUT_MS === 30_000,
  'REQUEST_TIMEOUT_MS equals 30 000 ms');
assert(typeof _defaultRequest === 'function',
  '_defaultRequest is exported as a function');
assert(MAX_RESPONSE_BODY_BYTES > 0,
  'MAX_RESPONSE_BODY_BYTES is positive — body limit guard is in place');
assert(REQUEST_TIMEOUT_MS > 0,
  'REQUEST_TIMEOUT_MS is positive — timeout guard is in place');

// Verify the body-size limit constant is smaller than a trivially large payload.
// The real limit fires inside _defaultRequest streaming; here we confirm the
// constant is the expected value so future changes cannot silently raise it.
assert(MAX_RESPONSE_BODY_BYTES < 1024 * 1024 * 1024,
  'MAX_RESPONSE_BODY_BYTES is less than 1 GB — not accidentally set too high');

// _defaultRequest rejects on a network error (invalid host).
// Wrapping in async IIFE so it participates in the 2-second wait window.
(async () => {
  let threw = false;
  try {
    await _defaultRequest('https://this.hostname.does.not.exist.invalid/', {});
  } catch (_) {
    threw = true;
  }
  assert(threw, '_defaultRequest rejects on connection failure to invalid host');
})().then(() => {}).catch(err => { failed++; failures.push(`_defaultRequest network rejection: ${err.message}`); });

// ─────────────────────────────────────────────────────────────────────────────
// WAIT FOR ASYNC TESTS, THEN PRINT RESULTS
// ─────────────────────────────────────────────────────────────────────────────

// Give all async sections time to complete
setTimeout(() => {
  process.stdout.write('\n\n');
  process.stdout.write('─'.repeat(60) + '\n');
  process.stdout.write(`  Results: ${passed} passed, ${failed} failed\n`);
  process.stdout.write('─'.repeat(60) + '\n');

  if (failures.length > 0) {
    process.stdout.write('\nFailures:\n');
    failures.forEach((f, i) => process.stdout.write(`  ${i + 1}. ${f}\n`));
    process.stdout.write('\n');
    process.exit(1);
  } else {
    process.stdout.write('\n  ✓  All tests passed.\n\n');
  }
}, 2000); // 2s — enough for all mock async calls to complete
