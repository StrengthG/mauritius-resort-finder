/**
 * airtable_sync.js
 * Mauritius Resort Finder — Airtable CMS Integration Layer
 * Version: 1.0.0
 *
 * Fetches data from the Airtable CMS, normalizes all relationships, validates
 * records, and exports clean hotel objects consumable by integration_harness.js.
 *
 * Architecture position: Layer 0 — Data Source (upstream of scoring_engine).
 * Upstream:    Airtable REST API
 * Downstream:  integration_harness.js → full pipeline
 *
 * Pipeline (4 stages):
 *   [1] Fetch     — fetchAllTables()    pulls all 9 tables with pagination
 *   [2] Normalize — normalizeDataset()  maps Airtable fields → internal schema
 *   [3] Build     — buildHotelObjects() joins relationships → scoring_engine format
 *   [4] Export    — saveSnapshot()      writes 4 JSON artifacts
 *
 * Programmatic API:
 *   createClient(options?)            → AirtableClient
 *   fetchAllTables(client)            → { hotels, regions, brands, amenities, ... }
 *   normalizeDataset(rawData)         → { hotels, regions, brands, amenities, ... }
 *   buildHotelObjects(normalizedData) → HotelObject[]
 *   validateHotelObjects(hotels)      → { warnings, errors }
 *   sync(options?)                    → full pipeline result
 *   saveSnapshot(outputDir, data)     → writes 4 files, returns filePaths
 *
 * Environment variables:
 *   AIRTABLE_API_KEY or AIRTABLE_TOKEN  — personal access token or API key
 *   AIRTABLE_BASE_ID                    — Airtable base ID (appXXXXXXXX)
 *
 * CLI usage:
 *   node airtable_sync.js --out ./data
 *   node airtable_sync.js --out ./data --base appXXXXXX --key patXXXXXX
 *
 * Output artifacts:
 *   raw_tables.json        — raw Airtable records by table
 *   normalized_dataset.json — normalized records by table
 *   hotels.json            — final HotelObject[] for integration_harness
 *   sync_report.json       — counts, warnings, errors, timing
 *
 * Airtable table field mapping:
 *   Hotels:          hotel_id, hotel_name (or Name), overall_rating, location_score,
 *                    amenity_score, brand_score, value_score, review_count, avg_rating,
 *                    avg_nightly_rate, star_rating, property_type, status,
 *                    region_id [linked], brand_id [linked]
 *   Regions:         region_id, region_name, country, sub_region
 *   Brands:          brand_id, brand_name, brand_tier, parent_company
 *   Amenities:       hotel_id [linked], amenity_key, is_present
 *   Affiliate Links: affiliate_id, hotel_id [linked], booking_url, provider,
 *                    commission_rate, commission_tier, is_active
 *   Reviews:         review_id, hotel_id [linked], review_count, avg_rating, review_source
 *   Content:         content_id, hotel_id [linked], content_type, content_text
 *   Keywords:        keyword_id, keyword, persona, target_slug
 *   Comparisons:     comparison_id, hotel_id_a [linked], hotel_id_b [linked], persona
 *
 * Design invariants:
 *   - No external dependencies — uses only Node.js built-in modules.
 *   - Deterministic: output sorted by hotel_id ascending.
 *   - No mutation of source records.
 *   - requestFn injectable for testing without a live Airtable base.
 *   - Compatible with future migration to Supabase via adapter pattern.
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL, URLSearchParams } = require('url');

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

const SYNC_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const AIRTABLE_API_BASE  = 'https://api.airtable.com/v0';
const DEFAULT_PAGE_SIZE  = 100;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RATE_LIMIT_DELAY_MS = 250;

// Security: cap the response body to prevent OOM from a malicious or runaway
// server response.  Airtable pages are typically < 1 MB; 50 MB is very generous.
const MAX_RESPONSE_BODY_BYTES = 50 * 1024 * 1024; // 50 MB

// Security: abort requests that take longer than this to avoid indefinite hangs.
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * All tables to fetch. Order determines fetch order.
 * Dimension tables (regions, brands) must be fetched before hotels for joining.
 */
const TABLE_NAMES = Object.freeze([
  'hotels',
  'regions',
  'brands',
  'amenities',
  'affiliate_links',
  'reviews',
  'content',
  'keywords',
  'comparisons',
]);

/**
 * Required fields for a hotel to qualify for scoring_engine.
 * Mirrors scoring_engine.js REQUIRED_FIELDS exactly.
 */
const HOTEL_REQUIRED_FIELDS = Object.freeze([
  'hotel_id',
  'hotel_name',
  'overall_rating',
  'location_score',
  'amenity_score',
  'brand_score',
  'value_score',
  'review_count',
  'avg_rating',
]);

/**
 * Score fields that must be numbers in range [0, 10].
 */
const SCORE_FIELDS_0_10 = Object.freeze([
  'overall_rating',
  'location_score',
  'amenity_score',
  'brand_score',
  'value_score',
  'avg_rating',
]);

