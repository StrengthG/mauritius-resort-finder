#!/usr/bin/env node
/**
 * generate-rankings-page.js
 *
 * Generates pages/rankings.html from data/hotels.json.
 * Run this whenever the hotel dataset changes.
 *
 * Usage:
 *   node scripts/generate-rankings-page.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Data ─────────────────────────────────────────────────────────────────────

const hotels = require(path.join(ROOT, 'data', 'hotels.json'))
  .filter(h => h._status !== 'inactive');

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugify(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function photoPath(hotelId) {
  const webp = path.join(ROOT, 'assets', 'images', 'hotels', hotelId, 'photo_01.webp');
  const png  = path.join(ROOT, 'assets', 'images', 'hotels', hotelId, 'photo_01.png');
  if (fs.existsSync(webp)) return `/assets/images/hotels/${hotelId}/photo_01.webp`;
  if (fs.existsSync(png))  return `/assets/images/hotels/${hotelId}/photo_01.png`;
  return null;
}

// Score displayed = overall_rating (editorial 0-10 scale)
function displayScore(h) {
  return (h.overall_rating || 0).toFixed(1);
}

// Rank hotels: overall_rating desc, then hotel_name alpha
const ranked = [...hotels].sort((a, b) =>
  (b.overall_rating || 0) - (a.overall_rating || 0) ||
  a.hotel_name.localeCompare(b.hotel_name)
);

const totalHotels = ranked.length;

// ── Card HTML ─────────────────────────────────────────────────────────────────

function renderCard(hotel, rank) {
  const slug     = slugify(hotel.hotel_name);
  const affUrl   = hotel._affiliate_links[0].booking_url;
  const score    = displayScore(hotel);
  const region   = hotel.region || '';
  const initial  = (hotel.hotel_name || '?').charAt(0).toUpperCase();
  const hue      = (() => {
    let h = 0;
    for (let i = 0; i < hotel.hotel_id.length; i++) h = (h * 31 + hotel.hotel_id.charCodeAt(i)) & 0xffff;
    return 170 + (h % 60);
  })();

  const cover     = photoPath(hotel.hotel_id);
  const photoHtml = cover
    ? `<img src="${esc(cover)}" alt="${esc(hotel.hotel_name)}" loading="lazy" decoding="async">`
    : `<div class="rk-card__nophoto" aria-hidden="true" style="--hi-hue:${hue}">
           <span>${esc(initial)}</span>
         </div>`;

  return `
      <!-- #${rank} ${hotel.hotel_name} -->
      <article class="rk-card">
        <div class="rk-card__photo">
          ${photoHtml}
          <div class="rk-card__rank">#${rank}</div>
          <div class="rk-card__score">${esc(score)} &#9733;</div>
        </div>
        <div class="rk-card__body">
          <p class="rk-card__name"><a href="/hotels/${esc(slug)}/">${esc(hotel.hotel_name)}</a></p>
          <p class="rk-card__region">&#128205; ${esc(region)}</p>
          <div class="rk-card__actions">
            <a href="${esc(affUrl)}" rel="noopener sponsored" class="rk-card__book">Book &rarr;</a>
            <a href="/hotels/${esc(slug)}/" class="rk-card__review">Full review</a>
          </div>
        </div>
      </article>`.trimStart();
}

// ── Page HTML ─────────────────────────────────────────────────────────────────

const cards = ranked.map((h, i) => renderCard(h, i + 1)).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>All Hotel Rankings — Mauritius Resort Finder</title>
  <meta name="description" content="All ${totalHotels} hotels in Mauritius ranked by independent score. Every resort rated across location, amenities, brand, and value. No paid placements." />
  <link rel="canonical" href="https://mauritiusresortfinder.com/rankings/" />
  <meta property="og:title"       content="All Hotel Rankings — Mauritius Resort Finder" />
  <meta property="og:description" content="All ${totalHotels} hotels in Mauritius ranked by independent score. Every resort rated across location, amenities, brand, and value. No paid placements." />
  <meta property="og:url"         content="https://mauritiusresortfinder.com/rankings/" />
  <meta property="og:type"        content="website" />
  <meta property="og:image"        content="https://mauritiusresortfinder.com/assets/images/ambient/ambient-01.webp" />
  <meta property="og:image:width"  content="1280" />
  <meta property="og:image:height" content="853" />
  <meta property="og:image:alt"    content="Mauritius Resort Finder" />
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:image"       content="https://mauritiusresortfinder.com/assets/images/ambient/ambient-01.webp" />
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-TN713HPVCQ"></script>
  <script src="/assets/js/analytics.js" defer></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/assets/css/global.css" />
  <style>
    body { padding-top: 72px; }

    /* ── Page hero ── */
    .page-hero { padding: 72px 0 56px; border-bottom: 1px solid var(--border); }
    .page-hero__eyebrow {
      display: inline-block; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.15em;
      text-transform: uppercase; color: var(--gold); background: var(--gold-glow);
      border: 1px solid var(--border-gold); border-radius: var(--radius-pill);
      padding: 5px 14px; margin-bottom: 18px;
    }

    /* ── Card grid ── */
    .rk-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 24px;
      margin-top: 40px;
    }
    @media (max-width: 1100px) { .rk-grid { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 720px)  { .rk-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; } }
    @media (max-width: 420px)  { .rk-grid { grid-template-columns: 1fr; } }

    /* ── Card ── */
    .rk-card {
      border-radius: 14px;
      overflow: hidden;
      background: var(--navy-card);
      border: 1px solid var(--border);
      transition: transform 0.28s var(--ease-out), box-shadow 0.28s, border-color 0.28s;
      position: relative;
    }
    .rk-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 32px rgba(0,0,0,0.45);
      border-color: var(--border-gold);
    }

    /* ── Photo area ── */
    .rk-card__photo {
      position: relative;
      padding-top: 66%;
      overflow: hidden;
      background: #0c1a28;
    }
    .rk-card__photo img {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover; display: block;
      transition: transform 0.5s var(--ease-out);
    }
    .rk-card:hover .rk-card__photo img { transform: scale(1.06); }

    /* ── No-photo gradient (hotels without images) ── */
    .rk-card__nophoto {
      position: absolute; inset: 0;
      background: linear-gradient(
        155deg,
        hsl(var(--hi-hue, 210), 42%, 11%) 0%,
        hsl(var(--hi-hue, 210), 58%, 17%) 45%,
        hsl(var(--hi-hue, 210), 35%,  9%) 100%
      );
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .rk-card__nophoto::before {
      content: '';
      position: absolute; inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    .rk-card__nophoto span {
      position: relative;
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 5rem; font-weight: 800;
      color: rgba(201, 168, 76, 0.14);
      letter-spacing: -0.04em;
      line-height: 1;
      user-select: none;
    }

    /* ── Rank + score overlays ── */
    .rk-card__rank {
      position: absolute; top: 11px; left: 11px; z-index: 2;
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.15rem; font-weight: 800; color: #fff; line-height: 1;
      background: rgba(8,15,35,0.72); border-radius: 7px; padding: 4px 10px;
      backdrop-filter: blur(4px);
    }
    .rk-card__score {
      position: absolute; top: 11px; right: 11px; z-index: 2;
      background: rgba(8,15,35,0.82); border: 1px solid var(--border-gold);
      color: var(--gold); font-size: 0.78rem; font-weight: 700;
      padding: 4px 10px; border-radius: 6px; backdrop-filter: blur(4px);
      letter-spacing: 0.02em;
    }

    /* ── Card body ── */
    .rk-card__body { padding: 15px 16px 17px; }
    .rk-card__name {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1rem; font-weight: 700; color: var(--champagne);
      margin: 0 0 3px; line-height: 1.25;
    }
    .rk-card__name a { color: inherit; text-decoration: none; transition: color 0.15s; }
    .rk-card__name a:hover { color: var(--gold); }
    .rk-card__region { font-size: 0.72rem; color: var(--muted); margin: 0 0 12px; }
    .rk-card__actions { display: flex; gap: 7px; flex-wrap: wrap; }
    .rk-card__book {
      font-size: 0.73rem; font-weight: 700; color: var(--deep-navy);
      background: var(--gold); padding: 5px 13px; border-radius: var(--radius-pill);
      text-decoration: none; white-space: nowrap; transition: opacity 0.15s;
    }
    .rk-card__book:hover { opacity: 0.85; }
    .rk-card__review {
      font-size: 0.71rem; font-weight: 600; color: var(--gold);
      border: 1px solid var(--border-gold); padding: 4px 11px;
      border-radius: var(--radius-pill); text-decoration: none; white-space: nowrap;
      background: var(--gold-glow); transition: background 0.15s;
    }
    .rk-card__review:hover { background: rgba(201,168,76,0.12); }

    /* ── Affiliate disclosure ── */
    .rk-disclosure {
      font-size: 0.68rem; color: var(--muted); text-align: center;
      margin-top: 48px; line-height: 1.6;
    }
    .rk-disclosure a { color: var(--gold); text-decoration: underline; }
  </style>
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>
<nav class="nav" role="navigation" aria-label="Main navigation">
  <div class="nav__inner">
    <a href="/" class="nav__logo" aria-label="Mauritius Resort Finder — home">
      <div class="nav__logo-mark" aria-hidden="true">M</div>
      Mauritius Resort Finder
    </a>
    <ul class="nav__links" role="list">
      <li><a href="/best-resort-mauritius/">Best Resorts</a></li>
      <li><a href="/rankings/" aria-current="page">Rankings</a></li>
      <li><a href="/luxury/">Luxury</a></li>
      <li><a href="/honeymoon/">Honeymoon</a></li>
      <li><a href="/family/">Family</a></li>
    </ul>
  </div>
</nav>

<main id="main-content">
  <div class="page-hero">
    <div class="container">
      <div class="page-hero__eyebrow">All ${totalHotels} Hotels &middot; Independently Scored</div>
      <h1>Mauritius Hotel Rankings</h1>
      <p style="color:var(--muted);max-width:560px;margin-top:14px;font-size:1rem;line-height:1.75;">
        Every hotel ranked by composite score across location, amenities, brand credibility, and value.
        Scores are data-driven. No hotel has paid for placement.
      </p>
    </div>
  </div>

  <div class="container" style="padding-top:48px;padding-bottom:80px;">
    <div class="rk-grid" role="list">
${cards}
    </div>

    <p class="rk-disclosure">
      Rankings are independently produced using a multi-dimensional scoring model.
      Some cards contain <a href="/methodology/">affiliate links</a> — commissions do not influence rankings.
    </p>
  </div>
</main>

<footer class="site-footer" role="contentinfo">
  <div class="container">
    <div class="footer__grid">
      <div class="footer__brand">
        <a href="/" class="footer__logo">Mauritius Resort Finder</a>
        <p class="footer__tagline">Independent hotel rankings for Mauritius. No paid placements.</p>
      </div>
      <nav class="footer__nav" aria-label="Footer navigation">
        <ul role="list">
          <li><a href="/rankings/">All Rankings</a></li>
          <li><a href="/luxury/">Luxury Hotels</a></li>
          <li><a href="/honeymoon/">Honeymoon Resorts</a></li>
          <li><a href="/family/">Family Resorts</a></li>
          <li><a href="/wellness/">Wellness Retreats</a></li>
          <li><a href="/methodology/">Our Methodology</a></li>
        </ul>
      </nav>
    </div>
    <p class="footer__legal">
      &copy; ${new Date().getFullYear()} Mauritius Resort Finder. All rankings are independently produced.
      This site contains <a href="/methodology/">affiliate links</a> &mdash; see affiliate disclosure.
    </p>
  </div>
</footer>
</body>
</html>
`;

// ── Write ─────────────────────────────────────────────────────────────────────

const dest = path.join(ROOT, 'pages', 'rankings.html');
fs.writeFileSync(dest, html, 'utf8');
console.log(`✓ Generated pages/rankings.html — ${totalHotels} hotels, ${ranked.filter(h=>photoPath(h.hotel_id)).length} with photos`);
