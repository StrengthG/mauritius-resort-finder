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
  ];
  return all.filter(g => g.persona !== persona);
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
  const { title, persona, target_keyword, page_type } = block.payload;

  return [
    `<section class="hero hero--${esc(page_type || 'ranking')}" aria-labelledby="hero-heading">`,
    `  <div class="hero__inner">`,
    `    <h1 id="hero-heading" class="hero__title">${esc(title)}</h1>`,
    `    <p class="hero__persona">For <strong>${esc(personaLabel(persona))}</strong> travelers</p>`,
    `    <p class="hero__tagline">${esc(personaTagline(persona))}</p>`,
    /* target_keyword is exposed via <head> meta only — not repeated in body HTML */
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

  const items = (hotels || []).map(h =>
    `    <li class="ranking-summary__item">` +
    `<span class="ranking-summary__rank">#${esc(h.rank)}</span>` +
    `<a href="#hotel-${esc(h.hotel_id)}" class="ranking-summary__name">${esc(h.name)}</a>` +
    `</li>`
  ).join('\n');

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
    `    <a href="/methodology" class="methodology__link">Read our full methodology →</a>`,
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
    `     rel="nofollow sponsored"`,
    `     class="affiliate-cta__link"`,
    `     aria-label="Check prices for ${esc(hotel_name)} on Expedia">`,
    `    Check prices →`,
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
  const { persona } = block.payload;

  const guides  = getRelatedGuides(persona);
  const linkItems = guides.map(g =>
    `    <li class="related-content__item">` +
    `<a href="/${esc(g.slug)}" class="related-content__link">${esc(g.label)}</a>` +
    `</li>`
  ).join('\n');

  return [
    `<nav class="related-content" aria-label="Related travel guides">`,
    `  <h2 class="related-content__heading">Related Guides</h2>`,
    `  <ul class="related-content__list">`,
    linkItems,
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

  // Build a description: use the top hotel's explanation_summary if available,
  // otherwise fall back to a template string.
  let description = '';
  const firstCard = blocks.find(b => b.block_type === 'hotel_card');
  if (firstCard && firstCard.payload && firstCard.payload.explanation) {
    const raw = firstCard.payload.explanation.explanation_summary || '';
    description = raw.length > 160
      ? raw.slice(0, 157) + '...'
      : raw;
  }
  if (!description) {
    description = `${title}. ${personaTagline(persona)} Independently scored and ranked.`;
    if (description.length > 160) description = description.slice(0, 157) + '...';
  }

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
  const canonUrl  = `${baseUrl}/${meta.slug}`.replace(/\/+$/, '');

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
  const canonUrl = `${baseUrl}/${meta.slug}`.replace(/\/+$/, '');

  const lines = [
    `  <meta charset="UTF-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0">`,
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
    `  <!-- Stylesheet -->`,
    `  <style>`,
    `    /* ── Reset ─────────────────────────────────── */`,
    `    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}`,
    `    html{scroll-behavior:smooth;font-size:16px}`,
    `    body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}`,
    `    /* ── Tokens ─────────────────────────────────── */`,
    `    :root{`,
    `      --gold:#c9a84c;--gold-glow:rgba(201,168,76,.12);--bg:#0d1117;`,
    `      --bg-card:#161b22;--bg-raised:#1c2128;`,
    `      --border:rgba(255,255,255,.08);--border-gold:rgba(201,168,76,.3);`,
    `      --text:#e6edf3;--muted:#8b949e;--radius:12px;--radius-sm:8px`,
    `    }`,
    `    /* ── Type ───────────────────────────────────── */`,
    `    h1,h2,h3,h4{font-weight:700;letter-spacing:-.02em;line-height:1.2;color:#e6edf3}`,
    `    h1{font-size:clamp(1.8rem,4vw,2.8rem)}`,
    `    h2{font-size:clamp(1.3rem,2.5vw,2rem)}`,
    `    h3{font-size:1.1rem}`,
    `    p{color:#8b949e}`,
    `    a{color:inherit;text-decoration:none}`,
    `    strong{color:#e6edf3;font-weight:600}`,
    `    /* ── Layout ─────────────────────────────────── */`,
    `    .container{max-width:1120px;margin:0 auto;padding:0 24px}`,
    `    main{padding-bottom:64px}`,
    `    /* ── Skip link ──────────────────────────────── */`,
    `    .skip-link{position:absolute;left:-9999px;top:8px;background:var(--gold);color:#0d1117;padding:8px 16px;border-radius:6px;font-weight:700;z-index:999}`,
    `    .skip-link:focus{left:8px}`,
    `    /* ── Site header / nav ──────────────────────── */`,
    `    .site-header{position:sticky;top:0;z-index:100;background:rgba(13,17,23,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}`,
    `    .site-nav{display:flex;align-items:center;justify-content:space-between;height:60px;max-width:1120px;margin:0 auto;padding:0 24px}`,
    `    .site-logo{font-weight:800;font-size:.95rem;color:#e6edf3;letter-spacing:-.01em}`,
    `    .site-nav__list{display:flex;gap:24px;list-style:none}`,
    `    .site-nav__list a{font-size:.85rem;color:#8b949e;transition:color .15s}`,
    `    .site-nav__list a:hover{color:#e6edf3}`,
    `    /* ── Hero block ─────────────────────────────── */`,
    `    .hero{padding:56px 24px 48px;max-width:1120px;margin:0 auto}`,
    `    .hero__title{margin-bottom:12px}`,
    `    .hero__persona{font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin-bottom:8px}`,
    `    .hero__tagline{font-size:1rem;color:#8b949e;max-width:580px}`,
    `    /* ── Ranking summary ────────────────────────── */`,
    `    .ranking-summary{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 32px;margin:24px auto;max-width:1120px}`,
    `    .ranking-summary__heading{font-size:1rem;margin-bottom:16px;color:#8b949e;font-weight:600;text-transform:uppercase;letter-spacing:.06em}`,
    `    .ranking-summary__list{list-style:none;display:flex;flex-direction:column;gap:10px;counter-reset:rank}`,
    `    .ranking-summary__item{display:flex;align-items:center;gap:12px;counter-increment:rank}`,
    `    .ranking-summary__rank{font-size:.8rem;font-weight:800;color:var(--gold);width:28px;flex-shrink:0}`,
    `    .ranking-summary__name{font-size:.9rem;color:#e6edf3;transition:color .15s}`,
    `    .ranking-summary__name:hover{color:var(--gold)}`,
    `    /* ── Methodology block ──────────────────────── */`,
    `    .methodology{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:32px;margin:24px auto;max-width:1120px}`,
    `    .methodology__heading{margin-bottom:12px}`,
    `    .methodology__intro{font-size:.9rem;margin-bottom:18px;max-width:640px}`,
    `    .methodology__dimensions{list-style:none;display:flex;flex-wrap:wrap;gap:10px}`,
    `    .methodology__dimension{background:var(--bg-raised);border:1px solid var(--border-gold);border-radius:100px;padding:5px 14px;font-size:.78rem;font-weight:600;color:var(--gold)}`,
    `    .methodology__link-note{margin-top:18px;font-size:.85rem}`,
    `    .methodology__link{color:var(--gold);font-weight:600}`,
    `    .methodology__link:hover{text-decoration:underline}`,
    `    /* ── Hotel card ─────────────────────────────── */`,
    `    .hotel-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 32px;margin:16px auto;max-width:1120px;position:relative;overflow:hidden;transition:border-color .15s}`,
    `    .hotel-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:background .15s}`,
    `    .hotel-card:hover{border-color:rgba(255,255,255,.14)}`,
    `    .hotel-card:hover::before{background:var(--gold)}`,
    `    .hotel-card__header{margin-bottom:16px}`,
    `    .hotel-card__rank-badge{display:inline-block;font-size:.75rem;font-weight:800;color:var(--gold);background:var(--gold-glow);border:1px solid var(--border-gold);border-radius:100px;padding:3px 12px;margin-bottom:8px}`,
    `    .hotel-card__name{font-size:1.3rem;margin-bottom:6px}`,
    `    .hotel-card__meta{font-size:.82rem;color:#8b949e}`,
    `    .hotel-card__tier{font-weight:600;color:#e6edf3}`,
    `    .hotel-card__region::before{content:'📍';margin-right:4px;font-size:.7rem}`,
    `    .hotel-card__stars{color:var(--gold)}`,
    `    /* ── Score bars ─────────────────────────────── */`,
    `    .hotel-card__scores{display:flex;flex-direction:column;gap:10px;margin-bottom:18px;padding:18px;background:var(--bg-raised);border-radius:var(--radius-sm)}`,
    `    .hotel-card__score-row{display:flex;align-items:center;gap:12px}`,
    `    .hotel-card__score-label{font-size:.75rem;color:#8b949e;width:80px;flex-shrink:0;text-transform:uppercase;letter-spacing:.04em}`,
    `    .hotel-card__score-bar{flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden}`,
    `    .hotel-card__score-fill{height:100%;border-radius:3px;background:var(--gold)}`,
    `    .hotel-card__score-value{font-size:.78rem;font-weight:700;color:var(--gold);width:56px;text-align:right;flex-shrink:0}`,
    `    /* ── Amenities ──────────────────────────────── */`,
    `    .hotel-card__amenities{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}`,
    `    .hotel-card__amenity{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:100px;padding:3px 12px;font-size:.75rem;color:#8b949e}`,
    `    /* ── Explanation ────────────────────────────── */`,
    `    .hotel-card__explanation{padding-top:18px;border-top:1px solid var(--border)}`,
    `    .hotel-card__summary{font-size:.9rem;line-height:1.7;margin-bottom:14px}`,
    `    .hotel-card__strengths-heading,.hotel-card__weakness-heading,.hotel-card__fit-heading{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;margin-bottom:10px}`,
    `    .hotel-card__strengths-list{list-style:none;display:flex;flex-direction:column;gap:8px;margin-bottom:14px}`,
    `    .hotel-card__strength{font-size:.88rem;padding-left:14px;position:relative;color:#8b949e}`,
    `    .hotel-card__strength::before{content:'✓';position:absolute;left:0;color:var(--gold);font-weight:700}`,
    `    .hotel-card__weakness-text{font-size:.85rem;color:#8b949e;padding-left:14px;position:relative}`,
    `    .hotel-card__weakness-text::before{content:'→';position:absolute;left:0;color:#8b949e}`,
    `    .hotel-card__fit-positive,.hotel-card__fit-caution{font-size:.85rem;margin-bottom:8px}`,
    `    .hotel-card__confidence{font-size:.78rem;color:#8b949e;margin-top:12px}`,
    `    /* ── Affiliate CTA ──────────────────────────── */`,
    `    .affiliate-cta{margin:20px auto;max-width:1120px;padding:20px 24px;background:var(--bg-card);border:1px solid var(--border-gold);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}`,
    `    .affiliate-cta__link{background:var(--gold);color:#0d1117;font-size:.9rem;font-weight:700;padding:10px 22px;border-radius:var(--radius-sm);transition:opacity .15s;white-space:nowrap}`,
    `    .affiliate-cta__link:hover{opacity:.88}`,
    `    .affiliate-cta__disclosure{font-size:.72rem;color:#8b949e;flex:1;min-width:200px}`,
    `    .affiliate-cta--premium{border-color:var(--gold)}`,
    `    /* ── Comparison ─────────────────────────────── */`,
    `    .comparison{margin:24px auto;max-width:1120px}`,
    `    .comparison__heading{font-size:1.2rem;margin-bottom:18px}`,
    `    .comparison__table-wrapper{overflow-x:auto}`,
    `    .comparison__table{width:100%;border-collapse:collapse}`,
    `    .comparison__table th,.comparison__table td{padding:12px 16px;border:1px solid var(--border);font-size:.85rem;text-align:left}`,
    `    .comparison__table thead th{background:var(--bg-card);font-weight:700;color:#e6edf3}`,
    `    .comparison__table tbody tr:nth-child(even){background:var(--bg-card)}`,
    `    .comparison__dim-label{font-weight:600;color:#8b949e}`,
    `    .comparison__corner{background:var(--bg);border:1px solid var(--border)}`,
    `    /* ── FAQ ────────────────────────────────────── */`,
    `    .faq{margin:24px auto;max-width:1120px}`,
    `    .faq__heading{margin-bottom:24px}`,
    `    .faq__item{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:22px 24px;margin-bottom:12px}`,
    `    .faq__question{font-size:.95rem;margin-bottom:10px}`,
    `    .faq__answer p{font-size:.88rem;line-height:1.65}`,
    `    /* ── Disclosure ─────────────────────────────── */`,
    `    .disclosure{margin:24px auto;max-width:1120px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:24px}`,
    `    .disclosure__heading{font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;margin-bottom:10px}`,
    `    .disclosure__text{font-size:.82rem;line-height:1.6;margin-bottom:10px}`,
    `    .disclosure__methodology-link{font-size:.82rem}`,
    `    .disclosure__link{color:var(--gold);font-weight:600}`,
    `    .disclosure__link:hover{text-decoration:underline}`,
    `    /* ── Related content ────────────────────────── */`,
    `    .related-content{margin:24px auto;max-width:1120px}`,
    `    .related-content__heading{font-size:1rem;margin-bottom:16px}`,
    `    .related-content__list{list-style:none;display:flex;flex-wrap:wrap;gap:10px}`,
    `    .related-content__link{display:inline-block;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 16px;font-size:.83rem;color:#8b949e;transition:all .15s}`,
    `    .related-content__link:hover{border-color:rgba(255,255,255,.18);color:#e6edf3}`,
    `    /* ── Internal links ─────────────────────────── */`,
    `    .internal-links{margin:24px auto;max-width:1120px}`,
    `    .internal-links__heading{font-size:.9rem;color:#8b949e;margin-bottom:12px}`,
    `    .internal-links__list{list-style:none;display:flex;flex-wrap:wrap;gap:8px}`,
    `    .internal-links__link{font-size:.82rem;color:var(--gold);transition:text-decoration .15s}`,
    `    .internal-links__link:hover{text-decoration:underline}`,
    `    /* ── Site footer ────────────────────────────── */`,
    `    .site-footer{border-top:1px solid var(--border);padding:32px 24px;max-width:1120px;margin:48px auto 0;display:flex;flex-direction:column;gap:14px}`,
    `    .site-footer__copy{font-size:.78rem;color:#8b949e}`,
    `    .site-footer__nav ul{list-style:none;display:flex;gap:20px;flex-wrap:wrap}`,
    `    .site-footer__nav a{font-size:.78rem;color:#8b949e;transition:color .15s}`,
    `    .site-footer__nav a:hover{color:#e6edf3}`,
    `    /* ── Responsive ─────────────────────────────── */`,
    `    @media(max-width:640px){`,
    `      .hotel-card{padding:20px 18px}`,
    `      .hotel-card__score-label{width:60px}`,
    `      .affiliate-cta{flex-direction:column;align-items:flex-start}`,
    `      .site-footer{margin-top:32px}`,
    `    }`,
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
    `    <a href="${esc(baseUrl)}" class="site-logo" rel="home">${esc(siteName)}</a>`,
    `    <ul class="site-nav__list">`,
    `      <li><a href="${esc(baseUrl)}/hotels/mauritius">Mauritius</a></li>`,
    `      <li><a href="${esc(baseUrl)}/methodology">Methodology</a></li>`,
    `      <li><a href="${esc(baseUrl)}/about">About</a></li>`,
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
  return [
    `<footer class="site-footer" role="contentinfo">`,
    `  <p class="site-footer__copy">`,
    `    &copy; ${year} ${esc(siteName)}. All rankings are independently produced.`,
    `  </p>`,
    `  <nav class="site-footer__nav" aria-label="Footer navigation">`,
    `    <ul>`,
    `      <li><a href="${esc(baseUrl)}/methodology">Methodology</a></li>`,
    `      <li><a href="${esc(baseUrl)}/privacy">Privacy Policy</a></li>`,
    `      <li><a href="${esc(baseUrl)}/disclosure">Affiliate Disclosure</a></li>`,
    `    </ul>`,
    `  </nav>`,
    `</footer>`,
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