/**
 * Airtable → internal field name map for the Hotels table.
 * Values starting with '_' are internal staging fields (linked refs).
 */
const HOTEL_FIELD_MAP = Object.freeze({
  hotel_id:         'hotel_id',
  hotel_name:       'hotel_name',
  Name:             'hotel_name',      // Airtable default first-field name
  overall_rating:   'overall_rating',
  location_score:   'location_score',
  amenity_score:    'amenity_score',
  brand_score:      'brand_score',
  value_score:      'value_score',
  review_count:     'review_count',
  avg_rating:       'avg_rating',
  avg_nightly_rate: 'avg_nightly_rate',
  star_rating:      'star_rating',
  property_type:    'property_type',
  status:           'status',
  region_id:        '_region_ref',     // linked record IDs (array of recXXX)
  brand_id:         '_brand_ref',      // linked record IDs
});

const REGION_FIELD_MAP = Object.freeze({
  region_id:   'region_id',
  region_name: 'region_name',
  Name:        'region_name',
  country:     'country',
  sub_region:  'sub_region',
});

const BRAND_FIELD_MAP = Object.freeze({
  brand_id:       'brand_id',
  brand_name:     'brand_name',
  Name:           'brand_name',
  brand_tier:     'brand_tier',
  parent_company: 'parent_company',
});

const AMENITY_FIELD_MAP = Object.freeze({
  hotel_id:    '_hotel_ref',   // linked record IDs
  amenity_key: 'amenity_key',
  is_present:  'is_present',
});

const AFFILIATE_LINK_FIELD_MAP = Object.freeze({
  affiliate_id:    'affiliate_id',
  hotel_id:        '_hotel_ref',   // linked record IDs
  booking_url:     'booking_url',
  provider:        'provider',
  commission_rate: 'commission_rate',
  commission_tier: 'commission_tier',
  is_active:       'is_active',
});

const REVIEW_FIELD_MAP = Object.freeze({
  review_id:     'review_id',
  hotel_id:      '_hotel_ref',   // linked record IDs
  review_count:  'review_count',
  avg_rating:    'avg_rating',
  review_source: 'review_source',
});

const CONTENT_FIELD_MAP = Object.freeze({
  content_id:   'content_id',
  hotel_id:     '_hotel_ref',
  content_type: 'content_type',
  content_text: 'content_text',
});

const KEYWORD_FIELD_MAP = Object.freeze({
  keyword_id:  'keyword_id',
  keyword:     'keyword',
  persona:     'persona',
  target_slug: 'target_slug',
});

const COMPARISON_FIELD_MAP = Object.freeze({
  comparison_id: 'comparison_id',
  hotel_id_a:    '_hotel_ref_a',  // linked record IDs
  hotel_id_b:    '_hotel_ref_b',
  persona:       'persona',
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

class SyncError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name    = 'SyncError';
    this.context = context;
  }
}

class AirtableApiError extends SyncError {
  constructor(message, status, context = {}) {
    super(message, { ...context, http_status: status });
    this.name   = 'AirtableApiError';
    this.status = status;
  }
}

class RateLimitError extends AirtableApiError {
  constructor(tableName, attempt) {
    super(
      `Rate limited on table "${tableName}" (attempt ${attempt})`,
      429, { tableName, attempt },
    );
    this.name = 'RateLimitError';
  }
}

class MissingCredentialsError extends SyncError {
  constructor() {
    super(
      'Airtable credentials not found. Set AIRTABLE_API_KEY (or AIRTABLE_TOKEN) and AIRTABLE_BASE_ID.',
    );
    this.name = 'MissingCredentialsError';
  }
}

