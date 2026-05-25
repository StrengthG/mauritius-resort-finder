/**
 * static_page_renderer.js
 * Mauritius Resort Finder — Static Page Renderer, Module 8
 * Version: 1.0.0
 *
 * Converts a page.json AssemblyResult (output of block_assembler.js / integration_harness.js)
 * into a fully-formed, semantic, SEO-optimized HTML document ready for static deployment.
 *
 * Architecture position: Layer 8 — Rendering (final output layer).
 * Upstream:   block_assembler.js  / integration_harness.js  (AssemblyResult)
 * Downstream: CDN / static host   (deployable index.html)
 *
 * Supported block types (renderer registry):
 *   hero              → <header> hero section with H1
 *   ranking_summary   → ordered list of ranked hotels with jump links
 *   methodology       → scoring methodology disclosure section
 *   hotel_card        → <article> card (expanded / standard / compact variants)
 *   affiliate_cta     → affiliate booking link with mandatory disclosure note
 *   comparison        → side-by-side hotel comparison table
 *   faq               → FAQ section with FAQPage JSON-LD schema
 *   disclosure        → affiliate disclosure footer section
 *   related_content   → related guides navigation
 *   internal_links    → internal linking block
 *
 * Programmatic API:
 *   renderPage(pageObject, options?)    → HTML string
 *   renderToFile(pageObject, filePath, options?)  → writes file, returns filePath
 *   registerBlockRenderer(blockType, rendererFn)  → extend the renderer registry
 *
 * Options:
 *   baseUrl   {string}  — canonical base URL  (default: 'https://mauritiusresortfinder.com')
 *   siteName  {string}  — OG site_name        (default: 'Mauritius Resort Finder')
 *   lang      {string}  — <html lang>         (default: 'en')
 *
 * Usage (CLI):
 *   node static_page_renderer.js --in ./artifacts/page.json --out ./dist/index.html
 *   node static_page_renderer.js --in ./artifacts/page.json --out ./dist/index.html --base https://mauritiusresortfinder.com
 *
 * Usage (module):
 *   const renderer = require('./static_page_renderer.js');
 *   const html = renderer.renderPage(pageObject, { baseUrl: 'https://mauritiusresortfinder.com' });
 *   renderer.renderToFile(pageObject, './dist/index.html');
 *
 * Design invariants:
 *   - Deterministic: identical input always produces identical HTML output.
 *   - No modifications to ranking, explanation, or block order.
 *   - All user-provided strings are HTML-escaped before output.
 *   - Affiliate disclosure is always rendered adjacent to every CTA.
 *   - No client-side JavaScript emitted in core content.
 *   - Block renderer registry is open for extension without modifying this file.
 *   - Scalable: block registry pattern supports Markdown/React renderers by swap.
 *
 * Scalability:
 *   To add a Markdown renderer: pass custom renderers via registerBlockRenderer().
 *   To add a React renderer:    wrap renderPage() output in a dangerouslySetInnerHTML
 *   or implement an equivalent registry using React elements.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

const RENDERER_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL  = 'https://mauritiusresortfinder.com';
const DEFAULT_SITE_NAME = 'Mauritius Resort Finder';
const DEFAULT_LANG      = 'en';

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

class RendererError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name    = 'RendererError';
    this.context = context;
  }
}

class UnsupportedBlockTypeError extends RendererError {
  constructor(blockType) {
    super(`Unsupported block type: "${blockType}"`, { blockType });
    this.name = 'UnsupportedBlockTypeError';
  }
}

class InvalidBlockPayloadError extends RendererError {
  constructor(blockType, missing) {
    super(
      `Invalid payload for block type "${blockType}": missing required fields: ${missing.join(', ')}`,
      { blockType, missing },
    );
    this.name = 'InvalidBlockPayloadError';
  }
}

class InvalidPageInputError extends RendererError {
  constructor(message) {
    super(message);
    this.name = 'InvalidPageInputError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML ESCAPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escapes a value for safe HTML output.
 * Returns empty string for null/undefined. Converts non-strings via toString().
 *
 * @param  {*}      value
 * @returns {string}
 */
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

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/**
 * Escapes a value for use inside a JSON-LD <script> block.
 * Prevents </script> injection.
 *
 * @param  {string} jsonString — already JSON.stringify'd
 * @returns {string}
 */
function escJsonLd(jsonString) {
  // Preserve the original tag casing (e.g. </SCRIPT> stays </SCRIPT>)
  return jsonString.replace(/<\/script>/gi, (match) => '<\\/' + match.slice(2));
}

/**
 * Validates a URL for safe use in href and src attributes.
 *
 * HTML-escaping alone does NOT prevent XSS via href — a value like
 * "javascript:alert(1)" contains no HTML-special characters, passes esc()
 * unchanged, and executes when the user clicks the link.
 *
 * This function allows only:
 *   - Absolute URLs with http: or https: scheme
 *   - Relative URLs starting with / (site-internal links)
 *   - Fragment-only URLs starting with #
 *
 * Everything else (javascript:, data:, vbscript:, etc.) is replaced with
 * '#invalid' so the link is inert.
 *
 * @param  {string} url
 * @returns {string} the original url if safe, '#invalid' otherwise
 */
function _safeUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return '#invalid';
  const trimmed = url.trim();
  // Site-internal relative paths
  if (trimmed.startsWith('/')) return trimmed;
  // Fragment-only anchors
  if (trimmed.startsWith('#')) return trimmed;
  // Absolute URLs — only http and https are allowed
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
  } catch (_) {
    // Not a parseable absolute URL
  }
  return '#invalid';
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYLOAD VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a block payload contains all required field names.
 * Throws InvalidBlockPayloadError on missing fields.
 *
 * @param  {string}   blockType
 * @param  {Object}   payload
 * @param  {string[]} required
 */
