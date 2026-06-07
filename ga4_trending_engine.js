/**
 * ga4_trending_engine.js
 * Mauritius Resort Finder — GA4 Data API Trending Engine
 *
 * Pulls resort engagement signals from GA4, calculates four trending
 * dimensions, caches results daily, and fails gracefully to a default
 * data set derived from hotel ratings when the API is unavailable.
 *
 * Authentication: Google service account (RS256 JWT → OAuth2 access token).
 * All auth and HTTP handled with Node.js built-ins (crypto, https) — zero
 * external npm dependencies.
 *
 * Environment variables:
 *   GA4_PROPERTY_ID           — numeric GA4 property ID (e.g. "123456789")
 *   GOOGLE_SERVICE_ACCOUNT_KEY — base64-encoded service account JSON key
 *
 * Outputs:
 *   data/trending-cache.json  — daily cache (source of truth between builds)
 *   (returned object)         — { trending, fastest_growing, most_compared, most_saved, generated_at, source }
 */

'use strict';

const crypto = require('crypto');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_PATH   = path.join(__dirname, 'data', 'trending-cache.json');
const CACHE_TTL_MS = 23 * 60 * 60 * 1000;   // 23 hours
const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const GA4_HOST     = 'analyticsdata.googleapis.com';
const GA4_VERSION  = 'v1beta';
const SCOPE        = 'https://www.googleapis.com/auth/analytics.readonly';

const MAX_TRENDING = 6;
const MAX_GROWING  = 5;
const MAX_COMPARED = 5;
const MAX_SAVED    = 5;