class ValidationError extends SyncError {
  constructor(message, context = {}) {
    super(message, context);
    this.name = 'ValidationError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP LAYER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default HTTP GET implementation using Node.js built-in https module.
 * Resolves to { status, body } where body is a raw string.
 *
 * @param  {string} url
 * @param  {Object} headers
 * @returns {Promise<{ status: number, body: string }>}
 */
function _defaultRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers,
      method:   'GET',
      timeout:  REQUEST_TIMEOUT_MS,
    };
    const req = https.request(options, (res) => {
      let body         = '';
      let bytesReceived = 0;

      res.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_RESPONSE_BODY_BYTES) {
          // Destroy the socket immediately to stop further data transfer.
          res.destroy(new Error(
            `Response body exceeded limit of ${MAX_RESPONSE_BODY_BYTES} bytes`,
          ));
          return;
        }
        body += chunk;
      });

      res.on('end',  () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });

    // The 'timeout' option fires this event when the socket times out; we must
    // still explicitly destroy the request to trigger the 'error' event.
    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`));
    });

    req.on('error', reject);
    req.end();
  });
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// AIRTABLE CLIENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thin Airtable REST API client.
 * Handles pagination, rate-limit retries, and error classification.
 *
 * @param {Object}   opts
 * @param {string}   opts.apiKey            — personal access token or API key
 * @param {string}   opts.baseId            — Airtable base ID (appXXXXXXXX)
 * @param {Function} [opts.requestFn]       — injectable for testing (url, headers) => { status, body }
 * @param {number}   [opts.pageSize]        — records per page (default 100)
 * @param {number}   [opts.maxRetries]      — max retries on 429 (default 3)
 * @param {number}   [opts.rateLimitDelayMs]— base delay between retries ms (default 250)
 */
class AirtableClient {
  constructor(opts = {}) {
    if (!opts.apiKey)  throw new MissingCredentialsError();
    if (!opts.baseId)  throw new MissingCredentialsError();

    this.apiKey           = opts.apiKey;
    this.baseId           = opts.baseId;
    this.requestFn        = opts.requestFn        || _defaultRequest;
    this.pageSize         = opts.pageSize         || DEFAULT_PAGE_SIZE;
    this.maxRetries       = opts.maxRetries       || DEFAULT_MAX_RETRIES;
    this.rateLimitDelayMs = opts.rateLimitDelayMs || DEFAULT_RATE_LIMIT_DELAY_MS;
  }

  /**
   * Builds a full Airtable API URL for a table page request.
   * @param  {string} tableName
   * @param  {Object} params     — additional query params (e.g. offset)
   * @returns {string}
   */
  _buildUrl(tableName, params = {}) {
    const base  = `${AIRTABLE_API_BASE}/${this.baseId}/${encodeURIComponent(tableName)}`;
    const query = new URLSearchParams({ pageSize: String(this.pageSize), ...params });
    return `${base}?${query.toString()}`;
  }

  /**
   * Returns the Authorization header object.
   * @returns {Object}
   */
  _headers() {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /**
   * Fetches a single page of records from a table.
   * Retries on 429 with exponential backoff.
   *
   * @param  {string} tableName
   * @param  {Object} [params]   — query params (e.g. { offset: 'token' })
   * @returns {Promise<{ records: Object[], offset?: string }>}
   */
  async fetchPage(tableName, params = {}) {
    const url     = this._buildUrl(tableName, params);
    const headers = this._headers();
    let   lastErr;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await _sleep(this.rateLimitDelayMs * Math.pow(2, attempt - 1));
      }

      let result;
      try {
        result = await this.requestFn(url, headers);
      } catch (err) {
        throw new SyncError(`Network error fetching table "${tableName}": ${err.message}`, { tableName, cause: err });
      }

      const { status, body } = result;

      if (status === 200) {
        try {
          return JSON.parse(body);
        } catch (parseErr) {
          throw new SyncError(
            `Failed to parse Airtable response for table "${tableName}": ${parseErr.message}`,
            { tableName, body: body.slice(0, 200) },
          );
        }
      }

      if (status === 429) {
        lastErr = new RateLimitError(tableName, attempt + 1);
        continue; // retry
      }

      // Parse error body if possible
      let errBody = {};
      try { errBody = JSON.parse(body); } catch (_) {}
      throw new AirtableApiError(
        `Airtable API error for table "${tableName}": HTTP ${status} — ${errBody.error?.message || body.slice(0, 200)}`,
        status,
        { tableName, error: errBody },
      );
    }

    throw lastErr || new SyncError(`Max retries exceeded for table "${tableName}"`);
  }

  /**
   * Fetches all pages from a table, handling Airtable pagination automatically.
   * Returns all records across all pages as a flat array.
   *
   * @param  {string} tableName
   * @returns {Promise<Object[]>} — array of raw Airtable records
   */
  async fetchTable(tableName) {
    const records = [];
    let   offset  = null;

    do {
      const params = {};
      if (offset) params.offset = offset;
      const page = await this.fetchPage(tableName, params);
      records.push(...(page.records || []));
      offset = page.offset || null;
    } while (offset);

    return records;
  }
}

/**
 * Creates an AirtableClient from options or environment variables.
 *
 * @param  {Object} [opts]
 * @param  {string} [opts.apiKey]     — overrides env var
 * @param  {string} [opts.baseId]     — overrides env var
 * @param  {Function} [opts.requestFn]— injectable for testing
 * @returns {AirtableClient}
 */
function createClient(opts = {}) {
  const apiKey = opts.apiKey  || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  const baseId = opts.baseId  || process.env.AIRTABLE_BASE_ID;

  if (!apiKey || !baseId) throw new MissingCredentialsError();

  return new AirtableClient({
    apiKey,
    baseId,
    requestFn:        opts.requestFn        || null,
    pageSize:         opts.pageSize         || DEFAULT_PAGE_SIZE,
    maxRetries:       opts.maxRetries        || DEFAULT_MAX_RETRIES,
    rateLimitDelayMs: opts.rateLimitDelayMs  || DEFAULT_RATE_LIMIT_DELAY_MS,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE FETCHERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all 9 required tables in parallel (safe — different endpoints).
 * Returns raw Airtable records grouped by table name.
 *
 * @param  {AirtableClient} client
 * @returns {Promise<Object>} — { hotels: [...], regions: [...], ... }
 */
async function fetchAllTables(client) {
  if (!(client instanceof AirtableClient)) {
    throw new SyncError('fetchAllTables: first argument must be an AirtableClient instance');
  }

  // Fetch all tables in parallel — Airtable rate limits are per-base but
  // parallel fetches across different tables are safe at low concurrency.
  const results = await Promise.all(
    TABLE_NAMES.map((tableName) =>
      client.fetchTable(tableName)
        .then((records) => ({ tableName, records, error: null }))
        .catch((err)    => ({ tableName, records: [],  error: err }))
    )
  );

  const rawData = {};
  const errors  = [];

  for (const { tableName, records, error } of results) {
    rawData[tableName] = records;
    if (error) errors.push({ table: tableName, message: error.message });
  }

  if (errors.length > 0) {
    // Non-critical tables failing does not abort — hotels table failure is critical
    const hotelErr = errors.find((e) => e.table === 'hotels');
    if (hotelErr) {
      throw new SyncError(
        `Critical: failed to fetch hotels table — ${hotelErr.message}`,
        { errors },
      );
    }
    // Other table errors are surfaced in sync report but do not abort
    rawData._fetch_errors = errors;
  }

  return rawData;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORD NORMALIZERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies a field map to an Airtable record's fields object.
 * Maps Airtable field names → internal names, skipping unmapped fields.
 * Preserves the Airtable record ID as `_airtable_id`.
 *
 * @param  {Object} record   — raw Airtable record { id, fields, createdTime }
 * @param  {Object} fieldMap — { airtableFieldName: internalFieldName }
 * @returns {Object}         — normalized record
 */
function _applyFieldMap(record, fieldMap) {
  const out = { _airtable_id: record.id };
  const fields = record.fields || {};

  for (const [airtableKey, internalKey] of Object.entries(fieldMap)) {
    const value = fields[airtableKey];
    if (value === undefined || value === null) continue;

    // Never overwrite with a null/undefined — later field aliases can win
    if (out[internalKey] === undefined) {
      out[internalKey] = value;
    }
  }

  return out;
}

/**
 * Extracts the first linked record ID from an Airtable linked-record field.
 * Airtable returns linked fields as an array of record IDs: ["recXXXX"].
 * Returns null if the field is empty or not an array.
 *
 * @param  {*} linkedField
 * @returns {string|null}
 */
function _firstLinkedId(linkedField) {
  if (!Array.isArray(linkedField) || linkedField.length === 0) return null;
  return linkedField[0];
}

/**
 * Normalizes a raw Hotels Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeHotelRecord(record) {
  const n = _applyFieldMap(record, HOTEL_FIELD_MAP);

  // Resolve linked fields from array to first ID
  n._region_ref = _firstLinkedId(n._region_ref);
  n._brand_ref  = _firstLinkedId(n._brand_ref);

  // Coerce numerics
  const numericFields = [
    'overall_rating', 'location_score', 'amenity_score',
    'brand_score', 'value_score', 'avg_rating', 'avg_nightly_rate',
    'star_rating', 'review_count',
  ];
  for (const field of numericFields) {
    if (n[field] !== undefined && n[field] !== null) {
      n[field] = Number(n[field]);
    }
  }

  // Default status
  if (!n.status) n.status = 'active';

  return n;
}

/**
 * Normalizes a raw Regions Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeRegionRecord(record) {
  return _applyFieldMap(record, REGION_FIELD_MAP);
}

/**
 * Normalizes a raw Brands Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeBrandRecord(record) {
  const n = _applyFieldMap(record, BRAND_FIELD_MAP);
  if (n.brand_tier !== undefined) n.brand_tier = Number(n.brand_tier);
  return n;
}

/**
 * Normalizes a raw Amenities Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeAmenityRecord(record) {
  const n = _applyFieldMap(record, AMENITY_FIELD_MAP);
  n._hotel_ref  = _firstLinkedId(n._hotel_ref);
  // Normalize boolean — Airtable checkboxes can arrive as true/false or missing (= false)
  n.is_present  = n.is_present === true;
  return n;
}

/**
 * Normalizes a raw Affiliate Links Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeAffiliateLinkRecord(record) {
  const n = _applyFieldMap(record, AFFILIATE_LINK_FIELD_MAP);
  n._hotel_ref     = _firstLinkedId(n._hotel_ref);
  n.commission_rate = (n.commission_rate !== undefined) ? Number(n.commission_rate) : null;
  n.is_active       = n.is_active !== false; // default true if missing
  return n;
}

/**
 * Normalizes a raw Reviews Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeReviewRecord(record) {
  const n = _applyFieldMap(record, REVIEW_FIELD_MAP);
  n._hotel_ref  = _firstLinkedId(n._hotel_ref);
  if (n.review_count !== undefined) n.review_count = Number(n.review_count);
  if (n.avg_rating   !== undefined) n.avg_rating   = Number(n.avg_rating);
  return n;
}

/**
 * Normalizes a raw Content Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeContentRecord(record) {
  const n = _applyFieldMap(record, CONTENT_FIELD_MAP);
  n._hotel_ref = _firstLinkedId(n._hotel_ref);
  return n;
}

/**
 * Normalizes a raw Keywords Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeKeywordRecord(record) {
  return _applyFieldMap(record, KEYWORD_FIELD_MAP);
}

/**
 * Normalizes a raw Comparisons Airtable record.
 * @param  {Object} record
 * @returns {Object}
 */
function normalizeComparisonRecord(record) {
  const n = _applyFieldMap(record, COMPARISON_FIELD_MAP);
  n._hotel_ref_a = _firstLinkedId(n._hotel_ref_a);
  n._hotel_ref_b = _firstLinkedId(n._hotel_ref_b);
  return n;
}

/**
 * Normalizes all tables from raw Airtable records to internal schema.
 *
 * @param  {Object} rawData — { hotels: [...], regions: [...], ... }
 * @returns {Object}        — { hotels: [...], regions: [...], ... }
 */
function normalizeDataset(rawData) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new SyncError('normalizeDataset: rawData must be a plain object');
  }

  const normalizers = {
    hotels:          normalizeHotelRecord,
    regions:         normalizeRegionRecord,
    brands:          normalizeBrandRecord,
    amenities:       normalizeAmenityRecord,
    affiliate_links: normalizeAffiliateLinkRecord,
    reviews:         normalizeReviewRecord,
    content:         normalizeContentRecord,
    keywords:        normalizeKeywordRecord,
    comparisons:     normalizeComparisonRecord,
  };

  const normalized = {};
  for (const [table, normalizeFn] of Object.entries(normalizers)) {
    const records = rawData[table];
    if (!Array.isArray(records)) {
      normalized[table] = [];
      continue;
    }
    normalized[table] = records.map((r, i) => {
      try {
        return normalizeFn(r);
      } catch (err) {
        // Return a partial record with error annotation rather than crashing
        return { _airtable_id: r?.id || `_unknown_${i}`, _normalize_error: err.message };
      }
    });
  }

  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP MAP BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a lookup map keyed by Airtable record ID (`_airtable_id`).
 * Used to resolve linked record references.
 *
 * @param  {Object[]} records  — normalized records with _airtable_id
 * @returns {Object}           — { [_airtable_id]: record }
 */
function buildLookupMap(records) {
  if (!Array.isArray(records)) return {};
  const map = {};
  for (const record of records) {
    if (record && record._airtable_id) {
      map[record._airtable_id] = record;
    }
  }
  return map;
}

/**
 * Builds an index of child records keyed by a parent hotel Airtable ID.
 * Used to group amenities, affiliate_links, reviews by hotel.
 *
 * @param  {Object[]} records   — child records with _hotel_ref
 * @param  {string}   refField  — field holding the parent ID (default '_hotel_ref')
 * @returns {Object}            — { [hotelAirtableId]: record[] }
 */
function buildChildIndex(records, refField = '_hotel_ref') {
  if (!Array.isArray(records)) return {};
  const index = {};
  for (const record of records) {
    const parentId = record && record[refField];
    if (!parentId) continue;
    if (!index[parentId]) index[parentId] = [];
    index[parentId].push(record);
  }
  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOTEL OBJECT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the amenities object for a hotel from its child amenity records.
 * Returns { spa: true, private_beach: false, ... }
 *
 * @param  {Object[]} amenityRecords
 * @returns {Object}
 */
function _buildAmenitiesObject(amenityRecords) {
  const amenities = {};
  for (const record of (amenityRecords || [])) {
    if (record.amenity_key && typeof record.amenity_key === 'string') {
      amenities[record.amenity_key] = record.is_present === true;
    }
  }
  return amenities;
}

/**
 * Converts normalized datasets into final HotelObject[] consumable by
 * integration_harness.js / scoring_engine.js.
 *
 * Output schema matches scoring_engine.js REQUIRED_FIELDS + OPTIONAL_FIELDS exactly.
 *
 * @param  {Object} normalizedData — { hotels, regions, brands, amenities, affiliate_links, reviews, ... }
 * @returns {Object[]} HotelObject[]
 */
function buildHotelObjects(normalizedData) {
  if (!normalizedData || typeof normalizedData !== 'object') {
    throw new SyncError('buildHotelObjects: normalizedData must be a plain object');
  }

  const hotels         = normalizedData.hotels          || [];
  const regions        = normalizedData.regions         || [];
  const brands         = normalizedData.brands          || [];
  const amenities      = normalizedData.amenities       || [];
  const affiliateLinks = normalizedData.affiliate_links || [];
  const reviews        = normalizedData.reviews         || [];

  // Build lookup maps
  const regionsById    = buildLookupMap(regions);
  const brandsById     = buildLookupMap(brands);

  // Build child indexes (keyed by hotel Airtable record ID)
  const amenitiesByHotel   = buildChildIndex(amenities,      '_hotel_ref');
  const affiliatesByHotel  = buildChildIndex(affiliateLinks, '_hotel_ref');
  const reviewsByHotel     = buildChildIndex(reviews,        '_hotel_ref');

  const hotelObjects = hotels
    .filter((hotel) => !hotel._normalize_error)         // skip failed normalizations
    .filter((hotel) => hotel.status !== 'inactive')     // skip deactivated hotels
    .map((hotel) => {
      const airtableId = hotel._airtable_id;

      // ── Region join ─────────────────────────────────────────────────────
      const region     = hotel._region_ref ? regionsById[hotel._region_ref] : null;
      const regionName = region ? (region.region_name || region.region_id || null) : null;

      // ── Brand join ──────────────────────────────────────────────────────
      const brand      = hotel._brand_ref ? brandsById[hotel._brand_ref] : null;

      // ── Amenities join ──────────────────────────────────────────────────
      const hotelAmenities = _buildAmenitiesObject(amenitiesByHotel[airtableId]);

      // ── Affiliate links join ─────────────────────────────────────────────
      const hotelLinks  = (affiliatesByHotel[airtableId] || [])
        .filter((l) => l.is_active !== false);
      const primaryLink = hotelLinks[0] || null;
      const commRate    = primaryLink ? primaryLink.commission_rate : null;

      // ── Reviews join ─────────────────────────────────────────────────────
      // If reviews table provides richer data, prefer it over hotel-level fields.
      const reviewRecords = reviewsByHotel[airtableId] || [];
      const primaryReview = reviewRecords[0] || null;
      const reviewCount   = hotel.review_count
        ?? (primaryReview ? primaryReview.review_count : null);
      const avgRating     = hotel.avg_rating
        ?? (primaryReview ? primaryReview.avg_rating : null);

      // ── Build final HotelObject ──────────────────────────────────────────
      return {
        // ── Required by scoring_engine ────────────────────────────────────
        hotel_id:          hotel.hotel_id       || null,
        hotel_name:        hotel.hotel_name     || null,
        overall_rating:    hotel.overall_rating ?? null,
        location_score:    hotel.location_score ?? null,
        amenity_score:     hotel.amenity_score  ?? null,
        brand_score:       hotel.brand_score    ?? null,
        value_score:       hotel.value_score    ?? null,
        review_count:      reviewCount          ?? null,
        avg_rating:        avgRating            ?? null,

        // ── Optional (improve scoring completeness) ───────────────────────
        affiliate_commission_rate: (commRate !== null && !isNaN(commRate)) ? commRate : undefined,
        amenities:         Object.keys(hotelAmenities).length > 0 ? hotelAmenities : undefined,
        region:            regionName                   || undefined,
        price_per_night_usd: hotel.avg_nightly_rate    || undefined,
        star_rating:       hotel.star_rating            || undefined,
        property_type:     hotel.property_type          || undefined,

        // ── Audit metadata (not used by scoring_engine) ───────────────────
        _airtable_id:      airtableId,
        _status:           hotel.status,
        _brand_name:       brand ? brand.brand_name : null,
        _brand_tier:       brand ? brand.brand_tier : null,
        _region_id:        region ? region.region_id : null,
        _affiliate_links:  hotelLinks.map((l) => ({
          booking_url:     l.booking_url,
          provider:        l.provider,
          commission_rate: l.commission_rate,
          commission_tier: l.commission_tier,
        })),
        _avg_nightly_rate: hotel.avg_nightly_rate || null,
      };
    });

  // Deterministic sort: by hotel_id ascending (nulls last)
  hotelObjects.sort((a, b) => {
    if (a.hotel_id === null && b.hotel_id === null) return 0;
    if (a.hotel_id === null) return 1;
    if (b.hotel_id === null) return -1;
    return String(a.hotel_id).localeCompare(String(b.hotel_id));
  });

  return hotelObjects;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the built hotel objects against known invariants.
 * Returns structured warnings and errors (does not throw).
 *
 * Checks:
 *   [V-01] Missing required fields
 *   [V-02] Invalid score ranges (0–10)
 *   [V-03] Duplicate hotel_ids
 *   [V-04] Missing active affiliate links
 *   [V-05] Orphan child records (amenities, reviews without a matched hotel)
 *   [V-06] review_count non-negative integer
 *
 * @param  {Object[]} hotels     — output of buildHotelObjects()
 * @param  {Object}   normalizedData — for orphan checks
 * @returns {{ warnings: Object[], errors: Object[] }}
 */
function validateHotelObjects(hotels, normalizedData = {}) {
  const warnings = [];
  const errors   = [];
  const seenIds  = new Set();

  function warn(hotel_id, check, message) {
    warnings.push({ hotel_id, check, message });
  }
  function error(hotel_id, check, message) {
    errors.push({ hotel_id, check, message });
  }

  // ── [V-01] Required fields ───────────────────────────────────────────────
  for (const hotel of hotels) {
    const id = hotel.hotel_id || '(unknown)';
    for (const field of HOTEL_REQUIRED_FIELDS) {
      if (hotel[field] === null || hotel[field] === undefined) {
        error(id, 'V-01', `Missing required field: "${field}"`);
      }
    }
  }

  // ── [V-02] Score ranges ──────────────────────────────────────────────────
  for (const hotel of hotels) {
    const id = hotel.hotel_id || '(unknown)';
    for (const field of SCORE_FIELDS_0_10) {
      const v = hotel[field];
      if (v !== null && v !== undefined) {
        if (typeof v !== 'number' || isNaN(v)) {
          error(id, 'V-02', `Field "${field}" must be a number, got ${JSON.stringify(v)}`);
        } else if (v < 0 || v > 10) {
          error(id, 'V-02', `Field "${field}" out of range [0, 10]: ${v}`);
        }
      }
    }
  }

  // ── [V-03] Duplicate hotel_ids ───────────────────────────────────────────
  for (const hotel of hotels) {
    const id = hotel.hotel_id;
    if (!id) continue;
    if (seenIds.has(id)) {
      error(id, 'V-03', `Duplicate hotel_id: "${id}"`);
    } else {
      seenIds.add(id);
    }
  }

  // ── [V-04] Missing affiliate links ──────────────────────────────────────
  for (const hotel of hotels) {
    const id = hotel.hotel_id || '(unknown)';
    if (!hotel._affiliate_links || hotel._affiliate_links.length === 0) {
      warn(id, 'V-04', `No active affiliate links found for hotel "${id}"`);
    }
  }

  // ── [V-05] Orphan child records ──────────────────────────────────────────
  if (normalizedData.amenities && normalizedData.hotels) {
    const hotelAirtableIds = new Set(
      (normalizedData.hotels || []).map((h) => h._airtable_id).filter(Boolean)
    );
    for (const amenity of (normalizedData.amenities || [])) {
      if (amenity._hotel_ref && !hotelAirtableIds.has(amenity._hotel_ref)) {
        warn(amenity._hotel_ref, 'V-05', `Orphan amenity record — hotel Airtable ID "${amenity._hotel_ref}" not found in hotels table`);
      }
    }
    for (const review of (normalizedData.reviews || [])) {
      if (review._hotel_ref && !hotelAirtableIds.has(review._hotel_ref)) {
        warn(review._hotel_ref, 'V-05', `Orphan review record — hotel Airtable ID "${review._hotel_ref}" not found in hotels table`);
      }
    }
  }

  // ── [V-06] review_count ──────────────────────────────────────────────────
  for (const hotel of hotels) {
    const id = hotel.hotel_id || '(unknown)';
    const rc = hotel.review_count;
    if (rc !== null && rc !== undefined) {
      if (typeof rc !== 'number' || isNaN(rc) || rc < 0) {
        error(id, 'V-06', `review_count must be a non-negative number, got ${JSON.stringify(rc)}`);
      }
    }
  }

  return { warnings, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT EXPORTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves all pipeline artifacts to the output directory.
 * Creates the directory if it does not exist.
 *
 * Artifacts:
 *   raw_tables.json         — raw Airtable records by table
 *   normalized_dataset.json — normalized records by table
 *   hotels.json             — final HotelObject[] for integration_harness
 *   sync_report.json        — counts, warnings, errors, timing
 *
 * @param  {string} outputDir
 * @param  {Object} data       — { rawTables, normalizedDataset, hotelObjects, syncReport }
 * @returns {{ [filename]: string }} — map of filename → absolute file path
 */
function saveSnapshot(outputDir, data) {
  if (!outputDir || typeof outputDir !== 'string') {
    throw new SyncError('saveSnapshot: outputDir must be a non-empty string');
  }
  if (!data || typeof data !== 'object') {
    throw new SyncError('saveSnapshot: data must be a plain object');
  }

  const resolved = path.resolve(outputDir);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }

  const files = {
    'raw_tables.json':         data.rawTables        || {},
    'normalized_dataset.json': data.normalizedDataset || {},
    'hotels.json':             data.hotelObjects      || [],
    'sync_report.json':        data.syncReport        || {},
  };

  const filePaths = {};
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(resolved, filename);
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
    filePaths[filename] = filePath;
  }

  return filePaths;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC REPORT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the sync_report.json structure.
 *
 * @param  {Object} opts
 * @returns {Object}
 */
function _buildSyncReport(opts) {
  const {
    rawData, normalizedData, hotelObjects, validation, startTime, fetchErrors,
  } = opts;

  const tables = {};
  for (const table of TABLE_NAMES) {
    tables[table] = {
      fetched:    (rawData[table]        || []).length,
      normalized: (normalizedData[table] || []).length,
      errors:     (fetchErrors || []).filter((e) => e.table === table).length,
    };
  }

  return {
    sync_version:  SYNC_VERSION,
    generated_at:  new Date().toISOString(),
    duration_ms:   Date.now() - startTime,
    tables,
    hotel_count:   hotelObjects.length,
    warning_count: validation.warnings.length,
    error_count:   validation.errors.length,
    warnings:      validation.warnings,
    errors:        validation.errors,
    fetch_errors:  fetchErrors || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the complete Airtable sync pipeline:
 *   1. Create client (from options or env vars)
 *   2. fetchAllTables()
 *   3. normalizeDataset()
 *   4. buildHotelObjects()
 *   5. validateHotelObjects()
 *   6. Build sync report
 *
 * @param  {Object} [options]
 * @param  {string}   [options.apiKey]      — overrides env var
 * @param  {string}   [options.baseId]      — overrides env var
 * @param  {Function} [options.requestFn]   — injectable for testing
 * @param  {boolean}  [options.failOnError] — throw if critical errors found (default false)
 * @returns {Promise<{
 *   rawTables:         Object,
 *   normalizedDataset: Object,
 *   hotelObjects:      Object[],
 *   syncReport:        Object,
 * }>}
 */
async function sync(options = {}) {
  const startTime = Date.now();
  const client    = createClient(options);

  // Stage 1: Fetch
  const rawTables = await fetchAllTables(client);
  const fetchErrors = rawTables._fetch_errors || [];
  delete rawTables._fetch_errors; // clean before export

  // Stage 2: Normalize
  const normalizedDataset = normalizeDataset(rawTables);

  // Stage 3: Build
  const hotelObjects = buildHotelObjects(normalizedDataset);

  // Stage 4: Validate
  const validation = validateHotelObjects(hotelObjects, normalizedDataset);

  // Stage 5: Report
  const syncReport = _buildSyncReport({
    rawData: rawTables, normalizedData: normalizedDataset,
    hotelObjects, validation, startTime, fetchErrors,
  });

  if (options.failOnError && validation.errors.length > 0) {
    throw new ValidationError(
      `Sync completed with ${validation.errors.length} validation error(s). See syncReport.errors for details.`,
      { errors: validation.errors },
    );
  }

  return { rawTables, normalizedDataset, hotelObjects, syncReport };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function _parseCLIArgs() {
  const args = process.argv.slice(2);
  const result = { out: './data', apiKey: null, baseId: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out'  && args[i + 1]) result.out    = args[++i];
    if (args[i] === '--key'  && args[i + 1]) result.apiKey = args[++i];
    if (args[i] === '--base' && args[i + 1]) result.baseId = args[++i];
  }
  return result;
}

async function main() {
  const cli = _parseCLIArgs();
  const t0  = Date.now();

  process.stdout.write(`\nMauritius Resort Finder — Airtable Sync v${SYNC_VERSION}\n`);
  process.stdout.write(`Output: ${path.resolve(cli.out)}\n\n`);

  let result;
  try {
    result = await sync({
      apiKey:    cli.apiKey || undefined,
      baseId:    cli.baseId || undefined,
    });
  } catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    if (err.context) process.stderr.write(`  Context: ${JSON.stringify(err.context)}\n`);
    process.exit(1);
  }

  const paths = saveSnapshot(cli.out, result);
  const r     = result.syncReport;

  process.stdout.write(`Hotels fetched:    ${r.tables.hotels.fetched}\n`);
  process.stdout.write(`Hotels normalized: ${r.hotel_count}\n`);
  process.stdout.write(`Warnings:          ${r.warning_count}\n`);
  process.stdout.write(`Errors:            ${r.error_count}\n`);
  process.stdout.write(`Duration:          ${r.duration_ms} ms\n\n`);

  for (const [filename, filePath] of Object.entries(paths)) {
    const bytes = fs.statSync(filePath).size;
    process.stdout.write(`✓ ${filename}  (${(bytes / 1024).toFixed(1)} KB)\n`);
  }

  if (r.error_count > 0) {
    process.stdout.write(`\n⚠ ${r.error_count} validation error(s) in sync_report.json\n`);
  }
  process.stdout.write(`\n✓ Sync complete in ${Date.now() - t0} ms\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Public API
  createClient,
  fetchAllTables,
  normalizeDataset,
  buildHotelObjects,
  validateHotelObjects,
  sync,
  saveSnapshot,

  // Per-table normalizers (exported for testing)
  normalizeHotelRecord,
  normalizeRegionRecord,
  normalizeBrandRecord,
  normalizeAmenityRecord,
  normalizeAffiliateLinkRecord,
  normalizeReviewRecord,
  normalizeContentRecord,
  normalizeKeywordRecord,
  normalizeComparisonRecord,

  // Helpers (exported for testing)
  buildLookupMap,
  buildChildIndex,
  _applyFieldMap,
  _firstLinkedId,
  _parseCLIArgs,
  _buildSyncReport,
  _defaultRequest,

  // Security constants (exported for testing and observability)
  MAX_RESPONSE_BODY_BYTES,
  REQUEST_TIMEOUT_MS,

  // Client class
  AirtableClient,

  // Error types
  SyncError,
  AirtableApiError,
  RateLimitError,
  MissingCredentialsError,
  ValidationError,

  // Constants
  SYNC_VERSION,
  TABLE_NAMES,
  HOTEL_REQUIRED_FIELDS,
  SCORE_FIELDS_0_10,
  HOTEL_FIELD_MAP,
  AIRTABLE_API_BASE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RATE_LIMIT_DELAY_MS,
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[FATAL] Unhandled error: ${err.message}\n`);
    process.exit(1);
  });
}