function requirePayloadFields(blockType, payload, required) {
  if (!payload || typeof payload !== 'object') {
    throw new InvalidBlockPayloadError(blockType, required);
  }
  const missing = required.filter(f => payload[f] === undefined || payload[f] === null);
  if (missing.length > 0) {
    throw new InvalidBlockPayloadError(blockType, missing);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a score (0–100) as a display string, e.g. "91/100".
 */
function fmtScore(score) {
  if (score === null || score === undefined || isNaN(Number(score))) return 'N/A';
  return `${Math.round(Number(score))}/100`;
}

/**
 * Capitalizes the first letter of a string.
 */
function capitalize(str) {
  if (!str) return '';
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}

/**
 * Converts a dimension key to a display label.
 * e.g. 'location_score' → 'Location'
 */
function dimensionLabel(key) {
  const labels = {
    overall_score:  'Overall',
    location_score: 'Location',
    amenity_score:  'Amenities',
    brand_score:    'Brand',
    value_score:    'Value',
  };
  return labels[key] || capitalize(key.replace(/_score$/, '').replace(/_/g, ' '));
}

/**
 * Converts a persona key to a human-readable label.
 */
function personaLabel(persona) {
  const labels = {
    luxury:       'Luxury',
    honeymoon:    'Honeymoon',
    family:       'Family',
    wellness:     'Wellness',
    remote_work:  'Remote Work',
    value_luxury: 'Value Luxury',
  };
  return labels[persona] || capitalize(persona.replace(/_/g, ' '));
}

/**
 * Returns a short persona-specific tagline for use in hero/meta copy.
 */
function personaTagline(persona) {
  const taglines = {
    luxury:       'Independently scored for discerning luxury travelers.',
    honeymoon:    'Curated for couples seeking romance and privacy.',
    family:       'Ranked for families with children of all ages.',
    wellness:     'Selected for spa, fitness, and holistic wellbeing.',
    remote_work:  'Scored for productivity, connectivity, and comfort.',
    value_luxury: 'High-end quality at the best value-for-money.',
  };
  return taglines[persona] || 'Independently scored and ranked.';
}

/**
 * Returns persona-specific FAQ questions and answers.
 */
function getPersonaFAQs(persona, slug) {
  const pageUrl = `/${slug || ''}`;
  const base = [
    {
      question: 'How are the hotels on this page ranked?',
      answer:   'Rankings are produced by an independent multi-dimensional scoring model ' +
                'that evaluates overall quality, location, amenities, brand reputation, and value. ' +
                'Affiliate commission rates do not influence rankings or content.',
    },
    {
      question: 'Are the affiliate links on this page paid placements?',
      answer:   'Hotels are ranked by score, not by commercial arrangement. ' +
                'This page contains affiliate links — if you book through them, ' +
                'we may earn a commission at no extra cost to you. ' +
                'See our full disclosure at the bottom of the page.',
    },
  ];

  const personaFAQs = {
    luxury: [
      {
        question: 'Which luxury hotel in Mauritius has the highest overall score?',
        answer:   'The top-ranked hotel on this page received the highest combined score ' +
                  'across overall quality, location, amenities, and brand prestige. ' +
                  'See the full ranking above for the current #1.',
      },
      {
        question: 'What is the best 5-star hotel in Mauritius for luxury travelers?',
        answer:   'Our scoring model evaluates properties across five dimensions with extra ' +
                  'weight on brand prestige and amenity quality for the luxury persona. ' +
                  'The top-ranked property on this page scores highest on this weighted model.',
      },
    ],
    honeymoon: [
      {
        question: 'Which Mauritius resort is best for a honeymoon?',
        answer:   'Our honeymoon ranking weights location, privacy, and romantic amenities such ' +
                  'as private beaches, couples dining, and sunset views. The #1 hotel scored ' +
                  'highest across these criteria.',
      },
      {
        question: 'Do honeymoon hotels in Mauritius offer adults-only options?',
        answer:   'Several properties on this list offer adults-only environments. ' +
                  'Check each hotel card for confirmed amenity details.',
      },
    ],
    family: [
      {
        question: 'Which Mauritius resort is best for families with children?',
        answer:   'Our family ranking weights amenities such as kids clubs, family pools, ' +
                  'childcare, and water sports. The #1 hotel scored highest on these criteria.',
      },
      {
        question: 'Are there family-friendly hotels in Mauritius with childcare services?',
        answer:   'Yes. Several hotels on this ranking offer supervised childcare and kids clubs. ' +
                  'Check the amenity details in each hotel card for confirmed information.',
      },
    ],
    wellness: [
      {
        question: 'Which Mauritius resort has the best spa?',
        answer:   'Our wellness ranking strongly weights spa facilities, yoga, meditation, and ' +
                  'wellness programmes. The #1 hotel scored highest on these dimensions.',
      },
      {
        question: 'Do all hotels on this list have a spa?',
        answer:   'Yes. A functioning spa is a mandatory requirement for inclusion in our ' +
                  'wellness ranking. All hotels listed have confirmed spa facilities.',
      },
    ],
    remote_work: [
      {
        question: 'Which Mauritius hotel is best for remote workers?',
        answer:   'Our remote work ranking weights amenities such as business centres, ' +
                  'high-speed internet, and co-working spaces, alongside strong value scores ' +
                  'for long-stay suitability.',
      },
      {
        question: 'Do Mauritius hotels offer long-stay rates for remote workers?',
        answer:   'Many properties offer long-stay or monthly rates. We recommend contacting ' +
                  'the hotel directly or checking current OTA listings for extended-stay pricing.',
      },
    ],
    value_luxury: [
      {
        question: 'How do you define value luxury hotels in Mauritius?',
        answer:   'Value luxury hotels score high on overall quality, amenities, and brand ' +
                  'standards while maintaining competitive pricing relative to the luxury segment.',
      },
      {
        question: 'Are value luxury hotels in Mauritius still 5-star quality?',
        answer:   'Yes. All hotels in this ranking meet a high overall quality threshold. ' +
                  'The value dimension measures how competitive the pricing is relative to ' +
                  'the quality delivered.',
      },
    ],
    budget: [
      {
        question: 'What counts as a cheap hotel in Mauritius?',
        answer:   'Our budget ranking includes only hotels priced at $500 per night or below ' +
                  'with a value score of 7.0 or higher. Price alone does not qualify a property — ' +
                  'it must also deliver strong quality relative to what you pay.',
      },
      {
        question: 'Are cheap hotels in Mauritius still good quality?',
        answer:   'Yes. Every hotel on this list is independently scored across five dimensions ' +
                  'including overall quality, location, and amenities. A low price paired with ' +
                  'poor quality simply does not make the ranking.',
      },
    ],
  };

  return [...base, ...(personaFAQs[persona] || [])];
}

/**
 * Returns related persona guide slugs for the related_content block.
 */
function getRelatedGuides(persona) {
  const all = [
    { label: 'Best Luxury Hotels in Mauritius',       slug: 'best-luxury-hotels-mauritius',       persona: 'luxury'       },
    { label: 'Best Honeymoon Hotels in Mauritius',    slug: 'best-honeymoon-hotels-mauritius',    persona: 'honeymoon'    },
    { label: 'Best Family Hotels in Mauritius',       slug: 'best-family-hotels-mauritius',       persona: 'family'       },
    { label: 'Best Wellness Resorts in Mauritius',    slug: 'best-wellness-resorts-mauritius',    persona: 'wellness'     },
    { label: 'Best Hotels for Remote Work in Mauritius', slug: 'best-remote-work-hotels-mauritius', persona: 'remote_work' },
    { label: 'Best Value Luxury Hotels in Mauritius', slug: 'best-value-luxury-hotels-mauritius', persona: 'value_luxury' },
    { label: 'Best Cheap Hotels in Mauritius',        slug: 'best-cheap-hotels-mauritius',        persona: 'budget'       },
    { label: 'Best Time to Visit Mauritius',          slug: 'best-time-to-visit-mauritius',       persona: null           },
    { label: 'Mauritius Honeymoon Guide',             slug: 'mauritius-honeymoon-guide',           persona: null           },
    { label: 'East Coast vs West Coast Mauritius',    slug: 'east-coast-vs-west-coast-mauritius',  persona: null           },
    { label: 'Le Morne Hotels Guide',                 slug: 'le-morne-hotels-mauritius',            persona: null           },
    { label: 'Mauritius Luxury Travel Guide',          slug: 'mauritius-luxury-travel-guide',         persona: null           },
    { label: 'Mauritius Family Holiday Guide',         slug: 'mauritius-family-holiday-guide',        persona: null           },
    { label: 'Mauritius Wellness Retreat Guide',       slug: 'mauritius-wellness-retreat-guide',      persona: null           },
    { label: 'Mauritius All-Inclusive Resorts',        slug: 'mauritius-all-inclusive-resorts',        persona: null           },
    { label: 'Where to Stay in Mauritius',             slug: 'where-to-stay-in-mauritius',             persona: null           },
    { label: 'Best Beach Resorts in Mauritius',        slug: 'best-beach-resorts-mauritius',           persona: null           },
    { label: 'Best Boutique Hotels in Mauritius',      slug: 'best-boutique-hotels-mauritius',         persona: null           },
    { label: 'Mauritius Travel Guide',                 slug: 'mauritius-travel-guide',                 persona: null           },
    { label: 'Grand Baie Hotels Guide',                slug: 'grand-baie-mauritius',                    persona: null           },
    { label: 'Balaclava Hotels Guide',                 slug: 'balaclava-mauritius-hotels',              persona: null           },
    { label: 'Belle Mare Hotels Guide',                slug: 'belle-mare-mauritius',                    persona: null           },
    { label: 'Flic en Flac Hotels Guide',              slug: 'flic-en-flac-mauritius',                  persona: null           },
    { label: 'Bel Ombre Hotels Guide',                 slug: 'bel-ombre-mauritius',                     persona: null           },
    { label: 'Cap Malheureux Hotels Guide',            slug: 'cap-malheureux-mauritius',                persona: null           },
    { label: 'Grand Gaube Hotels Guide',               slug: 'grand-gaube-mauritius',                   persona: null           },
    { label: 'Mauritius Packing List',                 slug: 'mauritius-packing-list',                  persona: null           },
    { label: 'Things to Do in Mauritius',              slug: 'things-to-do-in-mauritius',               persona: null           },
    { label: 'Best Beaches in Mauritius',              slug: 'best-beaches-in-mauritius',               persona: null           },
    { label: "Trou d'Eau Douce & Île aux Cerfs",       slug: 'trou-deau-douce-mauritius',               persona: null           },
    { label: 'Restaurants & Dining Guide',             slug: 'mauritius-restaurants-dining-guide',      persona: null           },
    { label: 'Budget Travel Guide',                    slug: 'mauritius-budget-travel-guide',           persona: null           },
    { label: 'Mauritius vs Maldives',                  slug: 'mauritius-vs-maldives',                   persona: null           },
    { label: 'Port Louis City Guide',                  slug: 'port-louis-mauritius-guide',              persona: null           },
    { label: 'Mauritius vs Seychelles',                slug: 'mauritius-vs-seychelles',                 persona: null           },
    { label: 'Visa & Entry Guide',                     slug: 'mauritius-visa-entry-guide',              persona: null           },
  ];
  return persona ? all.filter(g => g.persona !== persona) : all;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the hero block — full-width page header with H1 and persona context.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderHero(block) {
  requirePayloadFields('hero', block.payload, ['title', 'persona']);
  const { title, persona, target_keyword, page_type, booking_url, hotel_name } = block.payload;

  const isHotelDetail = page_type === 'hotel_detail';
  const ctaTarget     = hotel_name || title;

  const ctaHtml = (isHotelDetail && booking_url) ? [
    `  <div class="hero__actions">`,
    `    <a href="${esc(_safeUrl(booking_url))}"`,
    `       rel="noopener sponsored"`,
    `       class="hero__cta-btn"`,
    `       aria-label="Check availability for ${esc(ctaTarget)} on Expedia">`,
    `      Check availability on Expedia &#8594;`,
    `    </a>`,
    `    <p class="hero__cta-note">Affiliate link &middot; no extra cost to you</p>`,
    `  </div>`,
  ].join('\n') : '';

  return [
    `<section class="hero hero--${esc(page_type || 'ranking')}" aria-labelledby="hero-heading">`,
    `  <div class="hero__inner">`,
    `    <h1 id="hero-heading" class="hero__title">${esc(title)}</h1>`,
    isHotelDetail ? '' : `    <p class="hero__persona">For <strong>${esc(personaLabel(persona))}</strong> travelers</p>`,
    isHotelDetail ? '' : `    <p class="hero__tagline">${esc(personaTagline(persona))}</p>`,
    /* target_keyword is exposed via <head> meta only — not repeated in body HTML */
    ctaHtml,
    `  </div>`,
    `</section>`,
  ].filter(Boolean).join('\n');
}

/**
 * Renders the ranking summary block — numbered overview with jump links.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderRankingSummary(block) {
  requirePayloadFields('ranking_summary', block.payload, ['hotels', 'persona', 'total_hotels']);
  const { hotels, persona, total_hotels } = block.payload;

  const items = (hotels || []).map(h => {
    const ctaHtml = h.booking_url
      ? `<a href="${esc(_safeUrl(h.booking_url))}" rel="noopener sponsored" class="ranking-summary__cta" aria-label="Check availability for ${esc(h.name)} on Expedia">Check availability &#8594;</a>`
      : '';
    return `    <li class="ranking-summary__item">` +
      `<span class="ranking-summary__rank">#${esc(h.rank)}</span>` +
      `<a href="#hotel-${esc(h.hotel_id)}" class="ranking-summary__name">${esc(h.name)}</a>` +
      ctaHtml +
      `</li>`;
  }).join('\n');

  return [
    `<section class="ranking-summary" aria-label="Ranking overview">`,
    `  <h2 class="ranking-summary__heading">`,
    `    Top ${esc(total_hotels)} ${esc(personaLabel(persona))} Hotels in Mauritius`,
    `  </h2>`,
    `  <ol class="ranking-summary__list" aria-label="Hotel ranking list">`,
    items,
    `  </ol>`,
    `</section>`,
  ].join('\n');
}

/**
 * Renders the methodology block — scoring model transparency section.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderMethodology(block) {
  requirePayloadFields('methodology', block.payload, ['scoring_dimensions', 'persona']);
  const { scoring_dimensions, persona } = block.payload;

  const dimItems = (scoring_dimensions || []).map(d =>
    `    <li class="methodology__dimension">${esc(dimensionLabel(d))}</li>`
  ).join('\n');

  return [
    `<section class="methodology" aria-label="Ranking methodology">`,
    `  <h2 class="methodology__heading">How We Rank Hotels</h2>`,
    `  <p class="methodology__intro">`,
    `    Our rankings use an independent multi-dimensional scoring model calibrated for`,
    `    <strong>${esc(personaLabel(persona))}</strong> travelers.`,
    `    Hotels are scored across five weighted dimensions. Affiliate commission rates`,
    `    do not influence rankings or content.`,
    `  </p>`,
    `  <ul class="methodology__dimensions" aria-label="Scoring dimensions">`,
    dimItems,
    `  </ul>`,
    `  <p class="methodology__link-note">`,
    `    <a href="/methodology/" class="methodology__link">Read our full methodology →</a>`,
    `  </p>`,
    `</section>`,
  ].join('\n');
}

/**
 * Renders a hotel card block — article element with full explanation.
 * Supports expanded, standard, and compact variants via payload.card_variant.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderHotelCard(block) {
  requirePayloadFields('hotel_card', block.payload, ['rank', 'hotel_id', 'hotel_data']);
  const { rank, hotel_id, hotel_data, explanation, card_variant } = block.payload;

  const variant    = card_variant || 'standard';
  const hotelName  = hotel_data.hotel_name || hotel_data.name || hotel_id;
  const scores     = hotel_data.score_breakdown || {};
  const hotelScores = hotel_data.scores || {};
  const amenities  = hotel_data.amenities || {};
  const tier       = (hotel_data.tier && hotel_data.tier.label) || null;
  const region     = hotel_data.region || null;
  const rate       = hotel_data.avg_nightly_rate || null;
  const reviewCount = hotel_data.review_count || null;
  const starRating = hotel_data.star_rating || null;

  // ── Score bar rendering ──────────────────────────────────────────────────
  const scoreDimensions = ['overall_score', 'location_score', 'amenity_score', 'brand_score', 'value_score'];
  const scoreBars = scoreDimensions.map(dim => {
    const val = scores[dim];
    if (val === undefined || val === null) return '';
    const pct = Math.min(100, Math.max(0, Math.round(val)));
    return [
      `      <div class="hotel-card__score-row">`,
      `        <span class="hotel-card__score-label">${esc(dimensionLabel(dim))}</span>`,
      `        <span class="hotel-card__score-bar" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(dimensionLabel(dim))} score: ${pct} out of 100">`,
      `          <span class="hotel-card__score-fill" style="width:${pct}%"></span>`,
      `        </span>`,
      `        <span class="hotel-card__score-value">${fmtScore(val)}</span>`,
      `      </div>`,
    ].join('\n');
  }).filter(Boolean).join('\n');

  // ── Amenity badges ───────────────────────────────────────────────────────
  const amenityLabels = {
    spa:            'Spa',
    private_beach:  'Private Beach',
    butler_service: 'Butler Service',
    fine_dining:    'Fine Dining',
    private_pool:   'Private Pool',
    overwater_villa:'Overwater Villa',
    pool:           'Pool',
    gym:            'Gym',
    golf:           'Golf',
    kids_club:      'Kids Club',
    yoga:           'Yoga',
    helicopter_transfer: 'Helicopter Transfer',
    water_sports:   'Water Sports',
    concierge:      'Concierge',
  };
  const activeAmenities = Object.entries(amenityLabels)
    .filter(([key]) => amenities[key] === true)
    .map(([, label]) =>
      `      <li class="hotel-card__amenity">${esc(label)}</li>`
    ).join('\n');

  // ── Explanation ──────────────────────────────────────────────────────────
  let explanationHtml = '';
  if (explanation && variant !== 'compact') {
    const summary    = explanation.explanation_summary || '';
    const strengths  = explanation.strengths          || [];
    const weaknesses = explanation.weaknesses         || [];
    const fit        = explanation.traveler_fit       || {};
    const confidence = explanation.confidence_level   || '';

    const strengthItems = strengths.map(s =>
      `        <li class="hotel-card__strength">${esc(s.final_text)}</li>`
    ).join('\n');

    const weaknessItem = (weaknesses[0] && weaknesses[0].final_text)
      ? `<p class="hotel-card__weakness-text">${esc(weaknesses[0].final_text)}</p>`
      : '';

    const fitHtml = (variant === 'expanded') ? [
      fit.positive_fit
        ? `<p class="hotel-card__fit-positive">${esc(fit.positive_fit)}</p>`
        : '',
      fit.cautionary_note
        ? `<p class="hotel-card__fit-caution">${esc(fit.cautionary_note)}</p>`
        : '',
    ].filter(Boolean).join('\n') : '';

    explanationHtml = [
      summary
        ? `    <p class="hotel-card__summary">${esc(summary)}</p>`
        : '',
      strengths.length > 0 ? [
        `    <div class="hotel-card__strengths">`,
        `      <h3 class="hotel-card__strengths-heading">Why It Ranks Here</h3>`,
        `      <ul class="hotel-card__strengths-list">`,
        strengthItems,
        `      </ul>`,
        `    </div>`,
      ].join('\n') : '',
      weaknessItem ? [
        `    <div class="hotel-card__weakness">`,
        `      <h3 class="hotel-card__weakness-heading">Areas to Consider</h3>`,
        weaknessItem,
        `    </div>`,
      ].join('\n') : '',
      (variant === 'expanded' && fitHtml) ? [
        `    <div class="hotel-card__traveler-fit">`,
        `      <h3 class="hotel-card__fit-heading">Traveler Fit</h3>`,
        fitHtml,
        `    </div>`,
      ].join('\n') : '',
      confidence ? [
        `    <p class="hotel-card__confidence">`,
        `      Confidence: <strong>${esc(capitalize(confidence))}</strong>`,
        `    </p>`,
      ].join('\n') : '',
    ].filter(Boolean).join('\n');
  }

  // ── Hotel JSON-LD schema ─────────────────────────────────────────────────
  const schemaObj = {
    '@context': 'https://schema.org',
    '@type':    'Hotel',
    name:       hotelName,
    ...(region ? { address: { '@type': 'PostalAddress', addressLocality: region, addressCountry: 'MU' } } : {}),
    ...(starRating ? { starRating: { '@type': 'Rating', ratingValue: String(starRating), bestRating: '5' } } : {}),
    ...(reviewCount ? {
      aggregateRating: {
        '@type':       'AggregateRating',
        ratingValue:   String(hotel_data.avg_rating || ''),
        reviewCount:   String(reviewCount),
        bestRating:    '10',
        worstRating:   '0',
      },
    } : {}),
    // priceRange intentionally omitted — prices link to Expedia for live rates
  };

  const schemaTag = [
    `  <script type="application/ld+json">`,
    `  ${escJsonLd(JSON.stringify(schemaObj, null, 2))}`,
    `  </script>`,
  ].join('\n');

  // ── Assemble article ─────────────────────────────────────────────────────
  const rankOrdinal = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;

  const metaLine = [
    tier     ? `<span class="hotel-card__tier">${esc(capitalize(tier))}</span>` : '',
    region   ? `<span class="hotel-card__region">${esc(region)}</span>` : '',
    starRating ? `<span class="hotel-card__stars" aria-label="${starRating} stars">${'★'.repeat(starRating)}</span>` : '',
    // price intentionally removed — see affiliate CTA for live Expedia rates
  ].filter(Boolean).join(' &middot; ');

  // ── Card footer: inline CTA + review link ───────────────────────────────
  const hotelSlug    = _slugify(hotelName);
  const bookingUrl   = block.payload.booking_url || null;
  const ctaEligible  = block.payload.cta_eligible && bookingUrl;

  const footerHtml = [
    `  <footer class="hotel-card__footer">`,
    ctaEligible
      ? [
          `    <a href="${esc(_safeUrl(bookingUrl))}"`,
          `       rel="noopener sponsored"`,
          `       class="hotel-card__cta-btn"`,
          `       aria-label="Check availability for ${esc(hotelName)} on Expedia">`,
          `      Check availability &#8594;`,
          `    </a>`,
        ].join('\n')
      : '',
    `    <a href="/hotels/${esc(hotelSlug)}/"`,
    `       class="hotel-card__review-btn"`,
    `       aria-label="Read full review of ${esc(hotelName)}">`,
    `      Full review &#8594;`,
    `    </a>`,
    `  </footer>`,
  ].filter(Boolean).join('\n');

  return [
    `<article class="hotel-card hotel-card--${esc(variant)}" id="hotel-${esc(hotel_id)}"`,
    `         aria-label="Ranked ${rankOrdinal}: ${esc(hotelName)}">`,
    `  ${schemaTag}`,
    `  <header class="hotel-card__header">`,
    `    <span class="hotel-card__rank-badge" aria-label="Rank ${rank}">#${rank}</span>`,
    `    <h2 class="hotel-card__name">${esc(hotelName)}</h2>`,
    metaLine ? `    <p class="hotel-card__meta">${metaLine}</p>` : '',
    `  </header>`,
    scoreBars ? [
      `  <div class="hotel-card__scores" aria-label="Score breakdown">`,
      scoreBars,
      `  </div>`,
    ].join('\n') : '',
    activeAmenities ? [
      `  <ul class="hotel-card__amenities" aria-label="Confirmed amenities">`,
      activeAmenities,
      `  </ul>`,
    ].join('\n') : '',
    explanationHtml ? [
      `  <div class="hotel-card__explanation">`,
      explanationHtml,
      `  </div>`,
    ].join('\n') : '',
    footerHtml,
    `</article>`,
  ].filter(line => line.trim() !== '').join('\n');
}

/**
 * Renders an affiliate CTA block — booking link with mandatory disclosure note.
 * Always renders affiliate disclosure adjacent to the CTA as required by policy.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderAffiliateCTA(block) {
  requirePayloadFields('affiliate_cta', block.payload, [
    'hotel_id', 'hotel_name', 'booking_url', 'affiliate_disclosure',
  ]);
  const { hotel_id, hotel_name, booking_url, provider, affiliate_disclosure, commission_tier } = block.payload;

  // Hard guard: never render a CTA without affiliate_disclosure === true
  if (affiliate_disclosure !== true) {
    throw new RendererError(
      `Affiliate CTA for hotel "${hotel_id}" is missing affiliate_disclosure: true`,
      { hotel_id },
    );
  }

  const tierClass = commission_tier === 'premium' ? ' affiliate-cta--premium' : '';

  return [
    `<div class="affiliate-cta${tierClass}" data-hotel-id="${esc(hotel_id)}">`,
    `  <a href="${esc(_safeUrl(booking_url))}"`,
    `     rel="noopener sponsored"`,
    `     class="affiliate-cta__link"`,
    `     aria-label="Check availability for ${esc(hotel_name)} on Expedia">`,
    `    Check availability →`,
    `  </a>`,
    `  <p class="affiliate-cta__disclosure">`,
    `    <small>Affiliate link — we may earn a commission.`,
    `    Rankings are not influenced by commercial arrangements.</small>`,
    `  </p>`,
    `</div>`,
  ].join('\n');
}

/**
 * Renders a comparison block — side-by-side hotel table.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderComparison(block) {
  requirePayloadFields('comparison', block.payload, ['hotel_ids']);
  const { hotel_ids, dimensions, title: compTitle } = block.payload;

  const headings = (hotel_ids || []).map(id =>
    `      <th scope="col" class="comparison__hotel-name">${esc(id)}</th>`
  ).join('\n');

  const dimRows = (dimensions || []).map(dim => [
    `    <tr class="comparison__row">`,
    `      <th scope="row" class="comparison__dim-label">${esc(dimensionLabel(dim))}</th>`,
    (hotel_ids || []).map(() =>
      `      <td class="comparison__cell">—</td>`
    ).join('\n'),
    `    </tr>`,
  ].join('\n')).join('\n');

  return [
    `<section class="comparison" aria-label="Hotel comparison">`,
    `  <h2 class="comparison__heading">${esc(compTitle || 'Hotel Comparison')}</h2>`,
    `  <div class="comparison__table-wrapper">`,
    `    <table class="comparison__table">`,
    `      <thead>`,
    `        <tr>`,
    `          <th scope="col" class="comparison__corner"></th>`,
    headings,
    `        </tr>`,
    `      </thead>`,
    `      <tbody>`,
    dimRows,
    `      </tbody>`,
    `    </table>`,
    `  </div>`,
    `</section>`,
  ].join('\n');
}

/**
 * Renders the FAQ block with FAQPage JSON-LD schema.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderFAQ(block) {
  requirePayloadFields('faq', block.payload, ['persona', 'page_type']);
  const { persona, slug } = block.payload;

  const faqs = getPersonaFAQs(persona, slug);

  const faqItems = faqs.map((faq, i) => [
    `  <div class="faq__item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">`,
    `    <h3 class="faq__question" itemprop="name">${esc(faq.question)}</h3>`,
    `    <div class="faq__answer" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">`,
    `      <p itemprop="text">${esc(faq.answer)}</p>`,
    `    </div>`,
    `  </div>`,
  ].join('\n')).join('\n');

  const faqSchema = {
    '@context':   'https://schema.org',
    '@type':      'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type':         'Question',
      name:            faq.question,
      acceptedAnswer:  { '@type': 'Answer', text: faq.answer },
    })),
  };

  return [
    `<section class="faq" aria-label="Frequently asked questions"`,
    `         itemscope itemtype="https://schema.org/FAQPage">`,
    `  <script type="application/ld+json">`,
    `  ${escJsonLd(JSON.stringify(faqSchema, null, 2))}`,
    `  </script>`,
    `  <h2 class="faq__heading">Frequently Asked Questions</h2>`,
    faqItems,
    `</section>`,
  ].join('\n');
}

/**
 * Renders the disclosure block — affiliate and methodology transparency.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderDisclosure(block) {
  requirePayloadFields('disclosure', block.payload, ['affiliate_disclosure_text']);
  const { affiliate_disclosure_text, methodology_link } = block.payload;

  return [
    `<section class="disclosure" aria-label="Affiliate disclosure" data-affiliate_disclosure="true">`,
    `  <h2 class="disclosure__heading">Disclosure</h2>`,
    `  <p class="disclosure__text">${esc(affiliate_disclosure_text)}</p>`,
    methodology_link
      ? `  <p class="disclosure__methodology-link"><a href="${esc(methodology_link)}" class="disclosure__link">Read our full ranking methodology →</a></p>`
      : '',
    `</section>`,
  ].filter(Boolean).join('\n');
}

/**
 * Renders the related content block — internal links to other persona guides.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderRelatedContent(block) {
  requirePayloadFields('related_content', block.payload, ['persona', 'page_type']);
  const { persona, page_type, hotel_a_name, hotel_a_slug, hotel_b_name, hotel_b_slug } = block.payload;

  const items = [];

  // Compare pages: link directly to each hotel's detail page first
  if (page_type === 'comparison' && hotel_a_slug && hotel_b_slug) {
    items.push(
      `    <li class="related-content__item related-content__item--hotel">` +
      `<a href="/${esc(hotel_a_slug)}/" class="related-content__link">${esc(hotel_a_name || hotel_a_slug)} — Full Review</a>` +
      `</li>`,
      `    <li class="related-content__item related-content__item--hotel">` +
      `<a href="/${esc(hotel_b_slug)}/" class="related-content__link">${esc(hotel_b_name || hotel_b_slug)} — Full Review</a>` +
      `</li>`
    );
  }

  // For hotel_detail pages include all persona guides (hotel is not itself a persona page,
  // so nothing should be excluded). For all other pages exclude the current persona.
  const guides = page_type === 'hotel_detail'
    ? getRelatedGuides(null)
    : getRelatedGuides(persona);

  guides.forEach(g => {
    items.push(
      `    <li class="related-content__item">` +
      `<a href="/${esc(g.slug)}/" class="related-content__link">${esc(g.label)}</a>` +
      `</li>`
    );
  });

  return [
    `<nav class="related-content" aria-label="Related travel guides">`,
    `  <h2 class="related-content__heading">Related Guides</h2>`,
    `  <ul class="related-content__list">`,
    items.join('\n'),
    `  </ul>`,
    `</nav>`,
  ].join('\n');
}

/**
 * Renders an internal links block — supplementary anchor links.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderInternalLinks(block) {
  const { links, heading } = block.payload || {};
  const linkItems = Array.isArray(links) ? links.map(l =>
    `    <li class="internal-links__item">` +
    `<a href="${esc(_safeUrl(l.url || '#'))}" class="internal-links__link">${esc(l.label || l.url)}</a>` +
    `</li>`
  ).join('\n') : '';

  return [
    `<nav class="internal-links" aria-label="${esc(heading || 'Related links')}">`,
    heading ? `  <h2 class="internal-links__heading">${esc(heading)}</h2>` : '',
    `  <ul class="internal-links__list">`,
    linkItems,
    `  </ul>`,
    `</nav>`,
  ].filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HOTEL EDITORIAL BLOCK RENDERER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the hotel_editorial block — rich editorial content for hotel detail pages.
 * Produces 600+ words of data-derived content across 7 structured sections.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderHotelEditorial(block) {
  if (!block || !block.payload) {
    throw new RendererError('renderHotelEditorial: block.payload is required');
  }
  const p = block.payload;

  const lines = [
    `<section class="hotel-editorial" aria-label="Hotel editorial review">`,

    // ── Editorial Introduction ────────────────────────────────────────────
    `  <div class="hotel-editorial__intro">`,
    `    <h2 class="hotel-editorial__heading">About This Resort</h2>`,
  ];

  if (p.editorial_intro) {
    const paras = String(p.editorial_intro).split('\n\n');
    paras.forEach(para => {
      if (para.trim()) {
        lines.push(`    <p class="hotel-editorial__para">${esc(para.trim())}</p>`);
      }
    });
  }
  lines.push(`  </div>`);

  // ── Why Stay Here ─────────────────────────────────────────────────────
  if (Array.isArray(p.why_stay_here) && p.why_stay_here.length > 0) {
    lines.push(
      `  <div class="hotel-editorial__section">`,
      `    <h2 class="hotel-editorial__heading">Why Stay Here</h2>`,
      `    <ul class="hotel-editorial__list">`,
    );
    p.why_stay_here.forEach(item => {
      // Bold the **label** prefix if present
      const text = esc(String(item)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      lines.push(`      <li class="hotel-editorial__list-item">${text}</li>`);
    });
    lines.push(`    </ul>`, `  </div>`);
  }

  // ── Best For ─────────────────────────────────────────────────────────
  if (Array.isArray(p.best_for) && p.best_for.length > 0) {
    lines.push(
      `  <div class="hotel-editorial__section">`,
      `    <h2 class="hotel-editorial__heading">Best For</h2>`,
      `    <ul class="hotel-editorial__persona-list">`,
    );
    p.best_for.forEach(fit => {
      lines.push(
        `      <li class="hotel-editorial__persona-item">`,
        `        <span class="hotel-editorial__persona-label">${esc(String(fit.persona || fit))}</span>`,
        fit.reason ? `        <span class="hotel-editorial__persona-reason"> — ${esc(String(fit.reason))}</span>` : '',
        `      </li>`,
      );
    });
    lines.push(`    </ul>`, `  </div>`);
  }

  // ── Pros & Considerations ─────────────────────────────────────────────
  if (p.pros_considerations) {
    const { pros, consideration } = p.pros_considerations;
    lines.push(
      `  <div class="hotel-editorial__section hotel-editorial__pros-cons">`,
      `    <h2 class="hotel-editorial__heading">Scores at a Glance</h2>`,
      `    <div class="hotel-editorial__pros-grid">`,
    );
    if (Array.isArray(pros)) {
      pros.forEach(pro => {
        lines.push(
          `      <div class="hotel-editorial__pro">`,
          `        <span class="hotel-editorial__pro-label">${esc(String(pro.label))}</span>`,
          `        <span class="hotel-editorial__pro-score">${typeof pro.score === 'number' ? pro.score.toFixed(1) : esc(String(pro.score))}</span>`,
          `        <span class="hotel-editorial__pro-note">${esc(String(pro.note || ''))}</span>`,
          `      </div>`,
        );
      });
    }
    lines.push(`    </div>`);
    if (consideration) {
      lines.push(
        `    <div class="hotel-editorial__consideration">`,
        `      <span class="hotel-editorial__consideration-label">Note on ${esc(String(consideration.label || ''))}:</span>`,
        `      <span class="hotel-editorial__consideration-note"> ${esc(String(consideration.note || ''))}</span>`,
        `    </div>`,
      );
    }
    lines.push(`  </div>`);
  }

  // ── Nearby Attractions ────────────────────────────────────────────────
  if (Array.isArray(p.nearby_attractions) && p.nearby_attractions.length > 0) {
    lines.push(
      `  <div class="hotel-editorial__section">`,
      `    <h2 class="hotel-editorial__heading">Nearby</h2>`,
      `    <ul class="hotel-editorial__list">`,
    );
    p.nearby_attractions.forEach(item => {
      lines.push(`      <li class="hotel-editorial__list-item">${esc(String(item))}</li>`);
    });
    lines.push(`    </ul>`, `  </div>`);
  }

  // ── Comparison Context ────────────────────────────────────────────────
  if (p.comparison_context) {
    lines.push(
      `  <div class="hotel-editorial__section">`,
      `    <h2 class="hotel-editorial__heading">How It Compares</h2>`,
      `    <p class="hotel-editorial__para">${esc(String(p.comparison_context))}</p>`,
      `  </div>`,
    );
  }

  // ── Hotel FAQs ────────────────────────────────────────────────────────
  if (Array.isArray(p.hotel_faqs) && p.hotel_faqs.length > 0) {
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type':    'FAQPage',
      mainEntity: p.hotel_faqs.map(faq => ({
        '@type': 'Question',
        name:    faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    };

    lines.push(
      `  <div class="hotel-editorial__section hotel-editorial__faqs"`,
      `       itemscope itemtype="https://schema.org/FAQPage">`,
      `    <h2 class="hotel-editorial__heading">Frequently Asked Questions</h2>`,
    );
    p.hotel_faqs.forEach(faq => {
      lines.push(
        `    <div class="hotel-editorial__faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">`,
        `      <h3 class="hotel-editorial__faq-q" itemprop="name">${esc(String(faq.question))}</h3>`,
        `      <div class="hotel-editorial__faq-a" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">`,
        `        <p itemprop="text">${esc(String(faq.answer))}</p>`,
        `      </div>`,
        `    </div>`,
      );
    });
    lines.push(
      `  </div>`,
      `  <script type="application/ld+json">${escJsonLd(JSON.stringify(faqSchema))}</script>`,
    );
  }

  lines.push(`</section>`);
  return lines.filter(l => l !== '').join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK RENDERER REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal registry map: block_type → renderer function.
 * Mutable so custom renderers can be registered at runtime.
 */
const _blockRenderers = {
  hero:             renderHero,
  ranking_summary:  renderRankingSummary,
  methodology:      renderMethodology,
  hotel_card:       renderHotelCard,
  affiliate_cta:    renderAffiliateCTA,
  comparison:       renderComparison,
  faq:              renderFAQ,
  disclosure:       renderDisclosure,
  related_content:  renderRelatedContent,
  internal_links:   renderInternalLinks,
  hotel_editorial:  renderHotelEditorial,
};

/**
 * Registers a custom block renderer for the given block type.
 * Pass null to unregister a renderer.
 *
 * @param  {string}             blockType
 * @param  {Function|null}      rendererFn  — (block) => string
 */
function registerBlockRenderer(blockType, rendererFn) {
  if (typeof blockType !== 'string' || !blockType) {
    throw new RendererError('registerBlockRenderer: blockType must be a non-empty string');
  }
  if (rendererFn === null) {
    delete _blockRenderers[blockType];
    return;
  }
  if (typeof rendererFn !== 'function') {
    throw new RendererError('registerBlockRenderer: rendererFn must be a function or null');
  }
  _blockRenderers[blockType] = rendererFn;
}

/**
 * Returns a copy of the current renderer registry.
 * @returns {Object}
 */
function getBlockRenderers() {
  return Object.assign({}, _blockRenderers);
}

/**
 * Renders a single block by dispatching to the appropriate renderer.
 * Throws UnsupportedBlockTypeError if no renderer is registered.
 *
 * @param  {Object} block
 * @returns {string} HTML
 */
function renderBlock(block) {
  if (!block || typeof block !== 'object' || !block.block_type) {
    throw new RendererError('renderBlock: block must be an object with a block_type field');
  }
  const renderer = _blockRenderers[block.block_type];
  if (!renderer) {
    throw new UnsupportedBlockTypeError(block.block_type);
  }
  return renderer(block);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE METADATA EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts page metadata from the AssemblyResult for use in <head>.
 * Derives title, description, slug, and persona from the hero block.
 * Falls back gracefully if hero block is absent.
 *
 * @param  {Object} pageObject   — AssemblyResult
 * @param  {Object} options
 * @returns {{
 *   title:       string,
 *   description: string,
 *   slug:        string,
 *   persona:     string,
 *   keyword:     string,
 *   pageType:    string,
 * }}
 */
function extractPageMeta(pageObject, options = {}) {
  const blocks  = (pageObject && pageObject.blocks) || [];
  const heroBlk = blocks.find(b => b.block_type === 'hero');
  const payload = (heroBlk && heroBlk.payload) || {};

  const title   = payload.title       || 'Hotels in Mauritius';
  const slug    = payload.slug        || '';
  const persona = payload.persona     || '';
  const keyword = payload.target_keyword || '';
  const pageType = payload.page_type  || 'ranking';

  // Build a CTR-optimised meta description based on page type and persona.
  const PERSONA_DESCRIPTIONS = {
    luxury:       'Expert rankings of Mauritius\'s finest luxury hotels — independently scored on location, amenities, brand prestige, and value. No paid placements. 2026.',
    honeymoon:    'The best honeymoon hotels in Mauritius — adults-only retreats, private beach villas, and couples spas. Independently scored and ranked.',
    family:       'Top family-friendly resorts in Mauritius, ranked for kids clubs, shallow lagoons, and family suites. Independent reviews from Mauritius Resort Finder.',
    wellness:     'Mauritius\'s top wellness resorts — ranked by spa quality, yoga programmes, and holistic treatments. Independent scores, no sponsored placements.',
    remote_work:  'Best hotels for remote work in Mauritius — fast Wi-Fi, quiet workspaces, and reliable connectivity. Independently reviewed and scored.',
    value_luxury: 'The best-value luxury hotels in Mauritius — five-star quality at smart prices. Independently scored on amenities, location, and value.',
  };

  let description = '';
  if (pageType === 'hotel_detail' || pageType === 'hotel') {
    const hotelName = payload.hotel_name || title.replace(/ Review & Booking Guide.*$/, '');
    const hotelCard = blocks.find(b => b.block_type === 'hotel_card');
    const region    = (hotelCard && hotelCard.payload && hotelCard.payload.hotel_data && hotelCard.payload.hotel_data.region) || null;
    const locationStr = region ? `${region}, Mauritius` : 'Mauritius';
    description = `${hotelName} — independent review covering location, amenities, guest ratings, and booking options in ${locationStr}.`;
  } else if (PERSONA_DESCRIPTIONS[persona]) {
    description = PERSONA_DESCRIPTIONS[persona];
  } else if (pageType === 'region' || pageType === 'ranking') {
    description = `${title}. ${personaTagline(persona)} Independently scored and ranked.`;
  } else {
    description = `${title}. ${personaTagline(persona)} Independently scored and ranked.`;
  }
  if (description.length > 160) description = description.slice(0, 157) + '...';

  return { title, description, slug, persona, keyword, pageType };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED DATA (page-level)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates page-level JSON-LD structured data:
 *   - BreadcrumbList
 *   - ItemList (hotel rankings)
 *
 * @param  {Object} pageObject
 * @param  {Object} meta       — from extractPageMeta()
 * @param  {string} baseUrl
 * @returns {string[]} — array of <script> tag strings
 */
function generateStructuredData(pageObject, meta, baseUrl) {
  const blocks    = (pageObject && pageObject.blocks) || [];
  const canonUrl  = (`${baseUrl}/${meta.slug}`.replace(/\/+$/, '')) + '/';

  // BreadcrumbList
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',             item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Hotels',           item: `${baseUrl}/hotels` },
      { '@type': 'ListItem', position: 3, name: 'Mauritius',        item: `${baseUrl}/hotels/mauritius` },
      { '@type': 'ListItem', position: 4, name: meta.title,         item: canonUrl },
    ],
  };

  // ItemList — one entry per affiliate CTA block (trust-gated; always has disclosure)
  const ctaBlocks   = blocks.filter(b => b.block_type === 'affiliate_cta');
  const hotelCards  = blocks.filter(b => b.block_type === 'hotel_card');

  const itemList = {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    name:       meta.title,
    url:        canonUrl,
    numberOfItems: hotelCards.length,
    itemListElement: hotelCards.map((card, i) => {
      const cta  = ctaBlocks.find(c => c.payload && c.payload.hotel_id === card.payload.hotel_id);
      const url  = (cta && cta.payload.booking_url) || `${canonUrl}#hotel-${card.payload.hotel_id}`;
      return {
        '@type':    'ListItem',
        position:   i + 1,
        name:       (card.payload.hotel_data && card.payload.hotel_data.hotel_name) || card.payload.hotel_id,
        url,
      };
    }),
  };

  // Return raw JSON strings (no <script> wrapper); generateHead() adds the wrappers.
  return [
    escJsonLd(JSON.stringify(breadcrumb, null, 2)),
    escJsonLd(JSON.stringify(itemList,   null, 2)),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML DOCUMENT ASSEMBLY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the full <head> element.
 *
 * @param  {Object} meta      — from extractPageMeta()
 * @param  {string} baseUrl
 * @param  {string} siteName
 * @param  {string} lang
 * @param  {string[]} schemaScripts
 * @returns {string}
 */
function generateHead(meta, baseUrl, siteName, lang, schemaScripts) {
  const canonUrl = (`${baseUrl}/${meta.slug}`.replace(/\/+$/, '')) + '/';

  const lines = [
    `  <meta charset="UTF-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `  <!-- Google Analytics -->`,
    `  <script async src="https://www.googletagmanager.com/gtag/js?id=G-TN713HPVCQ"></script>`,
    `  <script src="/assets/js/analytics.js" defer></script>`,
    `  <title>${esc(meta.title)}</title>`,
    `  <meta name="description" content="${esc(meta.description)}">`,
    meta.keyword
      ? `  <meta name="keywords" content="${esc(meta.keyword)}">` : '',
    `  <link rel="canonical" href="${esc(canonUrl)}">`,
    `  <meta name="google-site-verification" content="4Xa_6yknHuo9NgLnSQB7Sv3XnWpBhCk3e5McOFstAjo">`,
    ``,
    `  <!-- Open Graph -->`,
    `  <meta property="og:title"       content="${esc(meta.title)}">`,
    `  <meta property="og:description" content="${esc(meta.description)}">`,
    `  <meta property="og:url"         content="${esc(canonUrl)}">`,
    `  <meta property="og:type"        content="article">`,
    `  <meta property="og:site_name"   content="${esc(siteName)}">`,
    ``,
    `  <!-- Twitter Card -->`,
    `  <meta name="twitter:card"        content="summary">`,
    `  <meta name="twitter:title"       content="${esc(meta.title)}">`,
    `  <meta name="twitter:description" content="${esc(meta.description)}">`,
    ``,
    `  <!-- Structured Data -->`,
    ...schemaScripts.map(s =>
      `  <script type="application/ld+json">\n  ${s.replace(/\n/g, '\n  ')}\n  </script>`
    ),
    ``,
    `  <!-- Fonts -->`,
    `  <link rel="preconnect" href="https://fonts.googleapis.com">`,
    `  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
    `  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">`,
    `  <!-- Luxury Design System -->`,
    `  <style>`,
    `    :root{--deep-navy:#08111f;--midnight:#0d1117;--navy-card:#0e1623;--navy-raised:#111a28;--gold:#c9a84c;--gold-dim:#9b7d35;--gold-bright:#e2bc60;--gold-glow:rgba(201,168,76,.12);--champagne:#f5e6c8;--text:#e8dfc8;--text-dim:#c4bba8;--muted:#8b949e;--border:rgba(255,255,255,.07);--border-light:rgba(255,255,255,.12);--border-gold:rgba(201,168,76,.30);--radius:14px;--radius-sm:9px;--radius-lg:20px;--radius-pill:100px;--shadow-hover:0 12px 40px rgba(0,0,0,.4),0 4px 16px rgba(0,0,0,.2);--ease:cubic-bezier(.4,0,.2,1);--ease-out:cubic-bezier(0,0,.2,1)}`,
    `    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}`,
    `    html{scroll-behavior:smooth;font-size:16px;-webkit-text-size-adjust:100%;overflow-x:hidden}`,
    `    body{background:var(--deep-navy);color:var(--text);font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased;padding-top:64px}`,
    `    h1,h2,h3,h4{font-family:'Cormorant Garamond',Georgia,serif;font-weight:700;letter-spacing:-.01em;line-height:1.2;color:var(--champagne)}`,
    `    h1{font-size:clamp(2rem,4.5vw,3.2rem);letter-spacing:-.03em}h2{font-size:clamp(1.5rem,2.8vw,2.4rem);letter-spacing:-.02em}h3{font-size:clamp(1rem,1.6vw,1.25rem)}`,
    `    h4{font-size:.9rem;font-family:'DM Sans',sans-serif;font-weight:700;letter-spacing:0}`,
    `    p{color:var(--muted);line-height:1.75}a{color:inherit;text-decoration:none}strong{color:var(--text);font-weight:600}img{max-width:100%;height:auto;display:block}`,
    `    .container{max-width:1200px;margin:0 auto;padding:0 28px}main{padding-bottom:80px}`,
    `    .reveal{opacity:0;transform:translateY(16px);transition:opacity .7s var(--ease-out),transform .7s var(--ease-out)}.reveal.is-visible{opacity:1;transform:translateY(0)}`,
    `    @media(prefers-reduced-motion:reduce){.reveal{transition:none;opacity:1;transform:none}.hotel-card__score-fill{animation:none}}`,
    `    .skip-link{position:absolute;left:-9999px;top:8px;background:var(--gold);color:var(--deep-navy);padding:8px 16px;border-radius:6px;font-weight:700;z-index:999;font-size:.85rem}.skip-link:focus{left:8px}`,
    `    a:focus-visible,button:focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:3px}`,
    `    @keyframes scoreBarFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}`,
    `    .site-header{position:fixed;top:0;left:0;right:0;z-index:200;background:rgba(8,17,31,.96);backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);border-bottom:1px solid var(--border);transition:transform .3s var(--ease)}`,
    `    .site-nav{display:flex;align-items:center;justify-content:space-between;height:64px;max-width:1200px;margin:0 auto;padding:0 28px}`,
    `    .site-logo{display:flex;align-items:center;gap:10px;font-family:'Cormorant Garamond',serif;font-weight:700;font-size:1rem;color:var(--champagne);letter-spacing:.01em}`,
    `    .site-logo__mark{width:30px;height:30px;border-radius:7px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-dim) 100%);display:grid;place-items:center;font-size:.85rem;color:var(--deep-navy);font-weight:900;font-family:'Cormorant Garamond',serif;box-shadow:0 2px 10px rgba(201,168,76,.35);flex-shrink:0}`,
    `    .site-nav__list{display:flex;gap:28px;list-style:none}.site-nav__list a{font-size:.75rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);transition:color .2s;position:relative}.site-nav__list a::after{content:'';position:absolute;bottom:-3px;left:0;width:0;height:1px;background:var(--gold);transition:width .2s var(--ease)}.site-nav__list a:hover{color:var(--champagne)}.site-nav__list a:hover::after{width:100%}`,
    `    .hero{padding:72px 0 60px;position:relative;overflow:hidden}.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 50% at 50% -5%,rgba(201,168,76,.08) 0%,transparent 65%);pointer-events:none}.hero .container{position:relative}`,
    `    .hero__persona{display:inline-flex;align-items:center;gap:8px;font-size:.65rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--gold);background:var(--gold-glow);border:1px solid var(--border-gold);border-radius:var(--radius-pill);padding:5px 14px;margin-bottom:24px}.hero__persona::before{content:'●';font-size:.42rem;opacity:.7}`,
    `    .hero__title{margin-bottom:16px}.hero__tagline{font-size:1rem;color:var(--muted);max-width:560px;line-height:1.8}`,
    `    .hero__actions{margin-top:28px;display:flex;flex-direction:column;align-items:flex-start;gap:10px}`,
    `    .hero__cta-btn{background:linear-gradient(135deg,var(--gold) 0%,var(--gold-bright) 50%,var(--gold-dim) 100%);background-size:200% auto;color:var(--deep-navy);font-family:'DM Sans',sans-serif;font-size:.9rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:14px 32px;border-radius:var(--radius-pill);white-space:nowrap;transition:background-position .4s,box-shadow .3s,transform .2s;display:inline-block;position:relative;overflow:hidden}`,
    `    .hero__cta-btn:hover{background-position:right center;box-shadow:0 8px 32px rgba(201,168,76,.55);transform:translateY(-2px)}`,
    `    .hero__cta-note{font-size:.7rem;color:var(--muted)}`,
    `    .ranking-summary{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 32px;margin:24px auto;max-width:1200px}`,
    `    .ranking-summary__heading{font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;font-family:'DM Sans',sans-serif}`,
    `    .ranking-summary__list{list-style:none;display:flex;flex-direction:column;gap:10px}.ranking-summary__item{display:flex;align-items:center;gap:14px}.ranking-summary__rank{font-family:'Cormorant Garamond',serif;font-size:.95rem;font-weight:800;color:var(--gold);width:28px;flex-shrink:0}`,
    `    .ranking-summary__name{font-size:.88rem;color:var(--text);transition:color .2s;flex:1}.ranking-summary__name:hover{color:var(--gold)}`,
    `    .ranking-summary__cta{flex-shrink:0;font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--deep-navy);background:linear-gradient(135deg,var(--gold) 0%,var(--gold-bright) 50%,var(--gold-dim) 100%);background-size:200% auto;padding:5px 14px;border-radius:var(--radius-pill);white-space:nowrap;transition:background-position .3s,box-shadow .2s;display:inline-block}.ranking-summary__cta:hover{background-position:right center;box-shadow:0 4px 16px rgba(201,168,76,.45)}`,
    `    .methodology{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:36px;margin:28px auto;max-width:1200px}`,
    `    .methodology__heading{margin-bottom:12px}.methodology__intro{font-size:.9rem;margin-bottom:18px;max-width:640px;line-height:1.75}`,
    `    .methodology__dimensions{list-style:none;display:flex;flex-wrap:wrap;gap:10px}.methodology__dimension{background:var(--navy-raised);border:1px solid var(--border-gold);border-radius:var(--radius-pill);padding:5px 16px;font-size:.75rem;font-weight:600;color:var(--gold)}`,
    `    .methodology__link-note{margin-top:18px;font-size:.85rem}.methodology__link{color:var(--gold);font-weight:600}.methodology__link:hover{text-decoration:underline}`,
    `    .hotel-card{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 32px;margin:14px auto;max-width:1200px;position:relative;overflow:hidden;transition:border-color .2s,transform .2s var(--ease-out),box-shadow .2s}`,
    `    .hotel-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:background .2s}`,
    `    .hotel-card:hover{border-color:var(--border-gold);transform:translateY(-2px);box-shadow:var(--shadow-hover)}.hotel-card:hover::before{background:var(--gold)}`,
    `    .hotel-card__header{margin-bottom:16px}.hotel-card__rank-badge{display:inline-flex;align-items:center;font-size:.72rem;font-weight:800;color:var(--gold);background:var(--gold-glow);border:1px solid var(--border-gold);border-radius:var(--radius-pill);padding:3px 12px;margin-bottom:10px}`,
    `    .hotel-card__name{font-family:'Cormorant Garamond',serif;font-size:1.3rem;margin-bottom:6px;color:var(--champagne)}.hotel-card__meta{font-size:.8rem;color:var(--muted)}.hotel-card__tier{font-weight:600;color:var(--text)}.hotel-card__region::before{content:'📍';margin-right:4px;font-size:.65rem}.hotel-card__stars{color:var(--gold)}`,
    `    .hotel-card__scores{display:flex;flex-direction:column;gap:10px;margin-bottom:18px;padding:18px;background:rgba(255,255,255,.025);border-radius:var(--radius-sm);border:1px solid var(--border)}`,
    `    .hotel-card__score-row{display:flex;align-items:center;gap:12px}.hotel-card__score-label{font-size:.7rem;color:var(--muted);width:80px;flex-shrink:0;text-transform:uppercase;letter-spacing:.06em}`,
    `    .hotel-card__score-bar{flex:1;height:5px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden}.hotel-card__score-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--gold-dim),var(--gold-bright));transform-origin:left;animation:scoreBarFill .9s var(--ease-out) both}`,
    `    .hotel-card__score-value{font-size:.78rem;font-weight:700;color:var(--gold);width:56px;text-align:right;flex-shrink:0;font-family:'Cormorant Garamond',serif;font-feature-settings:'tnum'}`,
    `    .hotel-card__amenities{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.hotel-card__amenity{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:var(--radius-pill);padding:3px 12px;font-size:.73rem;color:var(--muted)}`,
    `    .hotel-card__explanation{padding-top:18px;border-top:1px solid var(--border)}.hotel-card__summary{font-size:.9rem;line-height:1.75;margin-bottom:14px}`,
    `    .hotel-card__footer{display:flex;align-items:center;gap:12px;margin-top:20px;padding-top:18px;border-top:1px solid var(--border);flex-wrap:wrap}`,
    `    .hotel-card__cta-btn{background:linear-gradient(135deg,var(--gold) 0%,var(--gold-bright) 50%,var(--gold-dim) 100%);background-size:200% auto;color:var(--deep-navy);font-family:'DM Sans',sans-serif;font-size:.78rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;padding:10px 22px;border-radius:var(--radius-pill);white-space:nowrap;transition:background-position .4s,box-shadow .2s,transform .2s;display:inline-block;position:relative;overflow:hidden}`,
    `    .hotel-card__cta-btn:hover{background-position:right center;box-shadow:0 6px 24px rgba(201,168,76,.5);transform:translateY(-1px)}`,
    `    .hotel-card__review-btn{font-family:'DM Sans',sans-serif;font-size:.74rem;color:var(--muted);letter-spacing:.04em;border:1px solid var(--border);padding:9px 18px;border-radius:var(--radius-pill);white-space:nowrap;display:inline-flex;align-items:center;min-height:40px;transition:all .2s}`,
    `    .hotel-card__review-btn:hover{border-color:var(--border-gold);color:var(--gold)}`,
    `    .hotel-card__strengths-heading,.hotel-card__weakness-heading,.hotel-card__fit-heading{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:10px;font-family:'DM Sans',sans-serif}`,
    `    .hotel-card__strengths-list{list-style:none;display:flex;flex-direction:column;gap:8px;margin-bottom:14px}.hotel-card__strength{font-size:.87rem;padding-left:16px;position:relative;color:var(--muted)}.hotel-card__strength::before{content:'✓';position:absolute;left:0;color:var(--gold);font-weight:700}`,
    `    .hotel-card__weakness-text{font-size:.85rem;color:var(--muted);padding-left:16px;position:relative}.hotel-card__weakness-text::before{content:'→';position:absolute;left:0;color:var(--muted)}`,
    `    .hotel-card__fit-positive,.hotel-card__fit-caution{font-size:.85rem;margin-bottom:8px}.hotel-card__confidence{font-size:.76rem;color:var(--muted);margin-top:12px}`,
    `    .affiliate-cta{margin:20px auto;max-width:1200px;padding:22px 28px;background:var(--navy-card);border:1px solid var(--border-gold);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px}`,
    `    .affiliate-cta__link{background:linear-gradient(135deg,var(--gold) 0%,var(--gold-bright) 50%,var(--gold-dim) 100%);background-size:200% auto;color:var(--deep-navy);font-family:'DM Sans',sans-serif;font-size:.82rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;padding:11px 24px;border-radius:var(--radius-pill);transition:background-position .4s,box-shadow .2s,transform .2s;white-space:nowrap;position:relative;overflow:hidden;display:inline-block}`,
    `    .affiliate-cta__link::before{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);transition:left .5s}`,
    `    .affiliate-cta__link:hover{background-position:right center;box-shadow:0 6px 24px rgba(201,168,76,.5);transform:translateY(-1px)}.affiliate-cta__link:hover::before{left:100%}`,
    `    .affiliate-cta__disclosure{font-size:.7rem;color:var(--muted);flex:1;min-width:200px;line-height:1.6}.affiliate-cta--premium{border-color:var(--gold)}`,
    `    .comparison{margin:28px auto;max-width:1200px}.comparison__heading{font-size:1.2rem;margin-bottom:18px}.comparison__table-wrapper{overflow-x:auto}`,
    `    .comparison__table{width:100%;border-collapse:collapse}.comparison__table th,.comparison__table td{padding:12px 16px;border:1px solid var(--border);font-size:.83rem;text-align:left}`,
    `    .comparison__table thead th{background:var(--navy-card);font-weight:700;color:var(--champagne);font-family:'Cormorant Garamond',serif}.comparison__table tbody tr:nth-child(even){background:var(--navy-card)}.comparison__dim-label{font-weight:600;color:var(--muted)}.comparison__corner{background:var(--deep-navy);border:1px solid var(--border)}`,
    `    .faq{margin:28px auto;max-width:1200px}.faq__heading{margin-bottom:24px}`,
    `    .faq__item{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:22px 26px;margin-bottom:12px;transition:border-color .2s}.faq__item:hover{border-color:var(--border-light)}`,
    `    .faq__question{font-family:'Cormorant Garamond',serif;font-size:.95rem;margin-bottom:10px;color:var(--champagne)}.faq__answer p{font-size:.87rem;line-height:1.7}`,
    `    .disclosure{margin:28px auto;max-width:1200px;background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:24px 28px}`,
    `    .disclosure__heading{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:10px;font-family:'DM Sans',sans-serif}`,
    `    .disclosure__text{font-size:.82rem;line-height:1.65;margin-bottom:10px}.disclosure__methodology-link{font-size:.82rem}.disclosure__link{color:var(--gold);font-weight:600}.disclosure__link:hover{text-decoration:underline}`,
    `    .related-content{margin:28px auto;max-width:1200px}.related-content__heading{font-family:'Cormorant Garamond',serif;font-size:1rem;margin-bottom:16px}`,
    `    .related-content__list{list-style:none;display:flex;flex-wrap:wrap;gap:10px}.related-content__link{display:inline-block;background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-pill);padding:9px 18px;font-size:.8rem;color:var(--muted);transition:all .2s}.related-content__link:hover{border-color:var(--border-gold);color:var(--gold)}`,
    `    .hotel-editorial{margin:28px auto;max-width:1200px;display:flex;flex-direction:column;gap:28px}`,
    `    .hotel-editorial__intro{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:28px 32px}.hotel-editorial__intro-heading{font-family:'Cormorant Garamond',serif;font-size:1.25rem;margin-bottom:16px;color:var(--champagne)}.hotel-editorial__intro p{font-size:.88rem;line-height:1.8;color:var(--text-secondary);margin-bottom:12px}.hotel-editorial__intro p:last-child{margin-bottom:0}`,
    `    .hotel-editorial__why{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:28px 32px}.hotel-editorial__why-heading{font-family:'Cormorant Garamond',serif;font-size:1.1rem;margin-bottom:16px;color:var(--champagne)}.hotel-editorial__why-list{list-style:none;display:flex;flex-direction:column;gap:10px}.hotel-editorial__why-item{display:flex;align-items:flex-start;gap:10px;font-size:.87rem;line-height:1.65;color:var(--text-secondary)}.hotel-editorial__why-item::before{content:'✦';color:var(--gold);flex-shrink:0;margin-top:2px}`,
    `    .hotel-editorial__best-for{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:28px 32px}.hotel-editorial__best-for-heading{font-family:'Cormorant Garamond',serif;font-size:1.1rem;margin-bottom:16px;color:var(--champagne)}.hotel-editorial__best-for-grid{display:flex;flex-wrap:wrap;gap:10px}.hotel-editorial__persona{background:var(--navy-deep);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 16px;flex:1 1 200px}.hotel-editorial__persona-label{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--gold);margin-bottom:6px}.hotel-editorial__persona-reason{font-size:.82rem;line-height:1.6;color:var(--text-secondary)}`,
    `    .hotel-editorial__pros-cons{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:28px 32px}.hotel-editorial__pros-cons-heading{font-family:'Cormorant Garamond',serif;font-size:1.1rem;margin-bottom:16px;color:var(--champagne)}.hotel-editorial__pros-cons-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:640px){.hotel-editorial__pros-cons-grid{grid-template-columns:1fr}}.hotel-editorial__pros,.hotel-editorial__considerations{display:flex;flex-direction:column;gap:8px}.hotel-editorial__pros-label,.hotel-editorial__considerations-label{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}.hotel-editorial__pros-label{color:#6fcf97}.hotel-editorial__considerations-label{color:#f2994a}.hotel-editorial__pro-item{display:flex;align-items:flex-start;gap:8px;font-size:.85rem;line-height:1.6;color:var(--text-secondary)}.hotel-editorial__pro-item::before{content:'✓';color:#6fcf97;flex-shrink:0}.hotel-editorial__con-item{display:flex;align-items:flex-start;gap:8px;font-size:.85rem;line-height:1.6;color:var(--text-secondary)}.hotel-editorial__con-item::before{content:'△';color:#f2994a;flex-shrink:0}`,
    `    .hotel-editorial__nearby{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:28px 32px}.hotel-editorial__nearby-heading{font-family:'Cormorant Garamond',serif;font-size:1.1rem;margin-bottom:16px;color:var(--champagne)}.hotel-editorial__nearby-list{list-style:none;display:flex;flex-wrap:wrap;gap:8px}.hotel-editorial__nearby-item{background:var(--navy-deep);border:1px solid var(--border);border-radius:var(--radius-pill);padding:8px 16px;font-size:.82rem;color:var(--muted)}`,
    `    .hotel-editorial__comparison{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:28px 32px}.hotel-editorial__comparison-heading{font-family:'Cormorant Garamond',serif;font-size:1.1rem;margin-bottom:12px;color:var(--champagne)}.hotel-editorial__comparison-text{font-size:.87rem;line-height:1.75;color:var(--text-secondary)}`,
    `    .hotel-editorial__faqs{margin-top:4px}.hotel-editorial__faqs-heading{font-family:'Cormorant Garamond',serif;font-size:1.1rem;margin-bottom:16px;color:var(--champagne)}.hotel-editorial__faq-item{background:var(--navy-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:20px 24px;margin-bottom:10px}.hotel-editorial__faq-question{font-size:.9rem;font-weight:700;color:var(--champagne);margin-bottom:8px}.hotel-editorial__faq-answer{font-size:.85rem;line-height:1.7;color:var(--text-secondary)}`,
    `    .internal-links{margin:28px auto;max-width:1200px}.internal-links__heading{font-size:.85rem;color:var(--muted);margin-bottom:12px}`,
    `    .internal-links__list{list-style:none;display:flex;flex-wrap:wrap;gap:8px}.internal-links__link{font-size:.8rem;color:var(--gold);transition:text-decoration .15s}.internal-links__link:hover{text-decoration:underline}`,
    `    .site-footer{border-top:1px solid var(--border);padding:40px 28px 28px;max-width:1200px;margin:56px auto 0;display:flex;flex-direction:column;gap:24px}`,
    `    .site-footer__cols{display:flex;gap:48px;flex-wrap:wrap}.site-footer__col-heading{font-size:.7rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--gold);margin-bottom:10px}.site-footer__col ul{list-style:none;display:flex;flex-direction:column;gap:6px}.site-footer__col a{font-size:.78rem;color:var(--muted);transition:color .2s}.site-footer__col a:hover{color:var(--champagne)}`,
    `    .site-footer__copy{font-size:.75rem;color:var(--muted)}.site-footer__nav ul{list-style:none;display:flex;gap:20px;flex-wrap:wrap}.site-footer__nav a{font-size:.75rem;color:var(--muted);transition:color .2s}.site-footer__nav a:hover{color:var(--champagne)}`,
    `    @media(max-width:900px){.site-nav__list{display:none}}`,
    `    @media(max-width:640px){.container{padding:0 16px}.hotel-card{padding:20px 16px}.hotel-card__score-label{width:56px}.hotel-card__score-value{width:48px;font-size:.72rem}.hotel-card__footer{gap:8px}.hotel-editorial__intro,.hotel-editorial__why,.hotel-editorial__pros-cons,.hotel-editorial__best-for,.hotel-editorial__nearby,.hotel-editorial__comparison,.hotel-editorial__faqs{padding:20px 16px}.ranking-summary{padding:20px 16px}.methodology{padding:24px 16px}.affiliate-cta{flex-direction:column;align-items:flex-start;padding:18px 16px}.affiliate-cta__disclosure{min-width:unset;width:100%}.site-footer{margin-top:32px;padding:24px 16px}}`,
    `  </style>`,
    ``,
    `  <!-- Renderer metadata (non-displayed) -->`,
    `  <meta name="generator" content="Mauritius Resort Finder Renderer v${RENDERER_VERSION}">`,
  ].filter(l => l !== null && l !== undefined);

  return `<head>\n${lines.join('\n')}\n</head>`;
}

/**
 * Generates the site <header> element.
 *
 * @param  {string} siteName
 * @param  {string} baseUrl
 * @returns {string}
 */
function generateSiteHeader(siteName, baseUrl) {
  return [
    `<header class="site-header" role="banner">`,
    `  <nav class="site-nav" aria-label="Site navigation">`,
    `    <a href="${esc(baseUrl)}" class="site-logo" rel="home">`,
    `      <div class="site-logo__mark" aria-hidden="true">M</div>`,
    `      ${esc(siteName)}`,
    `    </a>`,
    `    <ul class="site-nav__list">`,
    `      <li><a href="${esc(baseUrl)}/#rankings">Rankings</a></li>`,
    `      <li><a href="${esc(baseUrl)}/#travel-styles">By Style</a></li>`,
    `      <li><a href="${esc(baseUrl)}/#regions">By Region</a></li>`,
    `      <li><a href="${esc(baseUrl)}/#methodology">Methodology</a></li>`,
    `      <li><a href="${esc(baseUrl)}/contact/">Contact</a></li>`,
    `    </ul>`,
    `  </nav>`,
    `</header>`,
  ].join('\n');
}

/**
 * Generates the site <footer> element.
 *
 * @param  {string} siteName
 * @param  {string} baseUrl
 * @returns {string}
 */
function generateSiteFooter(siteName, baseUrl) {
  const year = new Date().getFullYear();
  const b = baseUrl;
  return [
    `<footer class="site-footer" role="contentinfo">`,
    `  <div class="site-footer__cols">`,
    `    <div class="site-footer__col">`,
    `      <p class="site-footer__col-heading">Hotel Rankings</p>`,
    `      <ul>`,
    `        <li><a href="${b}/best-luxury-hotels-mauritius/">Luxury Hotels</a></li>`,
    `        <li><a href="${b}/best-honeymoon-hotels-mauritius/">Honeymoon Hotels</a></li>`,
    `        <li><a href="${b}/best-family-hotels-mauritius/">Family Hotels</a></li>`,
    `        <li><a href="${b}/best-wellness-resorts-mauritius/">Wellness Resorts</a></li>`,
    `        <li><a href="${b}/best-value-luxury-hotels-mauritius/">Value Luxury</a></li>`,
    `      </ul>`,
    `    </div>`,
    `    <div class="site-footer__col">`,
    `      <p class="site-footer__col-heading">Guides</p>`,
    `      <ul>`,
    `        <li><a href="${b}/where-to-stay-in-mauritius/">Where to Stay</a></li>`,
    `        <li><a href="${b}/best-time-to-visit-mauritius/">Best Time to Visit</a></li>`,
    `        <li><a href="${b}/mauritius-travel-guide/">Travel Guide</a></li>`,
    `        <li><a href="${b}/mauritius-honeymoon-guide/">Honeymoon Guide</a></li>`,
    `        <li><a href="${b}/best-beach-resorts-mauritius/">Beach Resorts</a></li>`,
    `        <li><a href="${b}/grand-baie-mauritius/">Grand Baie</a></li>`,
    `        <li><a href="${b}/balaclava-mauritius-hotels/">Balaclava</a></li>`,
    `        <li><a href="${b}/belle-mare-mauritius/">Belle Mare</a></li>`,
    `        <li><a href="${b}/flic-en-flac-mauritius/">Flic en Flac</a></li>`,
    `        <li><a href="${b}/bel-ombre-mauritius/">Bel Ombre</a></li>`,
    `        <li><a href="${b}/cap-malheureux-mauritius/">Cap Malheureux</a></li>`,
    `        <li><a href="${b}/grand-gaube-mauritius/">Grand Gaube</a></li>`,
    `        <li><a href="${b}/mauritius-packing-list/">Packing List</a></li>`,
    `        <li><a href="${b}/things-to-do-in-mauritius/">Things to Do</a></li>`,
    `        <li><a href="${b}/best-beaches-in-mauritius/">Best Beaches</a></li>`,
    `        <li><a href="${b}/trou-deau-douce-mauritius/">Trou d'Eau Douce</a></li>`,
    `        <li><a href="${b}/mauritius-restaurants-dining-guide/">Restaurants & Dining</a></li>`,
    `        <li><a href="${b}/mauritius-budget-travel-guide/">Budget Travel Guide</a></li>`,
    `        <li><a href="${b}/mauritius-vs-maldives/">Mauritius vs Maldives</a></li>`,
    `        <li><a href="${b}/port-louis-mauritius-guide/">Port Louis Guide</a></li>`,
    `        <li><a href="${b}/mauritius-vs-seychelles/">Mauritius vs Seychelles</a></li>`,
    `        <li><a href="${b}/mauritius-visa-entry-guide/">Visa &amp; Entry Guide</a></li>`,
    `      </ul>`,
    `    </div>`,
    `    <div class="site-footer__col">`,
    `      <p class="site-footer__col-heading">Site</p>`,
    `      <ul>`,
    `        <li><a href="${b}/methodology/">Methodology</a></li>`,
    `        <li><a href="${b}/rankings/">All Rankings</a></li>`,
    `        <li><a href="${b}/contact/">Contact</a></li>`,
    `      </ul>`,
    `    </div>`,
    `  </div>`,
    `  <p class="site-footer__copy">`,
    `    &copy; ${year} ${esc(siteName)}. All rankings are independently produced. This site contains affiliate links &mdash; <a href="${b}/methodology/" style="color:inherit;text-decoration:underline">see affiliate disclosure</a>.`,
    `  </p>`,
    `</footer>`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// BIG DODO WIDGET INJECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the Big Dodo chatbot widget injection block.
 * Emits a config <script>, a <link> for the widget CSS, and a deferred <script>
 * for the widget JS. Both asset files live in /assets/{css,js}/ and are copied
 * to dist/ by site_builder.js automatically.
 *
 * @param   {Object} meta  — from extractPageMeta()
 * @returns {string} HTML snippet (safe to append before </body>)
 */
function _bigDodoWidget(meta) {
  const pageType = meta && meta.pageType ? String(meta.pageType) : 'ranking';
  const slug     = meta && meta.slug     ? String(meta.slug)     : '';

  const config = JSON.stringify({
    apiUrl:      '/api/chat',
    pageContext: { pageType, slug },
  });

  return [
    `<!-- Big Dodo widget -->`,
    `<link rel="stylesheet" href="/assets/css/big_dodo_widget.css">`,
    `<script type="application/json" id="big-dodo-config">${config}</script>`,
    `<script src="/assets/js/big_dodo_widget.js" defer></script>`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a pageObject (AssemblyResult) before rendering.
 * Throws InvalidPageInputError on critical failures.
 *
 * @param  {*} pageObject
 */
function validatePageInput(pageObject) {
  if (!pageObject || typeof pageObject !== 'object' || Array.isArray(pageObject)) {
    throw new InvalidPageInputError('pageObject must be a plain object (AssemblyResult)');
  }
  if (!Array.isArray(pageObject.blocks)) {
    throw new InvalidPageInputError('pageObject.blocks must be an array');
  }
  if (pageObject.blocks.length === 0) {
    throw new InvalidPageInputError('pageObject.blocks must not be empty');
  }
}

/**
 * Renders a complete page from an AssemblyResult to an HTML string.
 *
 * @param  {Object}  pageObject  — AssemblyResult from block_assembler / page.json
 * @param  {Object}  [options]
 * @param  {string}  [options.baseUrl='https://mauritiusresortfinder.com']
 * @param  {string}  [options.siteName='Mauritius Resort Finder']
 * @param  {string}  [options.lang='en']
 * @returns {string} Full HTML document string
 * @throws {InvalidPageInputError}  if pageObject is invalid
 * @throws {UnsupportedBlockTypeError}  if a block type has no registered renderer
 * @throws {InvalidBlockPayloadError}  if a required payload field is missing
 */
function renderPage(pageObject, options = {}) {
  validatePageInput(pageObject);

  const baseUrl  = (options.baseUrl  || DEFAULT_BASE_URL).replace(/\/$/, '');
  const siteName = options.siteName  || DEFAULT_SITE_NAME;
  const lang     = options.lang      || DEFAULT_LANG;

  const meta          = extractPageMeta(pageObject, options);
  const schemaScripts = generateStructuredData(pageObject, meta, baseUrl);
  const head          = generateHead(meta, baseUrl, siteName, lang, schemaScripts);
  const siteHeader    = generateSiteHeader(siteName, baseUrl);
  const siteFooter    = generateSiteFooter(siteName, baseUrl);

  // Render all blocks in order (block order is preserved exactly as received)
  const renderedBlocks = pageObject.blocks.map((block, index) => {
    try {
      return `<!-- block:${block.block_type} position:${block.position || index + 1} -->\n` +
             renderBlock(block);
    } catch (err) {
      // Re-throw with block context
      if (err instanceof RendererError) throw err;
      throw new RendererError(
        `Failed to render block type "${block.block_type}" at position ${block.position || index + 1}: ${err.message}`,
        { block_type: block.block_type, position: block.position || index + 1, cause: err },
      );
    }
  });

  const mainContent = renderedBlocks.join('\n\n');

  // Sticky CTA for hotel detail pages — floats at bottom when main CTA scrolls out of view
  const ctaBlock = (meta.pageType === 'hotel_detail' || meta.pageType === 'hotel')
    ? pageObject.blocks.find(b => b.block_type === 'affiliate_cta')
    : null;
  const stickyCta = (ctaBlock && ctaBlock.payload && ctaBlock.payload.booking_url)
    ? [
        `<div class="sticky-cta" id="sticky-cta" aria-hidden="true">`,
        `  <span class="sticky-cta__name">${esc(ctaBlock.payload.hotel_name || '')}</span>`,
        `  <a href="${esc(_safeUrl(ctaBlock.payload.booking_url))}"`,
        `     rel="noopener sponsored"`,
        `     class="sticky-cta__btn"`,
        `     aria-label="Check availability for ${esc(ctaBlock.payload.hotel_name || 'this hotel')} on Expedia">`,
        `    Check availability &rarr;`,
        `  </a>`,
        `</div>`,
        `<style>`,
        `.sticky-cta{position:fixed;bottom:0;left:0;right:0;z-index:150;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 28px;background:rgba(8,17,31,.97);backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);border-top:1px solid var(--border-gold);transform:translateY(105%);transition:transform .35s cubic-bezier(.4,0,.2,1);will-change:transform}`,
        `.sticky-cta.is-visible{transform:translateY(0)}`,
        `.sticky-cta__name{font-size:.88rem;font-weight:600;color:var(--champagne);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}`,
        `.sticky-cta__btn{flex-shrink:0;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-bright) 50%,var(--gold-dim) 100%);background-size:200% auto;color:var(--deep-navy);font-size:.8rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:10px 22px;border-radius:var(--radius-pill);white-space:nowrap;transition:background-position .3s,box-shadow .2s,transform .2s}.sticky-cta__btn:hover{background-position:right center;box-shadow:0 4px 20px rgba(201,168,76,.45);transform:translateY(-1px)}`,
        `@media(max-width:480px){.sticky-cta{padding:12px 16px;gap:10px}.sticky-cta__name{font-size:.78rem}.sticky-cta__btn{font-size:.72rem;padding:9px 16px}}`,
        `</style>`,
      ].join('\n')
    : '';

  // Inline scroll-reveal + score-bar animation (no external file dependency for generated pages)
  const inlineScript = `<script src="/assets/js/hotel-page.js" defer></script>`;

  return [
    `<!DOCTYPE html>`,
    `<html lang="${esc(lang)}">`,
    head,
    `<body>`,
    siteHeader,
    `<a href="#main-content" class="skip-link">Skip to main content</a>`,
    `<main id="main-content" role="main">`,
    mainContent,
    `</main>`,
    siteFooter,
    stickyCta,
    inlineScript,
    _bigDodoWidget(meta),
    `</body>`,
    `</html>`,
  ].join('\n');
}

/**
 * Renders a page and writes the result to a file.
 * Creates parent directories as needed.
 *
 * @param  {Object}  pageObject
 * @param  {string}  outputPath  — absolute or relative path for the output file
 * @param  {Object}  [options]   — same as renderPage()
 * @returns {string}             outputPath (resolved)
 */
function renderToFile(pageObject, outputPath, options = {}) {
  const html        = renderPage(pageObject, options);
  const resolved    = path.resolve(outputPath);
  const dir         = path.dirname(resolved);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolved, html, 'utf8');
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

function parseCLIArgs() {
  const args = process.argv.slice(2);
  const result = { in: null, out: null, baseUrl: DEFAULT_BASE_URL };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in'   && args[i + 1]) result.in      = args[++i];
    if (args[i] === '--out'  && args[i + 1]) result.out     = args[++i];
    if (args[i] === '--base' && args[i + 1]) result.baseUrl = args[++i];
  }
  return result;
}

function main() {
  const cli = parseCLIArgs();

  if (!cli.in || !cli.out) {
    process.stderr.write(
      'Usage: node static_page_renderer.js --in <page.json> --out <output.html> [--base <url>]\n'
    );
    process.exit(1);
  }

  let pageObject;
  try {
    const raw = fs.readFileSync(path.resolve(cli.in), 'utf8');
    pageObject = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[ERROR] Failed to read/parse input file: ${err.message}\n`);
    process.exit(1);
  }

  try {
    const outPath = renderToFile(pageObject, cli.out, { baseUrl: cli.baseUrl });
    const size    = fs.statSync(outPath).size;
    process.stdout.write(`✓ Rendered ${size.toLocaleString()} bytes → ${outPath}\n`);
  } catch (err) {
    process.stderr.write(`[ERROR] Rendering failed: ${err.message}\n`);
    if (err.context) process.stderr.write(`  Context: ${JSON.stringify(err.context)}\n`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Public API
  renderPage,
  renderToFile,
  renderBlock,
  registerBlockRenderer,
  getBlockRenderers,

  // Block renderers (exported for testing and extensibility)
  renderHero,
  renderRankingSummary,
  renderMethodology,
  renderHotelCard,
  renderAffiliateCTA,
  renderComparison,
  renderFAQ,
  renderDisclosure,
  renderRelatedContent,
  renderInternalLinks,
  renderHotelEditorial,

  // Helpers (exported for testing)
  esc,
  escJsonLd,
  _safeUrl,
  fmtScore,
  dimensionLabel,
  personaLabel,
  personaTagline,
  extractPageMeta,
  generateHead,
  generateStructuredData,
  generateSiteHeader,
  generateSiteFooter,
  validatePageInput,

  // Data helpers
  getPersonaFAQs,
  getRelatedGuides,

  // Error types
  RendererError,
  UnsupportedBlockTypeError,
  InvalidBlockPayloadError,
  InvalidPageInputError,

  // Constants
  RENDERER_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_SITE_NAME,
  DEFAULT_LANG,
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}
