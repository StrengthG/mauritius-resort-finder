/**
 * search_engine_client.js
 * Mauritius Resort Finder — Search Engine Core
 *
 * Pure algorithmic module: no DOM, no filesystem, no GA4.
 * Used by:
 *   - site_builder.js  (Node.js, build time) — to generate search-index.json
 *   - search.test.js   (Node.js, test time)  — to unit-test the algorithm
 *   - assets/js/search.js mirrors this logic for the browser (no bundler available)
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// NORMALISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercase, strip diacritics, trim.
 * "Île aux Cerfs" → "ile aux cerfs"
 * "Géran"         → "geran"
 */
function normalise(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKENISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a query into unique, meaningful tokens.
 * Tokens shorter than 2 chars are dropped (avoids noise from "a", "in", etc.).
 */
function tokenise(query) {
  if (!query || typeof query !== 'string') return [];
  return normalise(query)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2)
    .filter((t, i, arr) => arr.indexOf(t) === i); // deduplicate
}

// ─────────────────────────────────────────────────────────────────────────────
// LEVENSHTEIN DISTANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard edit-distance with a 2-column rolling DP for memory efficiency.
 * Only called on token pairs where a quick-reject hasn't fired.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY MATCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a fuzzy score for `token` against words in `normText`.
 * Only activates for tokens >= 4 chars to avoid false positives.
 * Threshold: edit distance ≤ 1 for 4-5 char tokens; ≤ 2 for 6+ char tokens.
 */
