/**
 * site_builder.js
 * Mauritius Resort Finder — Full-Site Static Generation Orchestrator
 * Version: 1.0.0
 *
 * Generates the entire static website from hotel data with one command.
 *
 * Pipeline:
 *   [1] Fetch    — airtable_sync.sync() OR harness dataset (offline)
 *   [2] Plan     — generatePageContexts() → PageSpec[] for all page types
 *   [3] Build    — score → adapt → explain → assemble → render → write
 *   [4] Assets   — sitemap.xml, robots.txt, feed.xml
 *   [5] Report   — build_report.json
 *
 * Page types generated:
 *   pillar      — best-luxury-hotels-mauritius/
 *   persona     — best-honeymoon-hotels-mauritius/, etc.
 *   region      — grand-baie-luxury-hotels/, etc.
 *   hotel       — hotels/royal-palm-beachcomber-luxury/
 *   comparison  — compare/four-seasons-vs-oneonly/
 *
 * CLI:
 *   node site_builder.js --base https://mauritiusresortfinder.com --out ./dist
 *
 * Design invariants:
 *   - Deterministic: same dataset → identical slug order, file paths, sitemap
 *   - No mutation of source data
 *   - Non-critical page failures recorded; build continues
 *   - Critical errors (duplicate slugs, I/O) throw immediately
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { generateSearchIndex }   = require('./search_engine_client.js');
const { generateImageSitemap }  = require('./hotel_image_engine.js');
const { generateSocialCards, getSellingPoint } = require('./social_card_engine.js');
const { generateTrendingData }                = require('./ga4_trending_engine.js');

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

const SITE_BUILDER_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// PAGE TYPE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_TYPES = Object.freeze({
  PILLAR:        'pillar',
  PERSONA:       'persona',
  REGION:        'region',
  HOTEL:         'hotel',
  COMPARISON:    'comparison',
  SEASONAL:      'seasonal',
  INFORMATIONAL: 'informational',
});

// ─────────────────────────────────────────────────────────────────────────────
// SITEMAP CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const SITEMAP_PRIORITY = Object.freeze({
  pillar:        '1.0',
  persona:       '0.9',
  region:        '0.8',
  informational: '0.8',
  hotel:         '0.7',
  comparison:    '0.6',
  seasonal:      '0.5',
});

const SITEMAP_CHANGEFREQ = Object.freeze({
  pillar:        'weekly',
  persona:       'weekly',
  region:        'weekly',
  informational: 'monthly',
  hotel:         'monthly',
  comparison:    'monthly',
  seasonal:      'monthly',
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA DEFINITIONS  (matches integration_harness PAGE_CONTEXT_MAP)
// ─────────────────────────────────────────────────────────────────────────────

const PERSONA_DEFINITIONS = Object.freeze([
  {
    persona:        'luxury',
    slug:           'best-luxury-hotels-mauritius',
    title:          'Best Luxury Hotels in Mauritius 2026',
    target_keyword: 'luxury hotels mauritius',
    page_type_tag:  'pillar',
  },
  {
    persona:        'honeymoon',
    slug:           'best-honeymoon-hotels-mauritius',
    title:          'Best Honeymoon Hotels in Mauritius 2026',
    target_keyword: 'honeymoon hotels mauritius',
    page_type_tag:  'persona',
  },
  {
    persona:        'family',
    slug:           'best-family-hotels-mauritius',
    title:          'Best Family Hotels in Mauritius 2026',
    target_keyword: 'family hotels mauritius',
    page_type_tag:  'persona',
  },
  {
    persona:        'wellness',
    slug:           'best-wellness-resorts-mauritius',
    title:          'Best Wellness Resorts in Mauritius 2026',
    target_keyword: 'wellness resorts mauritius',
    page_type_tag:  'persona',
  },
  {
    persona:        'remote_work',
    slug:           'best-remote-work-hotels-mauritius',
    title:          'Best Hotels for Remote Work in Mauritius 2026',
    target_keyword: 'remote work hotels mauritius',
    page_type_tag:  'persona',
  },
  {
    persona:        'value_luxury',
    slug:           'best-value-luxury-hotels-mauritius',
    title:          'Best Value Luxury Hotels in Mauritius 2026',
    target_keyword: 'value luxury hotels mauritius',
    page_type_tag:  'persona',
  },
  {
    persona:        'budget',
    slug:           'best-cheap-hotels-mauritius',
    title:          'Best Cheap Hotels in Mauritius 2026',
    target_keyword: 'cheap hotels mauritius',
    page_type_tag:  'persona',
  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL          = 'https://mauritiusresortfinder.com';
const DEFAULT_OUT_DIR           = './dist';
const DEFAULT_MAX_CONCURRENCY   = 10;
const DEFAULT_COMPARISON_TOP_N  = 6;
const DEFAULT_REGION_MIN_HOTELS = 1;
const FEED_MAX_ITEMS            = 20;

// ─────────────────────────────────────────────────────────────────────────────
// XML ESCAPE
// ─────────────────────────────────────────────────────────────────────────────

function _xmlEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────────────────────────────────────
// SLUG UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert text to a URL-safe slug.
 * Rules: lowercase, replace & with 'and', non-alphanumeric → '-',
 *        collapse multiple dashes, trim leading/trailing dashes.
 *
 * @param  {string} text
 * @returns {string}
 */