// Weights for the composite trending score
const W_PAGEVIEW  = 1;
const W_CLICK     = 2;
const W_COMPARE   = 3;
const W_WISHLIST  = 5;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function _base64url(data) {
  const b64 = (typeof data === 'string')
    ? Buffer.from(data, 'utf8').toString('base64')
    : Buffer.from(data).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _slugify(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION  (service account → OAuth2 access token)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a signed RS256 JWT for Google service account auth.
 *
 * @param  {Object} saKey — parsed service account JSON
 * @returns {string}
 */
function _buildJWT(saKey) {
  if (!saKey || !saKey.client_email || !saKey.private_key) {
    throw new Error('_buildJWT: saKey must have client_email and private_key');
  }

  const now    = Math.floor(Date.now() / 1000);
  const header = _base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = _base64url(JSON.stringify({
    iss:   saKey.client_email,
    scope: SCOPE,
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  }));

  const sigInput = `${header}.${claim}`;
  const signer   = crypto.createSign('RSA-SHA256');
  signer.update(sigInput, 'utf8');
  const sig = signer.sign(saKey.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${sigInput}.${sig}`;
}

/**
 * Exchange a signed JWT for a Google OAuth2 access token.
 *
 * @param  {Object} saKey — service account JSON
 * @returns {Promise<string>} access token
 */
async function _getAccessToken(saKey) {
  const jwt  = _buildJWT(saKey);
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`;

  const data = await _httpsRequest({
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers: {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP  (built-in https — no external deps)
// ─────────────────────────────────────────────────────────────────────────────

function _httpsRequest({ hostname, path: urlPath, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path: urlPath, method, headers };
    const req  = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 400)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`JSON parse error (status ${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * POST a JSON body to the GA4 Data API and return parsed response.
 *
 * @param  {string} propertyId — numeric GA4 property ID
 * @param  {Object} body       — request body
 * @param  {string} token      — OAuth2 access token
 * @returns {Promise<Object>}
 */
async function _ga4Report(propertyId, body, token) {
  const bodyStr = JSON.stringify(body);
  return _httpsRequest({
    hostname: GA4_HOST,
    path:     `/${GA4_VERSION}/properties/${propertyId}:runReport`,
    method:   'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    },
    body: bodyStr,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GA4 REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch hotel detail page views for two consecutive 7-day windows.
 * Returns { current: Map(path→views), previous: Map(path→views) }
 *
 * @param  {string} propertyId
 * @param  {string} token
 */
async function _fetchPageViews(propertyId, token) {
  const resp = await _ga4Report(propertyId, {
    dateRanges: [
      { startDate: '7daysAgo',  endDate: 'today',     name: 'current'  },
      { startDate: '14daysAgo', endDate: '8daysAgo',  name: 'previous' },
    ],
    dimensions: [{ name: 'pagePath' }, { name: 'dateRange' }],
    metrics:    [{ name: 'screenPageViews' }],
    dimensionFilter: {
      filter: {
        fieldName:     'pagePath',
        stringFilter:  { matchType: 'BEGINS_WITH', value: '/hotels/' },
      },
    },
    limit: 1000,
  }, token);

  return _parsePageViewResponse(resp);
}

/**
 * Fetch custom event counts (resort_click, wishlist_add, compare_add) with hotel_id dimension.
 * Returns null if the custom dimension is not registered in GA4.
 *
 * @param  {string} propertyId
 * @param  {string} token
 */
async function _fetchCustomEvents(propertyId, token) {
  try {
    const resp = await _ga4Report(propertyId, {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [
        { name: 'eventName' },
        { name: 'customEvent:hotel_id' },
      ],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName:    'eventName',
          inListFilter: { values: ['resort_click', 'wishlist_add', 'compare_add'] },
        },
      },
      limit: 5000,
    }, token);

    return _parseEventResponse(resp);
  } catch (err) {
    // Custom dimension not registered — return empty but don't crash
    if (err.message.includes('400') || err.message.includes('INVALID_ARGUMENT')) {
      return { clicks: new Map(), wishlist: new Map(), compares: new Map() };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE PARSERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse GA4 page-view runReport response into {current, previous} Maps.
 * Keys are page paths (/hotels/hotel-slug/), values are view counts.
 */
function _parsePageViewResponse(resp) {
  const current  = new Map();
  const previous = new Map();

  if (!resp || !Array.isArray(resp.rows)) return { current, previous };

  for (const row of resp.rows) {
    const pagePath   = (row.dimensionValues[0] || {}).value || '';
    const dateRange  = (row.dimensionValues[1] || {}).value || '';
    const views      = parseInt((row.metricValues[0] || {}).value || '0', 10);

    if (!pagePath.startsWith('/hotels/')) continue;

    if (dateRange === 'current')  current.set(pagePath,  (current.get(pagePath)  || 0) + views);
    if (dateRange === 'previous') previous.set(pagePath, (previous.get(pagePath) || 0) + views);
  }

  return { current, previous };
}

/**
 * Parse GA4 custom-event runReport response into {clicks, wishlist, compares} Maps.
 * Keys are hotel_id strings, values are event counts.
 */
function _parseEventResponse(resp) {
  const clicks   = new Map();
  const wishlist = new Map();
  const compares = new Map();

  if (!resp || !Array.isArray(resp.rows)) return { clicks, wishlist, compares };

  for (const row of resp.rows) {
    const eventName = (row.dimensionValues[0] || {}).value || '';
    const hotelId   = (row.dimensionValues[1] || {}).value || '';
    const count     = parseInt((row.metricValues[0] || {}).value || '0', 10);

    if (!hotelId || hotelId === '(not set)') continue;

    if (eventName === 'resort_click')  clicks.set(hotelId,   (clicks.get(hotelId)   || 0) + count);
    if (eventName === 'wishlist_add')  wishlist.set(hotelId, (wishlist.get(hotelId)  || 0) + count);
    if (eventName === 'compare_add')   compares.set(hotelId, (compares.get(hotelId)  || 0) + count);
  }

  return { clicks, wishlist, compares };
}

// ─────────────────────────────────────────────────────────────────────────────
// SLUG → HOTEL ID MAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a Map from page path (/hotels/hotel-slug/) → hotel_id.
 * Used to convert GA4 pagePath dimension back to hotel_id.
 *
 * @param  {Object[]} hotels
 * @returns {Map<string, string>}
 */
function _buildSlugMap(hotels) {
  const map = new Map();
  for (const h of hotels) {
    if (!h.hotel_id || !h.hotel_name) continue;
    const slug = _slugify(h.hotel_name);
    map.set(`/hotels/${slug}/`, h.hotel_id);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRENDING CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a compact hotel lookup by hotel_id.
 */
function _hotelLookup(hotels) {
  const map = new Map();
  for (const h of hotels) {
    if (h.hotel_id) map.set(h.hotel_id, h);
  }
  return map;
}

/**
 * Calculate composite trending score for each hotel.
 * Returns sorted array of { hotel_id, name, slug, region, rating, stars, score } (top N).
 */
function _calculateTrending(pageViewsCurrent, events, hotels) {
  const slugMap  = _buildSlugMap(hotels);
  const hotelMap = _hotelLookup(hotels);
  const scores   = new Map();

  // Page views → hotel_id
  for (const [pagePath, views] of pageViewsCurrent) {
    const id = slugMap.get(pagePath);
    if (!id) continue;
    scores.set(id, (scores.get(id) || 0) + views * W_PAGEVIEW);
  }

  // Custom events
  for (const [id, count] of (events.clicks   || new Map())) scores.set(id, (scores.get(id) || 0) + count * W_CLICK);
  for (const [id, count] of (events.wishlist || new Map())) scores.set(id, (scores.get(id) || 0) + count * W_WISHLIST);
  for (const [id, count] of (events.compares || new Map())) scores.set(id, (scores.get(id) || 0) + count * W_COMPARE);

  const maxScore = Math.max(...scores.values(), 1);

  return [...scores.entries()]
    .map(([id, rawScore]) => {
      const h = hotelMap.get(id);
      if (!h) return null;
      return {
        hotel_id: id,
        name:     h.hotel_name,
        slug:     _slugify(h.hotel_name),
        region:   h.region || '',
        rating:   h.overall_rating || null,
        stars:    h.star_rating    || null,
        score:    Math.round((rawScore / maxScore) * 100),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TRENDING);
}

/**
 * Calculate fastest-growing hotels: biggest % increase in page views vs previous period.
 */
function _calculateFastestGrowing(pageViewsCurrent, pageViewsPrevious, hotels) {
  const slugMap  = _buildSlugMap(hotels);
  const hotelMap = _hotelLookup(hotels);
  const results  = [];

  for (const [pagePath, current] of pageViewsCurrent) {
    const id  = slugMap.get(pagePath);
    if (!id) continue;
    const prev     = pageViewsPrevious.get(pagePath) || 0;
    const growthPct = prev > 0
      ? Math.round(((current - prev) / prev) * 100)
      : (current > 0 ? 999 : 0);   // 999 = new/no prior data

    if (current < 5) continue;  // suppress noise from near-zero baselines

    const h = hotelMap.get(id);
    if (!h) continue;

    results.push({
      hotel_id:      id,
      name:          h.hotel_name,
      slug:          _slugify(h.hotel_name),
      region:        h.region || '',
      rating:        h.overall_rating || null,
      stars:         h.star_rating    || null,
      growth_pct:    growthPct,
      current_views: current,
      prev_views:    prev,
    });
  }

  return results
    .sort((a, b) => b.growth_pct - a.growth_pct)
    .slice(0, MAX_GROWING);
}

/**
 * Most-compared hotels (by compare_add event count, 30 days).
 */
function _calculateMostCompared(events, hotels) {
  const hotelMap = _hotelLookup(hotels);
  return [...(events.compares || new Map()).entries()]
    .map(([id, count]) => {
      const h = hotelMap.get(id);
      if (!h) return null;
      return {
        hotel_id:      id,
        name:          h.hotel_name,
        slug:          _slugify(h.hotel_name),
        region:        h.region || '',
        rating:        h.overall_rating || null,
        stars:         h.star_rating    || null,
        compare_count: count,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.compare_count - a.compare_count)
    .slice(0, MAX_COMPARED);
}

/**
 * Most-saved hotels (by wishlist_add event count, 30 days).
 */
function _calculateMostSaved(events, hotels) {
  const hotelMap = _hotelLookup(hotels);
  return [...(events.wishlist || new Map()).entries()]
    .map(([id, count]) => {
      const h = hotelMap.get(id);
      if (!h) return null;
      return {
        hotel_id:   id,
        name:       h.hotel_name,
        slug:       _slugify(h.hotel_name),
        region:     h.region || '',
        rating:     h.overall_rating || null,
        stars:      h.star_rating    || null,
        save_count: count,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.save_count - a.save_count)
    .slice(0, MAX_SAVED);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT DATA  (no GA4 credentials — rank by overall_rating)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate placeholder trending data from hotel ratings when GA4 is unavailable.
 * Ensures the widget always shows something meaningful.
 *
 * @param  {Object[]} hotels
 * @returns {Object}
 */
function _defaultData(hotels) {
  const active = (hotels || [])
    .filter(h => h._status !== 'inactive' && h.hotel_id)
    .sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0));

  const toCard = (h, extra = {}) => ({
    hotel_id: h.hotel_id,
    name:     h.hotel_name,
    slug:     _slugify(h.hotel_name),
    region:   h.region || '',
    rating:   h.overall_rating || null,
    stars:    h.star_rating    || null,
    ...extra,
  });

  const top  = active.slice(0, MAX_TRENDING);
  const rest = active.slice(MAX_TRENDING);

  return {
    generated_at:    new Date().toISOString(),
    source:          'default',
    trending:        top.map((h, i) => toCard(h, { score: 100 - i * 8 })),
    fastest_growing: rest.slice(0, MAX_GROWING).map((h, i) => toCard(h, {
      growth_pct:    40 + i * 5,
      current_views: 0,
      prev_views:    0,
    })),
    most_compared: active.slice(0, MAX_COMPARED).map((h, i) => toCard(h, { compare_count: 0 })),
    most_saved:    active.slice(0, MAX_SAVED).map((h, i)    => toCard(h, { save_count:    0 })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────────────────────────────────────

function _readCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function _writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * True if the cache file exists and was written within CACHE_TTL_MS.
 *
 * @param  {Object|null} cache — parsed cache object
 * @returns {boolean}
 */
function _isCacheFresh(cache) {
  if (!cache || !cache.generated_at) return false;
  const age = Date.now() - new Date(cache.generated_at).getTime();
  return age < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate trending data for all hotels.
 *
 * Attempt order:
 *   1. Fresh cache (< 23 hours) → return immediately
 *   2. GA4 API (if credentials in env) → fetch, calculate, cache, return
 *   3. Stale cache → return with source = 'cache_stale'
 *   4. Default rating-based data → return with source = 'default'
 *
 * Never throws — all errors are caught and logged.
 *
 * @param  {Object[]} hotels   — raw hotel objects from integration_harness / Airtable
 * @param  {Object}   [opts]
 * @param  {boolean}  [opts.forceRefresh] — ignore cache TTL, always fetch
 * @returns {Promise<Object>}  trending data object
 */
async function generateTrendingData(hotels, opts = {}) {
  const { forceRefresh = false } = opts;
  const activeHotels = (hotels || []).filter(h => h._status !== 'inactive');

  // 1. Fresh cache
  const cache = _readCache();
  if (!forceRefresh && _isCacheFresh(cache)) {
    return { ...cache, source: 'cache' };
  }

  // 2. GA4 API
  const propertyId = process.env.GA4_PROPERTY_ID;
  const saKeyRaw   = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (propertyId && saKeyRaw) {
    try {
      const saKey = JSON.parse(
        Buffer.from(saKeyRaw, 'base64').toString('utf8')
      );

      const token  = await _getAccessToken(saKey);
      const [pvData, evData] = await Promise.all([
        _fetchPageViews(propertyId, token),
        _fetchCustomEvents(propertyId, token),
      ]);

      const data = {
        generated_at:    new Date().toISOString(),
        source:          'ga4_api',
        trending:        _calculateTrending(pvData.current, evData, activeHotels),
        fastest_growing: _calculateFastestGrowing(pvData.current, pvData.previous, activeHotels),
        most_compared:   _calculateMostCompared(evData, activeHotels),
        most_saved:      _calculateMostSaved(evData, activeHotels),
      };

      _writeCache(data);
      return data;

    } catch (err) {
      process.stderr.write(`[trending] GA4 fetch failed: ${err.message}\n`);
    }
  }

  // 3. Stale cache
  if (cache && cache.generated_at) {
    process.stderr.write('[trending] Using stale cache (GA4 unavailable)\n');
    return { ...cache, source: 'cache_stale' };
  }

  // 4. Default
  return _defaultData(activeHotels);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generateTrendingData,

  // Exported for testing
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

  // Constants
  CACHE_TTL_MS,
  MAX_TRENDING,
  MAX_GROWING,
  MAX_COMPARED,
  MAX_SAVED,
};