function fuzzyMatchScore(token, normText) {
  if (token.length < 4) return 0;
  const words = normText.split(/\s+/).filter(w => w.length >= 3);
  const threshold = token.length >= 6 ? 2 : 1;
  for (const word of words) {
    if (Math.abs(token.length - word.length) > threshold + 1) continue;
    if (levenshtein(token, word) <= threshold) return threshold === 2 ? 3 : 5;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM SCORER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a relevance score for one index item against an array of tokens.
 *
 * Scoring tiers (per token, summed):
 *   100  exact title match (whole query == normalised title)
 *    60  title starts with token
 *    25  title contains token
 *    10  searchText contains token
 *     5  description contains token
 *   3–5  fuzzy match in (searchText ∪ title)
 *
 * Multi-token bonus: ×1.25 when all tokens found somewhere.
 */
function scoreItem(item, tokens) {
  if (!tokens.length) return 0;

  const normTitle   = normalise(item.title || '');
  const normText    = normalise(item.searchText || '');
  const normDesc    = normalise(item.description || '');
  const fuzzyCorpus = normTitle + ' ' + normText;

  let total = 0;

  for (const token of tokens) {
    if (normTitle === token)             { total += 100; continue; }
    if (normTitle.startsWith(token + ' ') || normTitle === token) total += 60;
    else if (normTitle.includes(token))  total += 25;

    if (normText.includes(token))        total += 10;
    if (normDesc.includes(token))        total += 5;

    total += fuzzyMatchScore(token, fuzzyCorpus);
  }

  // Multi-token coherence bonus
  if (tokens.length > 1) {
    const allPresent = tokens.every(t =>
      normTitle.includes(t) || normText.includes(t) || fuzzyMatchScore(t, fuzzyCorpus) > 0
    );
    if (allPresent) total = Math.round(total * 1.25);
  }

  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search the index and return ranked results.
 *
 * @param  {{ items: Array }}  index       — search-index.json payload
 * @param  {string}            query       — raw user query
 * @param  {{ maxResults?: number }} opts
 * @returns {Array}  Matched items with `_relevanceScore` appended, sorted desc.
 */
function search(index, query, opts) {
  const maxResults = (opts && opts.maxResults) || 20;
  if (!query || !query.trim() || !index || !Array.isArray(index.items)) return [];

  const tokens = tokenise(query);
  if (!tokens.length) return [];

  const scored = index.items
    .map(item => ({ item, score: scoreItem(item, tokens) }))
    .filter(r => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Secondary: hotels by rating
      if (a.item.type === 'hotel' && b.item.type === 'hotel') {
        return (b.item.score || 0) - (a.item.score || 0);
      }
      // Tertiary: alphabetical
      return (a.item.title || '').localeCompare(b.item.title || '');
    })
    .slice(0, maxResults);

  return scored.map(r => Object.assign({}, r.item, { _relevanceScore: r.score }));
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEX GENERATION — HOTEL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a rich searchText blob for a hotel record.
 * Includes name, region, brand, property type, amenity keywords, price tier.
 */
function hotelSearchText(h) {
  const parts = [
    h.hotel_name || '',
    h.region || '',
    h._brand_name || '',
    h.property_type || '',
  ];
  const amen = h.amenities || {};
  if (amen.spa)             parts.push('spa wellness retreat');
  if (amen.golf)            parts.push('golf course');
  if (amen.kids_club)       parts.push('family kids children');
  if (amen.private_beach)   parts.push('beach beachfront private beach');
  if (amen.overwater_villa) parts.push('overwater villa bungalow');
  if (amen.butler_service)  parts.push('butler luxury service');
  // price tier
  const price = h.price_per_night_usd || 0;
  if (price < 600)       parts.push('budget value affordable');
  else if (price < 1000) parts.push('mid-range midrange');
  else                   parts.push('luxury premium');
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Build a short human-readable description for a hotel result card.
 */
function hotelDescription(h) {
  const amenTags = [];
  const amen = h.amenities || {};
  if (amen.spa)           amenTags.push('Spa');
  if (amen.golf)          amenTags.push('Golf');
  if (amen.kids_club)     amenTags.push('Family-Friendly');
  if (amen.private_beach) amenTags.push('Private Beach');

  return [
    h.overall_rating ? h.overall_rating + '/10' : null,
    h.region || null,
    h.price_per_night_usd ? 'from $' + h.price_per_night_usd + '/night' : null,
    amenTags.length ? amenTags.join(', ') : null,
  ].filter(Boolean).join(' · ');
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEX GENERATION — PAGE LABELS
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_LABELS = Object.freeze({
  'best-luxury-hotels-mauritius':      'Best Luxury Hotels in Mauritius',
  'best-honeymoon-hotels-mauritius':   'Best Honeymoon Hotels in Mauritius',
  'best-family-hotels-mauritius':      'Best Family Hotels in Mauritius',
  'best-wellness-resorts-mauritius':   'Best Wellness Resorts in Mauritius',
  'best-remote-work-hotels-mauritius': 'Best Hotels for Remote Work in Mauritius',
  'best-value-luxury-hotels-mauritius':'Best Value Luxury Hotels in Mauritius',
  'best-cheap-hotels-mauritius':       'Best Cheap Hotels in Mauritius',
  'best-resort-mauritius':             'Find My Mauritius Resort',
  'best-value-resorts-mauritius':      'Best Value Resorts in Mauritius',
  'adults-only-resorts-mauritius':     'Adults-Only Resorts in Mauritius',
  'best-time-to-visit-mauritius':      'Best Time to Visit Mauritius',
  'mauritius-honeymoon-guide':         'Mauritius Honeymoon Guide',
  'east-coast-vs-west-coast-mauritius':'East Coast vs West Coast Mauritius',
  'le-morne-hotels-mauritius':         'Le Morne Hotels & Beach Guide',
  'mauritius-luxury-travel-guide':     'Mauritius Luxury Travel Guide',
  'mauritius-family-holiday-guide':    'Mauritius Family Holiday Guide',
  'mauritius-wellness-retreat-guide':  'Mauritius Wellness Retreat Guide',
  'mauritius-all-inclusive-resorts':   'Mauritius All-Inclusive Resorts',
  'where-to-stay-in-mauritius':        'Where to Stay in Mauritius',
  'best-beach-resorts-mauritius':      'Best Beach Resorts in Mauritius',
  'best-boutique-hotels-mauritius':    'Best Boutique Hotels in Mauritius',
  'mauritius-travel-guide':            'Mauritius Travel Guide',
  'grand-baie-mauritius':              'Grand Baie Hotels & Beach Guide',
  'balaclava-mauritius-hotels':        'Balaclava Hotels & Marine Park Guide',
  'belle-mare-mauritius':              'Belle Mare Hotels & Beach Guide',
  'flic-en-flac-mauritius':            'Flic en Flac Hotels & Beach Guide',
  'bel-ombre-mauritius':               'Bel Ombre Hotels & South Coast Guide',
  'cap-malheureux-mauritius':          'Cap Malheureux Hotels Guide',
  'grand-gaube-mauritius':             'Grand Gaube Hotels Guide',
  'mauritius-packing-list':            'Mauritius Packing List',
  'things-to-do-in-mauritius':         'Things to Do in Mauritius',
  'best-beaches-in-mauritius':         'Best Beaches in Mauritius',
  'trou-deau-douce-mauritius':         "Trou d'Eau Douce & Île aux Cerfs Guide",
  'mauritius-restaurants-dining-guide':'Mauritius Restaurants & Dining Guide',
  'mauritius-budget-travel-guide':     'Mauritius Budget Travel Guide',
  'mauritius-vs-maldives':             'Mauritius vs Maldives: Which Is Better?',
  'port-louis-mauritius-guide':        'Port Louis City Guide',
  'mauritius-vs-seychelles':           'Mauritius vs Seychelles: Which Is Better?',
  'mauritius-visa-entry-guide':        'Mauritius Visa & Entry Requirements',
  'mauritius-honeymoon-itinerary':     'Mauritius Honeymoon Itinerary',
  'mauritius-water-sports-guide':      'Mauritius Water Sports Guide',
  'mauritius-car-hire-guide':          'Mauritius Car Hire & Getting Around',
  'mauritius-golf-guide':              'Mauritius Golf Guide',
  'mauritius-island-day-trips':        'Mauritius Island Day Trips',
  'mauritius-currency-money-guide':    'Mauritius Currency & Money Guide',
  'ile-aux-cerfs-mauritius':           'Île aux Cerfs Beach & Island Guide',
  'best-snorkelling-mauritius':        'Best Snorkelling in Mauritius',
  'methodology':                       'Our Scoring Methodology',
  'rankings':                          'Full Hotel Rankings',
});

const PAGE_DESCRIPTIONS = Object.freeze({
  'best-luxury-hotels-mauritius':      '36 hotels ranked by location, amenities, brand credibility and value.',
  'best-honeymoon-hotels-mauritius':   'Romance-focused rankings: privacy, sunsets, fine dining, beach quality.',
  'best-family-hotels-mauritius':      'Family rankings: kids clubs, shallow lagoons, multiple dining options.',
  'best-wellness-resorts-mauritius':   'Spa rankings: treatment depth, programme quality, certified practitioners.',
  'best-resort-mauritius':             'Match your travel style — honeymoon, family, adults-only, value, or wellness.',
  'adults-only-resorts-mauritius':     'No under-18s. Romance-optimised resorts ranked by privacy and beach quality.',
  'mauritius-honeymoon-guide':         '7-day and 10-day itineraries, top romantic hotels, beaches, and experiences.',
  'mauritius-travel-guide':            'Entry requirements, costs, getting around, and essential tips.',
  'mauritius-vs-maldives':             '12-factor comparison: cost, beaches, activities, and best fit by traveller type.',
  'mauritius-vs-seychelles':           '12-factor comparison including wildlife, cost, beaches, and activities.',
  'rankings':                          '36 luxury hotels ranked by independent score. Filter by region or persona.',
  'best-beaches-in-mauritius':         '8 top beaches compared: east coast, west coast, and island beaches.',
  'mauritius-water-sports-guide':      'Diving, surfing, kitesurfing, windsurfing: costs, seasons, and top spots.',
  'best-snorkelling-mauritius':        'Six world-class snorkel zones: Blue Bay, Coin de Mire, Balaclava, and more.',
  'ile-aux-cerfs-mauritius':           'Mauritius\'s most iconic island: getting there, golf, and nearby hotels.',
});

/**
 * Convert a page_type string to a result category label.
 */
function specTypeToCategory(pageType) {
  if (pageType === 'pillar' || pageType === 'persona') return 'ranking';
  if (pageType === 'regional' || pageType === 'region') return 'region';
  if (pageType === 'comparison') return 'comparison';
  return 'guide';
}

/**
 * Derive a human-readable label from a slug.
 * Used as fallback when PAGE_LABELS has no entry for the slug.
 */
function slugToLabel(slug) {
  return String(slug)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE SEARCH INDEX
// ─────────────────────────────────────────────────────────────────────────────

// Slugs that add no search value (utility pages, not content destinations)
const SKIP_SLUGS = new Set([
  'contact', 'privacy', 'affiliate-disclosure', 'search',
]);

/**
 * Build the full search index JSON from the hotel dataset and page specs.
 *
 * @param  {Array}  dataset     — hotel records (may include inactive; filter applied internally)
 * @param  {Array}  allPageSpecs — all page specs (generated + static), each with { slug, page_type }
 * @param  {string} baseUrl     — canonical site URL (used only in metadata)
 * @returns {{ version, generated, base_url, count, items }}
 */
function generateSearchIndex(dataset, allPageSpecs, baseUrl) {
  const base = String(baseUrl || 'https://mauritiusresortfinder.com').replace(/\/$/, '');
  const items = [];
  const seenSlugs = new Set();

  // ── Hotels ───────────────────────────────────────────────────────────────
  const active = Array.isArray(dataset) ? dataset.filter(h => h._status === 'active') : [];
  for (const h of active) {
    // Reproduce site_builder's _slugify logic (identical implementation)
    const namePart = String(h.hotel_name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const slug = 'hotels/' + namePart;
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    items.push({
      type:        'hotel',
      title:       h.hotel_name || '',
      url:         '/' + slug + '/',
      slug,
      description: hotelDescription(h),
      region:      h.region || '',
      score:       h.overall_rating || 0,
      price:       h.price_per_night_usd || 0,
      searchText:  hotelSearchText(h),
    });
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  const specs = Array.isArray(allPageSpecs) ? allPageSpecs : [];
  for (const spec of specs) {
    const slug = spec.slug;
    if (!slug || SKIP_SLUGS.has(slug) || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const label = PAGE_LABELS[slug] || slugToLabel(slug);
    const desc  = PAGE_DESCRIPTIONS[slug] || '';

    items.push({
      type:       specTypeToCategory(spec.page_type),
      title:      label,
      url:        '/' + slug + '/',
      slug,
      description: desc,
      searchText: [label, slug.replace(/-/g, ' ')].join(' ').toLowerCase(),
    });
  }

  return {
    version:   '1',
    generated: new Date().toISOString().split('T')[0],
    base_url:  base,
    count:     items.length,
    items,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
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
  PAGE_DESCRIPTIONS,
  SKIP_SLUGS,
};