function _slugify(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents: é→e, ü→u
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build the output file path for a page.
 *
 * Throws if the resolved path escapes the output directory (path traversal
 * prevention). Slug values derived from external data could contain sequences
 * such as "../../etc/passwd" — this guard ensures all writes stay within outDir.
 *
 * @param  {string} slug
 * @param  {string} outDir
 * @returns {string}
 * @throws {Error} if the resolved path would be outside outDir
 */
function _buildOutputPath(slug, outDir) {
  const resolvedOut  = path.resolve(outDir);
  const resolvedFile = path.join(resolvedOut, slug, 'index.html');

  // Require that the resolved file path starts with resolvedOut + the platform
  // separator. Without the separator suffix, a slug "foo" could pass even if
  // outDir happened to be a prefix of an unrelated sibling directory name.
  if (!resolvedFile.startsWith(resolvedOut + path.sep)) {
    throw new Error(
      `Path traversal detected: slug "${slug}" resolves outside output directory "${resolvedOut}"`,
    );
  }
  return resolvedFile;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER  (mirrors integration_harness.adaptScoredHotel — inline copy)
// ─────────────────────────────────────────────────────────────────────────────

function _roundTo(n, dp) {
  const factor = Math.pow(10, dp);
  return Math.round(n * factor) / factor;
}

/**
 * Bridge scoring_engine ScoredHotel → explanation_engine / block_assembler format.
 * Converts 0-10 dimension scores → 0-100 score_breakdown.
 *
 * @param  {Object} scoredHotel
 * @returns {Object}
 */
function _adaptRejectedHotel(rejectedHotel) {
  const raw = rejectedHotel.hotel;
  return {
    hotel_id:             raw.hotel_id,
    hotel_name:           raw.hotel_name,
    rank:                 1,
    score_breakdown: {
      overall_score:  _roundTo((raw.overall_rating || 0) * 10, 2),
      location_score: _roundTo((raw.location_score  || 0) * 10, 2),
      amenity_score:  _roundTo((raw.amenity_score   || 0) * 10, 2),
      brand_score:    _roundTo((raw.brand_score      || 0) * 10, 2),
      value_score:    _roundTo((raw.value_score      || 0) * 10, 2),
    },
    scores:               null,
    tier:                 rejectedHotel.tier || null,
    completeness_percent: rejectedHotel.completeness_percent || null,
    commission_adjusted:  false,
    review_count:         raw.review_count      || null,
    avg_rating:           raw.avg_rating         || null,
    avg_nightly_rate:     raw.avg_nightly_rate   || null,
    amenities:            raw.amenities           || {},
    star_rating:          raw.star_rating         || null,
    region:               raw.region              || null,
    property_type:        raw.property_type       || null,
  };
}

function _adaptScoredHotel(scoredHotel) {
  const raw = scoredHotel.hotel;
  const ds  = scoredHotel.dimension_scores;

  const score_breakdown = {
    overall_score:  _roundTo(ds.overall_rating * 10, 2),
    location_score: _roundTo(ds.location_score * 10, 2),
    amenity_score:  _roundTo(ds.amenity_score  * 10, 2),
    brand_score:    _roundTo(ds.brand_score    * 10, 2),
    value_score:    _roundTo(ds.value_score    * 10, 2),
  };

  return {
    hotel_id:             raw.hotel_id,
    hotel_name:           raw.hotel_name,
    rank:                 scoredHotel.rank,
    score_breakdown,
    scores:               scoredHotel.scores,
    tier:                 scoredHotel.tier,
    completeness_percent: scoredHotel.completeness_percent,
    commission_adjusted:  scoredHotel.commission_adjusted,
    review_count:         raw.review_count,
    avg_rating:           raw.avg_rating,
    avg_nightly_rate:     raw.avg_nightly_rate  || null,
    amenities:            raw.amenities         || {},
    star_rating:          raw.star_rating       || null,
    region:               raw.region            || null,
    property_type:        raw.property_type     || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE CONTEXT GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the single pillar page context.
 * Uses 'luxury' persona over the full dataset.
 *
 * @param  {Object[]} dataset
 * @param  {Object}   options
 * @returns {Object[]}  PageSpec[]
 */
function _generatePillarContexts(dataset, options = {}) {
  const def = PERSONA_DEFINITIONS.find(p => p.page_type_tag === 'pillar');
  if (!def) return [];

  return [{
    page_type:     PAGE_TYPES.PILLAR,
    slug:          def.slug,
    title:         def.title,
    persona:       def.persona,
    hotels:        [...dataset],
    affiliateLinks: options.affiliateLinks || {},
    pageContext: {
      page_type:      'ranking',
      persona:        def.persona,
      title:          def.title,
      target_keyword: def.target_keyword,
      slug:           def.slug,
    },
    priority:    SITEMAP_PRIORITY.pillar,
    changefreq:  SITEMAP_CHANGEFREQ.pillar,
  }];
}

/**
 * Generate one PageSpec per non-pillar persona.
 *
 * @param  {Object[]} dataset
 * @param  {Object}   options
 * @returns {Object[]}
 */
function _generatePersonaContexts(dataset, options = {}) {
  return PERSONA_DEFINITIONS
    .filter(p => p.page_type_tag === 'persona')
    .map(def => ({
      page_type:     PAGE_TYPES.PERSONA,
      slug:          def.slug,
      title:         def.title,
      persona:       def.persona,
      hotels:        [...dataset],
      affiliateLinks: options.affiliateLinks || {},
      pageContext: {
        page_type:      'ranking',
        persona:        def.persona,
        title:          def.title,
        target_keyword: def.target_keyword,
        slug:           def.slug,
      },
      priority:    SITEMAP_PRIORITY.persona,
      changefreq:  SITEMAP_CHANGEFREQ.persona,
    }));
}

/**
 * Group dataset by region and generate one PageSpec per region.
 * Regions with fewer than minHotels hotels are skipped.
 * Output is sorted deterministically by region name.
 *
 * @param  {Object[]} dataset
 * @param  {Object}   options
 * @returns {Object[]}
 */
function _generateRegionContexts(dataset, options = {}) {
  const minHotels = options.regionMinHotels != null
    ? options.regionMinHotels
    : DEFAULT_REGION_MIN_HOTELS;

  const regionMap = new Map();
  for (const hotel of dataset) {
    const region = hotel.region || 'unknown';
    if (!regionMap.has(region)) regionMap.set(region, []);
    regionMap.get(region).push(hotel);
  }

  // Luxury persona minimum — skip regions with no qualifying hotels
  const LUXURY_MIN_OVERALL = 8.0;

  const specs = [];
  for (const [region, hotels] of regionMap) {
    if (hotels.length < minHotels) continue;
    const luxuryHotels = hotels.filter(h => (h.overall_rating || 0) >= LUXURY_MIN_OVERALL);
    if (luxuryHotels.length === 0) continue;
    const regionSlug = _slugify(region) + '-luxury-hotels';
    specs.push({
      page_type:     PAGE_TYPES.REGION,
      slug:          regionSlug,
      title:         `Best Luxury Hotels in ${region}, Mauritius 2026`,
      persona:       'luxury',
      region,
      hotels:        [...hotels],
      affiliateLinks: options.affiliateLinks || {},
      pageContext: {
        page_type:      'ranking',
        persona:        'luxury',
        title:          `Best Luxury Hotels in ${region}, Mauritius 2026`,
        target_keyword: `luxury hotels ${_slugify(region).replace(/-/g, ' ')} mauritius`,
        slug:           regionSlug,
        region,
      },
      priority:    SITEMAP_PRIORITY.region,
      changefreq:  SITEMAP_CHANGEFREQ.region,
    });
  }

  return specs.sort((a, b) => a.region.localeCompare(b.region));
}

/**
 * Generate one PageSpec per hotel (detail pages).
 * Sorted deterministically by hotel_id ascending.
 *
 * @param  {Object[]} dataset
 * @param  {Object}   options
 * @returns {Object[]}
 */
function _generateHotelContexts(dataset, options = {}) {
  return dataset.map(hotel => {
    const hotelSlug = 'hotels/' + _slugify(hotel.hotel_name);
    const title     = `${hotel.hotel_name} Review & Booking Guide — Mauritius`;
    return {
      page_type:     PAGE_TYPES.HOTEL,
      slug:          hotelSlug,
      title,
      persona:       'luxury',
      hotel_id:      hotel.hotel_id,
      hotels:        [hotel],
      affiliateLinks: options.affiliateLinks || {},
      pageContext: {
        page_type:      'hotel_detail',
        persona:        'luxury',
        title,
        target_keyword: `${_slugify(hotel.hotel_name).replace(/-/g, ' ')} mauritius review`,
        slug:           hotelSlug,
        hotel_id:       hotel.hotel_id,
        hotel_name:     hotel.hotel_name,
        booking_url:    (options.affiliateLinks && options.affiliateLinks[hotel.hotel_id])
          ? options.affiliateLinks[hotel.hotel_id].booking_url
          : null,
      },
      priority:    SITEMAP_PRIORITY.hotel,
      changefreq:  SITEMAP_CHANGEFREQ.hotel,
    };
  }).sort((a, b) => (a.hotel_id < b.hotel_id ? -1 : a.hotel_id > b.hotel_id ? 1 : 0));
}

/**
 * Generate comparison pages for the top N hotels by overall_rating.
 * Produces C(N,2) unique pairs. Each slug is deterministically ordered
 * (alphabetical by individual slug). Sorted by slug asc.
 *
 * @param  {Object[]} dataset
 * @param  {Object}   options
 * @returns {Object[]}
 */
function _generateComparisonContexts(dataset, options = {}) {
  const topN = options.comparisonTopN != null
    ? options.comparisonTopN
    : DEFAULT_COMPARISON_TOP_N;

  const sorted = [...dataset].sort((a, b) => {
    const diff = (b.overall_rating || 0) - (a.overall_rating || 0);
    return diff !== 0 ? diff : (a.hotel_id < b.hotel_id ? -1 : 1);
  });

  const top   = sorted.slice(0, topN);
  const specs = [];

  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const h1    = top[i];
      const h2    = top[j];
      const slug1 = _slugify(h1.hotel_name);
      const slug2 = _slugify(h2.hotel_name);

      // Lexicographic ordering for deterministic slug
      const [first, second]         = slug1 <= slug2 ? [h1, h2] : [h2, h1];
      const [firstSlug, secondSlug] = slug1 <= slug2 ? [slug1, slug2] : [slug2, slug1];

      const compSlug = `compare/${firstSlug}-vs-${secondSlug}`;
      const title    = `${first.hotel_name} vs ${second.hotel_name} — Which is Better?`;

      specs.push({
        page_type:     PAGE_TYPES.COMPARISON,
        slug:          compSlug,
        title,
        persona:       'luxury',
        hotels:        [first, second],
        hotel_a:       first,
        hotel_b:       second,
        affiliateLinks: options.affiliateLinks || {},
        pageContext: {
          page_type:       'comparison',
          persona:         'luxury',
          title,
          target_keyword:  `${firstSlug.replace(/-/g, ' ')} vs ${secondSlug.replace(/-/g, ' ')}`,
          slug:            compSlug,
          hotels_compared: [first.hotel_id, second.hotel_id],
          hotel_a_name:    first.hotel_name,
          hotel_a_slug:    `hotels/${firstSlug}`,
          hotel_b_name:    second.hotel_name,
          hotel_b_slug:    `hotels/${secondSlug}`,
        },
        priority:    SITEMAP_PRIORITY.comparison,
        changefreq:  SITEMAP_CHANGEFREQ.comparison,
      });
    }
  }

  return specs.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/**
 * Generate all page contexts from the hotel dataset.
 * Returns { specs, duplicates }.
 *
 * @param  {Object[]} dataset
 * @param  {Object}   options
 * @returns {{ specs: Object[], duplicates: string[] }}
 */
// Static/informational pages served from pages/ — included in sitemap only
// (content is authored HTML; they are copied to dist/ separately by the build).
const STATIC_PAGE_SPECS = Object.freeze([
  { slug: 'best-resort-mauritius',          page_type: 'pillar',        priority: '0.9', changefreq: 'weekly'  },
  { slug: 'best-value-resorts-mauritius',   page_type: 'informational', priority: '0.8', changefreq: 'weekly'  },
  { slug: 'adults-only-resorts-mauritius',  page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'best-time-to-visit-mauritius',        page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-honeymoon-guide',           page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'east-coast-vs-west-coast-mauritius',  page_type: 'informational', priority: '0.7', changefreq: 'monthly' },
  { slug: 'le-morne-hotels-mauritius',           page_type: 'informational', priority: '0.7', changefreq: 'monthly' },
  { slug: 'mauritius-luxury-travel-guide',       page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-family-holiday-guide',      page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-wellness-retreat-guide',    page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-all-inclusive-resorts',    page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'where-to-stay-in-mauritius',         page_type: 'informational', priority: '0.9', changefreq: 'monthly' },
  { slug: 'best-beach-resorts-mauritius',        page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'best-boutique-hotels-mauritius',      page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-travel-guide',              page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'grand-baie-mauritius',               page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'balaclava-mauritius-hotels',         page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'belle-mare-mauritius',               page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'flic-en-flac-mauritius',             page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'bel-ombre-mauritius',               page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'cap-malheureux-mauritius',          page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'grand-gaube-mauritius',             page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-packing-list',            page_type: 'informational', priority: '0.7', changefreq: 'yearly'  },
  { slug: 'things-to-do-in-mauritius',         page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'best-beaches-in-mauritius',         page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'trou-deau-douce-mauritius',          page_type: 'regional',      priority: '0.7', changefreq: 'monthly' },
  { slug: 'mauritius-restaurants-dining-guide', page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-budget-travel-guide',      page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-vs-maldives',              page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'port-louis-mauritius-guide',         page_type: 'regional',      priority: '0.7', changefreq: 'monthly' },
  { slug: 'mauritius-vs-seychelles',            page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-visa-entry-guide',         page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-honeymoon-itinerary',      page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-water-sports-guide',       page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-car-hire-guide',           page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-golf-guide',               page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-island-day-trips',         page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-currency-money-guide',     page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'ile-aux-cerfs-mauritius',            page_type: 'regional',      priority: '0.8', changefreq: 'monthly' },
  { slug: 'best-snorkelling-mauritius',         page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-wildlife-guide',           page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-destination-weddings',    page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'mauritius-overwater-villas',        page_type: 'informational', priority: '0.8', changefreq: 'monthly' },
  { slug: 'map',                                page_type: 'other',          priority: '0.7', changefreq: 'monthly' },
  { slug: 'search',                             page_type: 'other',          priority: '0.6', changefreq: 'weekly'  },
  { slug: 'contact',                            page_type: 'other',          priority: '0.5', changefreq: 'yearly'  },
  { slug: 'rankings',                            page_type: 'informational', priority: '0.6', changefreq: 'monthly' },
  { slug: 'methodology',                         page_type: 'informational', priority: '0.5', changefreq: 'monthly' },
]);

function generatePageContexts(dataset, options = {}) {
  if (!Array.isArray(dataset)) {
    throw new TypeError('generatePageContexts: dataset must be an array');
  }

  const specs = [
    ..._generatePillarContexts(dataset, options),
    ..._generatePersonaContexts(dataset, options),
    ..._generateRegionContexts(dataset, options),
    ..._generateHotelContexts(dataset, options),
    ..._generateComparisonContexts(dataset, options),
  ];

  const { duplicates } = _detectDuplicateSlugs(specs);
  return { specs, duplicates };
}

// ─────────────────────────────────────────────────────────────────────────────
// SLUG VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect duplicate slugs in a list of PageSpecs.
 *
 * @param  {Object[]} specs
 * @returns {{ duplicates: string[] }}
 */
function _detectDuplicateSlugs(specs) {
  const seen  = new Map();
  const dupes = [];

  for (const spec of specs) {
    const slug = spec.slug;
    if (seen.has(slug)) {
      if (!dupes.includes(slug)) dupes.push(slug);
    } else {
      seen.set(slug, true);
    }
  }

  return { duplicates: dupes };
}

// ─────────────────────────────────────────────────────────────────────────────
// SITE ASSET GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate sitemap.xml content.
 * Sorted: priority desc, then slug asc.
 *
 * @param  {Object[]} pages     — PageSpec[] (needs slug, page_type, priority, changefreq)
 * @param  {string}   baseUrl
 * @returns {string}
 */
function generateSitemap(pages, baseUrl) {
  if (!Array.isArray(pages)) {
    throw new TypeError('generateSitemap: pages must be an array');
  }
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new TypeError('generateSitemap: baseUrl must be a non-empty string');
  }

  const base  = baseUrl.replace(/\/$/, '');
  const today = new Date().toISOString().slice(0, 10);

  const sorted = [...pages].sort((a, b) => {
    const pDiff = parseFloat(b.priority || '0') - parseFloat(a.priority || '0');
    return pDiff !== 0 ? pDiff : (a.slug < b.slug ? -1 : 1);
  });

  const homepage = [
    '  <url>',
    `    <loc>${_xmlEsc(base + '/')}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>daily</changefreq>`,
    `    <priority>1.0</priority>`,
    '  </url>',
  ].join('\n');

  const urls = sorted.map(page => {
    const loc        = `${base}/${page.slug}/`;
    const priority   = page.priority   || SITEMAP_PRIORITY[page.page_type]   || '0.5';
    const changefreq = page.changefreq || SITEMAP_CHANGEFREQ[page.page_type] || 'monthly';
    return [
      '  <url>',
      `    <loc>${_xmlEsc(loc)}</loc>`,
      `    <lastmod>${today}</lastmod>`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    homepage,
    urls,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Generate robots.txt content.
 *
 * @param  {string} baseUrl
 * @param  {string} [sitemapUrl]  defaults to baseUrl/sitemap.xml
 * @returns {string}
 */
/**
 * Generate map-hotels.json — compact hotel records for the resort discovery map.
 * Merges hotels.json data with hotel-coordinates.json and hotel-images.json hue data.
 *
 * @param  {Object[]} hotels   — raw hotel objects from harness/Airtable
 * @returns {string}           — JSON string
 */
function generateMapData(hotels) {
  const coordsPath  = path.join(__dirname, 'data', 'hotel-coordinates.json');
  const imagesPath  = path.join(__dirname, 'data', 'hotel-images.json');

  let coords  = {};
  let images  = {};

  if (fs.existsSync(coordsPath)) {
    try { coords = JSON.parse(fs.readFileSync(coordsPath, 'utf8')).hotels || {}; } catch (_) {}
  }
  if (fs.existsSync(imagesPath)) {
    try { images = JSON.parse(fs.readFileSync(imagesPath, 'utf8')); } catch (_) {}
  }

  const active = hotels.filter(h => h._status !== 'inactive' && coords[h.hotel_id]);

  const records = active.map(h => {
    const coord     = coords[h.hotel_id];
    const imgData   = images[h.hotel_id] || {};
    const theme     = imgData.theme || {};
    const amenities = h.amenities || {};

    const cats = [];
    if ((h.overall_rating || 0) >= 9.0)     cats.push('luxury');
    if (amenities.private_beach)             cats.push('beach');
    if (amenities.spa || amenities.wellness_programmes) cats.push('spa');
    if (amenities.kids_club)                 cats.push('family');
    if (amenities.adults_only)               cats.push('adults_only');
    if (amenities.golf)                      cats.push('golf');
    if (amenities.all_inclusive)             cats.push('all_inclusive');
    if (amenities.overwater_villa)           cats.push('overwater');

    const affLink = Array.isArray(h._affiliate_links) && h._affiliate_links[0]
      ? (h._affiliate_links[0].booking_url || null)
      : null;

    const slug = _slugify(h.hotel_name);

    return {
      id:            h.hotel_id,
      name:          h.hotel_name,
      slug,
      region:        h.region || '',
      lat:           coord.lat,
      lng:           coord.lng,
      rating:        h.overall_rating || null,
      stars:         h.star_rating    || null,
      type:          h.property_type  || 'resort',
      selling_point: getSellingPoint(h),
      hue:           theme.hue || 205,
      categories:    cats,
      booking_url:   affLink,
    };
  });

  return JSON.stringify(records);
}

function generateRobots(baseUrl, sitemapUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new TypeError('generateRobots: baseUrl must be a non-empty string');
  }
  const base    = baseUrl.replace(/\/$/, '');
  const sitemap = sitemapUrl || `${base}/sitemap.xml`;
  return [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${sitemap}`,
    `Sitemap: ${base}/image-sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Generate RSS feed.xml content.
 * Includes up to FEED_MAX_ITEMS pages sorted by priority desc then slug asc.
 *
 * @param  {Object[]} pages
 * @param  {string}   baseUrl
 * @param  {Object}   [options]
 * @returns {string}
 */
function generateFeed(pages, baseUrl, options = {}) {
  if (!Array.isArray(pages)) {
    throw new TypeError('generateFeed: pages must be an array');
  }
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new TypeError('generateFeed: baseUrl must be a non-empty string');
  }

  const base      = baseUrl.replace(/\/$/, '');
  const maxItems  = options.maxItems  || FEED_MAX_ITEMS;
  const feedTitle = options.feedTitle || 'Mauritius Resort Finder — Luxury Hotel Recommendations';
  const feedDesc  = options.feedDesc  || 'Independent luxury hotel reviews and rankings for Mauritius. Real guest data. No paid placements.';
  const pubDate   = new Date().toUTCString();
  const feedUrl   = `${base}/feed.xml`;

  const sorted = [...pages]
    .sort((a, b) => {
      const pDiff = parseFloat(b.priority || '0') - parseFloat(a.priority || '0');
      return pDiff !== 0 ? pDiff : (a.slug < b.slug ? -1 : 1);
    })
    .slice(0, maxItems);

  const items = sorted.map(page => {
    const url   = `${base}/${page.slug}/`;
    const title = page.title || page.slug;
    return [
      '    <item>',
      `      <title>${_xmlEsc(title)}</title>`,
      `      <link>${_xmlEsc(url)}</link>`,
      `      <guid isPermaLink="true">${_xmlEsc(url)}</guid>`,
      `      <description>${_xmlEsc(title)}</description>`,
      `      <pubDate>${pubDate}</pubDate>`,
      '    </item>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${_xmlEsc(feedTitle)}</title>`,
    `    <link>${_xmlEsc(base + '/')}</link>`,
    `    <description>${_xmlEsc(feedDesc)}</description>`,
    `    <lastBuildDate>${pubDate}</lastBuildDate>`,
    `    <atom:link href="${_xmlEsc(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/**
 * Write build_report.json to the output directory.
 *
 * @param  {Object}   report
 * @param  {string}   outDir
 * @param  {Function} [writeFn]   injectable for testing
 * @returns {string}  file path written
 */
function saveBuildReport(report, outDir, writeFn) {
  if (!report || typeof report !== 'object') {
    throw new TypeError('saveBuildReport: report must be an object');
  }
  if (!outDir || typeof outDir !== 'string') {
    throw new TypeError('saveBuildReport: outDir must be a non-empty string');
  }
  const _write   = writeFn || fs.writeFileSync;
  const filePath = path.join(path.resolve(outDir), 'build_report.json');
  _write(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCURRENCY HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute factories in batches of `concurrency`.
 * Returns array of PromiseSettledResult (same shape as Promise.allSettled).
 *
 * @param  {Function[]} factories   — zero-arg async functions
 * @param  {number}     concurrency
 * @returns {Promise<PromiseSettledResult[]>}
 */
async function _runConcurrent(factories, concurrency) {
  const results = [];
  for (let i = 0; i < factories.length; i += concurrency) {
    const batch        = factories.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(f => f()));
    results.push(...batchResults);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE PAGE BUILD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a single page: score → adapt → explain → assemble → render → write.
 * Always returns a PageResult (never throws). Failures are recorded in result.error.
 *
 * @param  {Object} spec         — PageSpec
 * @param  {Object} deps         — injectable module deps
 * @param  {Object} buildOptions — outDir, baseUrl, verbose, dryRun
 * @returns {Promise<Object>}    PageResult
 */
async function _buildPage(spec, deps = {}, buildOptions = {}) {
  const t0 = Date.now();
  const {
    scoringEngine:    se,
    explanationEngine: ee,
    blockAssembler:   ba,
    renderFn,
    dataset          = [],
    mkdirFn  = (p, opts) => fs.mkdirSync(p, opts),
    writeFn  = (p, d)    => fs.writeFileSync(p, d, 'utf8'),
  } = deps;

  const {
    outDir  = DEFAULT_OUT_DIR,
    baseUrl = DEFAULT_BASE_URL,
    verbose = false,
  } = buildOptions;

  const outputPath = _buildOutputPath(spec.slug, outDir);
  const _log = verbose ? (msg) => process.stdout.write(msg + '\n') : () => {};

  try {
    _log(`  Building: ${spec.slug}`);

    // ── Score ───────────────────────────────────────────────────────────────
    const rankingResult = se.rankHotels(spec.hotels, spec.persona, { includeExcluded: true });
    let rankedHotels    = rankingResult.ranked_hotels;

    // Hotel detail pages must always render their subject hotel even if it
    // falls below the persona threshold — the page is about that hotel, not
    // a curated ranking. Fall back to rejected_hotels in that case.
    const isDetailFallback =
      (!rankedHotels || rankedHotels.length === 0) &&
      spec.pageContext.page_type === 'hotel_detail' &&
      rankingResult.rejected_hotels?.length > 0;

    if (!rankedHotels || rankedHotels.length === 0) {
      if (!isDetailFallback) {
        throw new Error(
          `No hotels qualified for persona "${spec.persona}" on page "${spec.slug}"`
        );
      }
    }

    // ── Adapt ───────────────────────────────────────────────────────────────
    const engineHotels = isDetailFallback
      ? rankingResult.rejected_hotels.map(_adaptRejectedHotel)
      : rankedHotels.map(_adaptScoredHotel);

    // ── Explain ─────────────────────────────────────────────────────────────
    const explanations = ee.explainBatch(engineHotels, spec.persona);

    // ── Editorial content (hotel_detail pages only) ─────────────────────────
    let editorialContent = null;
    if (spec.pageContext.page_type === 'hotel_detail' && spec.hotels.length > 0) {
      const h0 = spec.hotels[0];
      // Skip for admin-managed hotels that lack score data — content engine requires
      // numeric overall_rating / location_score or it crashes on .toFixed() calls.
      const hasScoreData = typeof h0.overall_rating === 'number' && typeof h0.location_score === 'number';
      if (hasScoreData) {
        const hce = require('./hotel_content_engine.js');
        editorialContent = hce.generateContent(h0, dataset);
      }
    }

    // ── Assemble ────────────────────────────────────────────────────────────
    const assembly = ba.assemble(
      engineHotels,
      explanations,
      spec.pageContext,
      spec.affiliateLinks,
      null,
      editorialContent,
    );

    // ── Render ──────────────────────────────────────────────────────────────
    const html = renderFn(assembly, { baseUrl, slug: spec.slug });

    // ── Write ───────────────────────────────────────────────────────────────
    mkdirFn(path.dirname(outputPath), { recursive: true });
    writeFn(outputPath, html);

    const duration = Date.now() - t0;
    _log(`  ✓ ${spec.slug}  (${duration}ms)`);

    return {
      slug:        spec.slug,
      page_type:   spec.page_type,
      output_path: outputPath,
      success:     true,
      duration_ms: duration,
      error:       null,
    };
  } catch (err) {
    const duration = Date.now() - t0;
    _log(`  ✗ ${spec.slug}  ${err.message}`);
    return {
      slug:        spec.slug,
      page_type:   spec.page_type,
      output_path: outputPath,
      success:     false,
      duration_ms: duration,
      error:       err.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD ALL PAGES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build all pages from specs with concurrency limiting.
 *
 * @param  {Object[]} specs
 * @param  {Object}   deps         — injectable module deps
 * @param  {Object}   [options]
 * @returns {Promise<Object[]>}    PageResult[]
 */
async function buildAllPages(specs, deps = {}, options = {}) {
  if (!Array.isArray(specs)) {
    throw new TypeError('buildAllPages: specs must be an array');
  }

  const concurrency = options.maxConcurrency || DEFAULT_MAX_CONCURRENCY;
  const factories   = specs.map(spec => () => _buildPage(spec, deps, options));
  const settled     = await _runConcurrent(factories, concurrency);

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      slug:        specs[i].slug,
      page_type:   specs[i].page_type,
      output_path: _buildOutputPath(specs[i].slug, options.outDir || DEFAULT_OUT_DIR),
      success:     false,
      duration_ms: 0,
      error:       result.reason ? result.reason.message : 'Unknown error',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN BUILD ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the entire static website.
 *
 * @param  {Object} options
 * @returns {Promise<Object>}  buildReport
 */
async function buildSite(options = {}) {
  const {
    baseUrl         = DEFAULT_BASE_URL,
    outDir          = DEFAULT_OUT_DIR,
    syncFn          = null,
    maxConcurrency  = DEFAULT_MAX_CONCURRENCY,
    failOnPageError = false,
    dryRun          = false,
    verbose         = false,
    affiliateLinks: optionAffiliateLinks = {},
    comparisonTopN  = DEFAULT_COMPARISON_TOP_N,
    regionMinHotels = DEFAULT_REGION_MIN_HOTELS,
    // injectable module overrides (for testing)
    _scoringEngine     = null,
    _explanationEngine = null,
    _blockAssembler    = null,
    _renderer          = null,
  } = options;

  // affiliateLinks may be overridden by syncFn result (e.g. extracted from hotels.json)
  let affiliateLinks = optionAffiliateLinks;

  const t0     = Date.now();
  const _log   = verbose ? (m) => process.stdout.write(m + '\n') : () => {};
  const absOut = path.resolve(outDir);

  _log(`\nMauritius Resort Finder — Site Builder v${SITE_BUILDER_VERSION}`);
  _log(`  Base URL: ${baseUrl}`);
  _log(`  Output:   ${absOut}`);

  // ── Load modules ───────────────────────────────────────────────────────────
  const se = _scoringEngine     || require('./scoring_engine.js');
  const ee = _explanationEngine || require('./explanation_engine.js');
  const ba = _blockAssembler    || require('./block_assembler.js');
  const sr = _renderer          || require('./static_page_renderer.js');

  // ── [1/5] Fetch data ───────────────────────────────────────────────────────
  _log('\n[1/5] Fetching hotel data');
  let hotelObjects;

  if (syncFn) {
    const syncResult = await syncFn();
    hotelObjects = syncResult.hotelObjects;
    if (syncResult.affiliateLinks && typeof syncResult.affiliateLinks === 'object' &&
        !Array.isArray(syncResult.affiliateLinks)) {
      affiliateLinks = syncResult.affiliateLinks;
    } else if (Array.isArray(hotelObjects)) {
      // Fallback: extract affiliate links from _affiliate_links on each hotel object
      // (used when syncFn is Airtable sync, which returns hotelObjects but not a
      //  separate affiliateLinks map)
      const extracted = {};
      for (const h of hotelObjects) {
        if (h.hotel_id && Array.isArray(h._affiliate_links) && h._affiliate_links.length > 0) {
          const link = h._affiliate_links[0];
          if (link.booking_url) {
            extracted[h.hotel_id] = {
              booking_url:     link.booking_url,
              provider:        link.provider        || null,
              commission_tier: link.commission_tier || null,
            };
          }
        }
      }
      if (Object.keys(extracted).length > 0) {
        affiliateLinks = extracted;
        _log(`      → ${Object.keys(extracted).length} affiliate links extracted from hotel objects`);
      }
    }
  } else {
    const harness = require('./integration_harness.js');
    hotelObjects  = harness.HOTEL_DATASET;
  }

  if (!Array.isArray(hotelObjects) || hotelObjects.length === 0) {
    throw new Error('buildSite: hotelObjects is empty or not an array');
  }
  _log(`      → ${hotelObjects.length} hotels loaded`);

  // ── [2/5] Generate page contexts ───────────────────────────────────────────
  _log('\n[2/5] Generating page contexts');
  const { specs, duplicates } = generatePageContexts(hotelObjects, {
    affiliateLinks,
    comparisonTopN,
    regionMinHotels,
  });

  if (duplicates.length > 0) {
    throw new Error(`Duplicate slugs detected: ${duplicates.join(', ')}`);
  }

  const byType = {};
  for (const s of specs) {
    byType[s.page_type] = (byType[s.page_type] || 0) + 1;
  }
  _log(`      → ${specs.length} pages to build`);
  for (const [type, count] of Object.entries(byType)) {
    _log(`        ${type}: ${count}`);
  }

  // ── [3/5] Build pages ──────────────────────────────────────────────────────
  _log('\n[3/5] Building pages');
  if (!dryRun) {
    fs.mkdirSync(absOut, { recursive: true });
  }

  const renderFn = (assembly, opts) => sr.renderPage(assembly, opts);

  const pageDeps = {
    scoringEngine:     se,
    explanationEngine: ee,
    blockAssembler:    ba,
    renderFn,
    dataset:           hotelObjects,
    mkdirFn: dryRun ? () => {} : (p, opts) => fs.mkdirSync(p, opts),
    writeFn: dryRun ? () => {} : (p, d)    => fs.writeFileSync(p, d, 'utf8'),
  };

  const pageResults = await buildAllPages(specs, pageDeps, {
    maxConcurrency, outDir, baseUrl, verbose,
  });

  const succeeded = pageResults.filter(r => r.success);
  const failed    = pageResults.filter(r => !r.success);
  _log(`      → ${succeeded.length} succeeded, ${failed.length} failed`);

  if (failOnPageError && failed.length > 0) {
    throw new Error(
      `${failed.length} page(s) failed: ` +
      failed.map(r => `${r.slug} (${r.error})`).join(', ')
    );
  }

  // ── [4/5] Generate site assets ─────────────────────────────────────────────
  _log('\n[4/5] Generating site assets');
  // Merge static page specs for sitemap only — they are HTML files copied from pages/
  // and must NOT go through the dynamic build pipeline.
  const sitemapSpecs   = [...specs, ...STATIC_PAGE_SPECS];
  const sitemapContent = generateSitemap(sitemapSpecs, baseUrl);
  const robotsContent  = generateRobots(baseUrl);
  const feedContent    = generateFeed(specs, baseUrl);

  if (!dryRun) {
    fs.writeFileSync(path.join(absOut, 'sitemap.xml'), sitemapContent, 'utf8');
    fs.writeFileSync(path.join(absOut, 'robots.txt'),  robotsContent,  'utf8');
    fs.writeFileSync(path.join(absOut, 'feed.xml'),    feedContent,    'utf8');

    // Generate search index for client-side search
    const searchIdx  = generateSearchIndex(hotelObjects, sitemapSpecs, baseUrl);
    fs.writeFileSync(path.join(absOut, 'search-index.json'), JSON.stringify(searchIdx), 'utf8');
    _log(`      ✓ search-index.json (${searchIdx.count} items)`);

    // Generate image sitemap — forward-looking; lists all planned hotel image URLs
    // (no outDir: includes all 36×5 images regardless of whether real files exist yet)
    const imageSitemapXml = generateImageSitemap(hotelObjects, baseUrl);
    fs.writeFileSync(path.join(absOut, 'image-sitemap.xml'), imageSitemapXml, 'utf8');
    _log(`      ✓ image-sitemap.xml (${hotelObjects.length} hotels)`);

    // Generate social card SVGs (og:image / twitter:image) for all hotels
    const cardStats = generateSocialCards(hotelObjects, absOut);
    _log(`      ✓ social cards: ${cardStats.generated} generated, ${cardStats.cached} cached (${cardStats.total} total)`);

    // Generate map-hotels.json for the resort discovery map
    const mapDataDir = path.join(absOut, 'assets', 'data');
    fs.mkdirSync(mapDataDir, { recursive: true });
    const mapJson = generateMapData(hotelObjects);
    fs.writeFileSync(path.join(mapDataDir, 'map-hotels.json'), mapJson, 'utf8');
    _log(`      ✓ map-hotels.json (${hotelObjects.filter(h => h._status !== 'inactive').length} active hotels)`);

    // Generate trending.json — reads GA4 if credentials set, else cache or default
    try {
      const trendingData = await generateTrendingData(hotelObjects);
      fs.writeFileSync(
        path.join(mapDataDir, 'trending.json'),
        JSON.stringify(trendingData),
        'utf8'
      );
      _log(`      ✓ trending.json (source: ${trendingData.source}, ${(trendingData.trending || []).length} trending hotels)`);
    } catch (tErr) {
      warnings.push(`trending.json generation failed: ${tErr.message}`);
      _log(`      ⚠ trending.json skipped: ${tErr.message}`);
    }

    // Copy homepage (index.html at project root) into dist/
    const homepageSrc  = path.join(__dirname, 'index.html');
    const homepageDest = path.join(absOut, 'index.html');
    if (fs.existsSync(homepageSrc)) {
      fs.copyFileSync(homepageSrc, homepageDest);
      _log(`      ✓ sitemap.xml  robots.txt  feed.xml  index.html`);
    } else {
      _log(`      ✓ sitemap.xml  robots.txt  feed.xml`);
      warnings.push('index.html not found at project root — homepage not copied to dist/');
    }

    // Copy static pages from pages/ → dist/{pagename}/index.html
    const pagesSrc = path.join(__dirname, 'pages');
    if (fs.existsSync(pagesSrc)) {
      const pageFiles = fs.readdirSync(pagesSrc).filter(f => f.endsWith('.html'));
      for (const file of pageFiles) {
        const pageName = file.replace(/\.html$/, '');
        const destDir  = path.join(absOut, pageName);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(path.join(pagesSrc, file), path.join(destDir, 'index.html'));
      }
      _log(`      ✓ pages/ (${pageFiles.length} static pages) copied to dist/`);
    }

    // Copy assets/ (CSS, JS, images) into dist/assets/
    const assetsSrc  = path.join(__dirname, 'assets');
    const assetsDest = path.join(absOut, 'assets');
    if (fs.existsSync(assetsSrc)) {
      function copyDirSync(src, dest) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const srcPath  = path.join(src,  entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      }
      copyDirSync(assetsSrc, assetsDest);
      _log(`      ✓ assets/ copied to dist/assets/`);
    }

    // Copy _headers (Cloudflare Pages security + CSP) into dist/
    const headersSrc = path.join(__dirname, '_headers');
    if (fs.existsSync(headersSrc)) {
      fs.copyFileSync(headersSrc, path.join(absOut, '_headers'));
      _log(`      ✓ _headers copied to dist/`);
    }
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  const warnings = [];
  const sitemapUrlCount = (sitemapContent.match(/<loc>/g) || []).length;
  if (sitemapUrlCount !== sitemapSpecs.length + 1) { // +1 for homepage
    warnings.push(
      `Sitemap URL count (${sitemapUrlCount}) != page spec count (${sitemapSpecs.length + 1})`
    );
  }
  if (!robotsContent.includes('sitemap.xml')) {
    warnings.push('robots.txt does not reference sitemap.xml');
  }

  // ── [5/5] Build report ─────────────────────────────────────────────────────
  _log('\n[5/5] Saving build report');
  const buildReport = {
    site_builder_version:  SITE_BUILDER_VERSION,
    generated_at:          new Date().toISOString(),
    build_duration_ms:     Date.now() - t0,
    base_url:              baseUrl,
    out_dir:               absOut,
    total_pages_generated: succeeded.length,
    pages_by_type:         byType,
    warnings_count:        warnings.length,
    errors_count:          failed.length,
    warnings,
    errors:                failed.map(r => ({ slug: r.slug, error: r.error })),
    pages:                 pageResults,
  };

  if (!dryRun) {
    saveBuildReport(buildReport, absOut);
    _log(`      ✓ build_report.json`);
  }

  _log(`\n  ✓ Build complete in ${buildReport.build_duration_ms}ms`);
  _log(`    Pages: ${succeeded.length}/${specs.length} succeeded`);
  if (failed.length > 0) {
    _log(`    Errors: ${failed.length}`);
    for (const r of failed) _log(`      ✗ ${r.slug}: ${r.error}`);
  }
  _log('');

  return buildReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI ARG PARSING
// ─────────────────────────────────────────────────────────────────────────────

function _parseCLIArgs(argv) {
  const args   = argv || process.argv.slice(2);
  const result = {
    baseUrl:         DEFAULT_BASE_URL,
    outDir:          DEFAULT_OUT_DIR,
    verbose:         false,
    dryRun:          false,
    failOnPageError: false,
    concurrency:     DEFAULT_MAX_CONCURRENCY,
    comparisonTopN:  DEFAULT_COMPARISON_TOP_N,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--base'  || a === '-b') && args[i + 1]) result.baseUrl  = args[++i];
    if ((a === '--out'   || a === '-o') && args[i + 1]) result.outDir   = args[++i];
    if (a === '--verbose' || a === '-v')                result.verbose  = true;
    if (a === '--dry-run')                              result.dryRun   = true;
    if (a === '--fail-on-error')                        result.failOnPageError = true;
    if (a === '--concurrency' && args[i + 1])
      result.concurrency = parseInt(args[++i], 10) || DEFAULT_MAX_CONCURRENCY;
    if (a === '--top-n' && args[i + 1])
      result.comparisonTopN = parseInt(args[++i], 10) || DEFAULT_COMPARISON_TOP_N;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI ENTRY
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const cli = _parseCLIArgs();

  // Data source priority:
  //   1. AIRTABLE_* env vars present → live sync from Airtable API
  //   2. data/hotels.json exists     → pre-synced snapshot (committed to repo)
  //   3. Fallback                    → test dataset in integration_harness.js
  let syncFn = null;
  const snapshotPath = path.join(__dirname, 'data', 'hotels.json');

  if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
    process.stdout.write('[site_builder] AIRTABLE credentials detected — syncing live data\n');
    const airtableSync = require('./airtable_sync.js');
    syncFn = () => airtableSync.sync({
      apiKey: process.env.AIRTABLE_API_KEY,
      baseId: process.env.AIRTABLE_BASE_ID,
    });
  } else if (fs.existsSync(snapshotPath)) {
    process.stdout.write('[site_builder] Loading hotel data from data/hotels.json\n');
    syncFn = () => {
      const hotelObjects = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
        .filter(h => h._status !== 'inactive');
      const affiliateLinks = {};
      for (const h of hotelObjects) {
        if (Array.isArray(h._affiliate_links) && h._affiliate_links.length > 0) {
          const link = h._affiliate_links[0];
          if (link.booking_url) {
            affiliateLinks[h.hotel_id] = {
              booking_url:     link.booking_url,
              provider:        link.provider        || null,
              commission_tier: link.commission_tier || null,
            };
          }
        }
      }
      return Promise.resolve({ hotelObjects, affiliateLinks });
    };
  } else {
    process.stdout.write('[site_builder] No AIRTABLE credentials or snapshot — using test dataset\n');
  }

  try {
    const report = await buildSite({
      baseUrl:         cli.baseUrl,
      outDir:          cli.outDir,
      verbose:         true,
      dryRun:          cli.dryRun,
      failOnPageError: cli.failOnPageError,
      maxConcurrency:  cli.concurrency,
      comparisonTopN:  cli.comparisonTopN,
      syncFn,
    });
    if (report.errors_count > 0) process.exit(1);
  } catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Public API
  buildSite,
  buildAllPages,
  generatePageContexts,
  generateSitemap,
  generateRobots,
  generateFeed,
  generateSearchIndex,
  generateMapData,
  generateTrendingData,
  saveBuildReport,

  // Internals (exported for testing)
  _slugify,
  _buildOutputPath,
  _adaptScoredHotel,
  _generatePillarContexts,
  _generatePersonaContexts,
  _generateRegionContexts,
  _generateHotelContexts,
  _generateComparisonContexts,
  _detectDuplicateSlugs,
  _buildPage,
  _runConcurrent,
  _parseCLIArgs,
  _xmlEsc,
  _roundTo,

  // Constants
  SITE_BUILDER_VERSION,
  PAGE_TYPES,
  PERSONA_DEFINITIONS,
  SITEMAP_PRIORITY,
  SITEMAP_CHANGEFREQ,
  DEFAULT_BASE_URL,
  DEFAULT_OUT_DIR,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_COMPARISON_TOP_N,
  DEFAULT_REGION_MIN_HOTELS,
  FEED_MAX_ITEMS,
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}
