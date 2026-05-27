#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '..', 'pages');

// ─── Standard template pieces ────────────────────────────────────────────────

const STANDARD_CSS = `  <style>
    body { background: #0a0f1e; color: #e8e0d0; font-family: 'Georgia', serif; margin: 0; }
    .page-hero { background: linear-gradient(135deg, #0d1728 0%, #1a2540 100%); padding: 80px 24px 60px; text-align: center; }
    .page-hero__label { display: inline-block; background: rgba(201,168,76,0.15); color: #c9a84c; font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; padding: 6px 16px; border-radius: 20px; margin-bottom: 24px; font-family: 'Arial', sans-serif; }
    .page-hero h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); color: #fff; margin: 0 auto 20px; max-width: 820px; line-height: 1.25; }
    .page-hero__sub { font-size: 1.05rem; color: #b0a898; max-width: 620px; margin: 0 auto; line-height: 1.75; }
    .container { max-width: 860px; margin: 0 auto; padding: 0 24px; }
    .content-section { padding: 52px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
    .content-section:last-child { border-bottom: none; }
    h2 { font-size: 1.55rem; color: #e8dfc8; margin: 0 0 18px; }
    h3 { font-size: 1.15rem; color: #c9a84c; margin: 28px 0 10px; }
    p { line-height: 1.85; color: #ccc4b4; margin: 0 0 18px; }
    ul, ol { color: #ccc4b4; line-height: 1.85; padding-left: 22px; margin: 0 0 18px; }
    li { margin-bottom: 6px; }
    strong { color: #e8dfc8; }
    a { color: #c9a84c; }
    .breadcrumb { font-size: 0.82rem; color: #7a7260; font-family: 'Arial', sans-serif; padding: 18px 0 0; }
    .breadcrumb a { color: #9a8e78; text-decoration: none; }
    .breadcrumb a:hover { color: #c9a84c; }
    .data-table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 0.92rem; }
    .data-table th { background: rgba(201,168,76,0.12); color: #c9a84c; text-align: left; padding: 12px 14px; font-family: 'Arial', sans-serif; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .data-table td { padding: 12px 14px; color: #ccc4b4; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: top; }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table tr:hover td { background: rgba(255,255,255,0.03); }
    td strong { color: #e8dfc8; }
    .tick { color: #7bbf7b; font-weight: bold; }
    .cross { color: #bf7b7b; font-weight: bold; }
    .req-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 24px 0; }
    .req-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; }
    .req-card__icon { font-size: 1.4rem; margin-bottom: 10px; }
    .req-card__title { font-size: 0.95rem; color: #e8dfc8; font-weight: bold; margin-bottom: 8px; font-family: 'Arial', sans-serif; }
    .req-card p { font-size: 0.88rem; color: #9a8e78; margin: 0; line-height: 1.6; }
    .hotel-cta { background: rgba(255,255,255,0.04); border: 1px solid rgba(201,168,76,0.2); border-radius: 12px; padding: 28px; margin: 24px 0; }
    .hotel-cta__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .hotel-cta__name { font-size: 1.2rem; color: #e8dfc8; font-weight: bold; margin: 0; }
    .hotel-cta__score { background: rgba(201,168,76,0.15); color: #c9a84c; font-size: 0.9rem; font-weight: bold; padding: 4px 12px; border-radius: 20px; white-space: nowrap; }
    .hotel-cta__meta { font-size: 0.88rem; color: #9a8e78; font-family: 'Arial', sans-serif; margin-bottom: 12px; }
    .hotel-cta__desc { color: #bbb3a3; font-size: 0.97rem; line-height: 1.7; margin-bottom: 18px; }
    .hotel-cta__actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .btn-primary { background: #c9a84c; color: #0a0f1e; font-weight: bold; padding: 11px 22px; border-radius: 6px; text-decoration: none; font-size: 0.92rem; font-family: 'Arial', sans-serif; display: inline-block; }
    .btn-primary:hover { background: #e0bc5a; }
    .btn-review { color: #c9a84c; border: 1px solid rgba(201,168,76,0.4); padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 0.9rem; font-family: 'Arial', sans-serif; display: inline-block; }
    .btn-review:hover { border-color: #c9a84c; }
    .hotel-cta__disclosure { font-size: 0.75rem; color: #6a6456; margin: 10px 0 0; font-family: 'Arial', sans-serif; }
    .hotel-cta__disclosure a { color: #7a7260; }
    .info-box { background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.2); border-radius: 8px; padding: 16px 20px; margin: 24px 0; font-size: 0.9rem; color: #9a8e78; font-family: 'Arial', sans-serif; }
    .info-box a { color: #c9a84c; }
    .answer-banner { background: rgba(123,191,123,0.08); border: 1px solid rgba(123,191,123,0.3); border-radius: 12px; padding: 24px 28px; margin: 28px 0; }
    .answer-banner__title { font-size: 1.05rem; color: #7bbf7b; font-family: 'Arial', sans-serif; font-weight: bold; margin-bottom: 10px; }
    .faq-item { border-bottom: 1px solid rgba(255,255,255,0.07); padding: 22px 0; }
    .faq-item:last-child { border-bottom: none; }
    .faq-item h3 { color: #e8dfc8; font-size: 1.05rem; margin: 0 0 10px; }
    .faq-item p { margin: 0; font-size: 0.97rem; }
    .disclosure-banner { background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.2); border-radius: 8px; padding: 14px 18px; margin: 32px 0; font-size: 0.85rem; color: #9a8e78; font-family: 'Arial', sans-serif; }
    .disclosure-banner a { color: #c9a84c; }
    .related-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin: 24px 0; }
    .related-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 18px; text-decoration: none; display: block; transition: border-color 0.2s; }
    .related-card:hover { border-color: rgba(201,168,76,0.4); }
    .related-card__label { font-size: 0.82rem; color: #c9a84c; font-family: 'Arial', sans-serif; margin-bottom: 6px; }
    .related-card__title { color: #e8dfc8; font-size: 1rem; }
    nav.site-nav { background: rgba(10,15,30,0.95); padding: 0 24px; display: flex; align-items: center; justify-content: space-between; height: 56px; border-bottom: 1px solid rgba(255,255,255,0.07); position: sticky; top: 0; z-index: 100; }
    nav.site-nav a { color: #b0a898; text-decoration: none; font-size: 0.88rem; font-family: 'Arial', sans-serif; }
    nav.site-nav .nav__logo { color: #e8dfc8; font-weight: bold; font-size: 1rem; }
    nav.site-nav .nav__cta { background: #c9a84c; color: #0a0f1e !important; padding: 7px 16px; border-radius: 5px; font-weight: bold; }
    footer { background: #060c1a; border-top: 1px solid rgba(255,255,255,0.07); padding: 40px 24px; text-align: center; color: #6a6456; font-size: 0.82rem; font-family: 'Arial', sans-serif; }
    footer a { color: #7a7260; text-decoration: none; }
    /* ── Older page component styles ── */
    .btn-cta { display: inline-block; background: #c9a84c; color: #0a0f1e; font-weight: bold; padding: 11px 22px; border-radius: 6px; text-decoration: none; font-size: 0.92rem; font-family: 'Arial', sans-serif; }
    .btn-cta:hover { background: #e0bc5a; }
    .cta-inline { margin: 20px 0 4px; }
    .affiliate-note { font-size: 0.75rem; color: #6a6456; font-family: 'Arial', sans-serif; margin: 0 0 20px; }
    .affiliate-note a { color: #7a7260; }
    .guide-main, .guide-article { max-width: 860px; margin: 0 auto; }
    .guide-toc { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 18px 22px; margin: 28px 0; }
    .guide-toc strong { color: #e8dfc8; font-family: 'Arial', sans-serif; font-size: 0.85rem; display: block; margin-bottom: 10px; }
    .guide-toc ul { margin: 0; padding-left: 18px; }
    .guide-toc ul li { margin-bottom: 4px; }
    .guide-toc a { color: #c9a84c; text-decoration: none; font-size: 0.88rem; }
    .zone-header { background: rgba(201,168,76,0.06); border-left: 3px solid #c9a84c; border-radius: 0 8px 8px 0; padding: 16px 20px; margin: 32px 0 18px; }
    .zone-header__label { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #c9a84c; font-family: 'Arial', sans-serif; margin-bottom: 4px; }
    .zone-header__title { font-size: 1.3rem; font-weight: 700; color: #e8dfc8; margin: 0 0 4px; }
    .zone-header__tag { font-size: 0.82rem; color: #9a8e78; margin: 0; }
    .hotel-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 24px; margin: 20px 0; transition: border-color 0.2s; }
    .hotel-card:hover { border-color: rgba(201,168,76,0.3); }
    .hotel-card__name { font-size: 1.1rem; font-weight: bold; color: #e8dfc8; margin: 0 0 4px; }
    .hotel-card__region { font-size: 0.8rem; color: #9a8e78; margin-bottom: 12px; font-family: 'Arial', sans-serif; }
    .hotel-card__scores { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
    .hotel-card__score { text-align: center; }
    .hotel-card__score-val { font-size: 1.15rem; font-weight: bold; color: #c9a84c; line-height: 1; }
    .hotel-card__score-lbl { font-size: 0.62rem; color: #9a8e78; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
    .hotel-card__desc { font-size: 0.9rem; color: #bbb3a3; line-height: 1.7; margin-bottom: 14px; }
    .hotel-card__footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    .hotel-card__price { font-size: 0.82rem; color: #9a8e78; }
    .hotel-card__price strong { color: #e8dfc8; font-size: 0.98rem; }
    .pick-table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 0.9rem; }
    .pick-table th { background: rgba(201,168,76,0.10); color: #c9a84c; text-align: left; padding: 10px 14px; font-family: 'Arial', sans-serif; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.07em; }
    .pick-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); color: #ccc4b4; vertical-align: top; }
    .pick-table tr:last-child td { border-bottom: none; }
    .score-chip { display: inline-block; background: rgba(201,168,76,0.15); color: #c9a84c; font-size: 0.78rem; font-weight: bold; border-radius: 20px; padding: 2px 10px; margin-left: 6px; vertical-align: middle; }
    .comparison-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 24px 0; }
    .comparison-col { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; }
    .comparison-col h4 { font-size: 0.88rem; font-weight: bold; color: #e8dfc8; margin-bottom: 8px; }
    .comparison-col ul { list-style: none; padding: 0; margin: 0; }
    .comparison-col li { font-size: 0.82rem; color: #9a8e78; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .comparison-col li:last-child { border-bottom: none; }
    .comparison-col li::before { content: "→ "; color: #c9a84c; }
    .persona-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; margin: 24px 0; }
    .persona-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; }
    .persona-card__label { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #c9a84c; margin-bottom: 8px; font-family: 'Arial', sans-serif; }
    .persona-card__title { font-size: 1.1rem; font-weight: bold; color: #e8dfc8; margin-bottom: 10px; }
    .persona-card__desc { font-size: 0.87rem; line-height: 1.75; color: #9a8e78; margin-bottom: 14px; }
    .persona-card__winner { background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.2); border-radius: 8px; padding: 14px 16px; margin: 14px 0 10px; }
    .persona-card__winner-label { font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #c9a84c; font-family: 'Arial', sans-serif; margin-bottom: 4px; }
    .persona-card__winner-name { font-size: 0.9rem; font-weight: bold; color: #e8dfc8; }
    .persona-card__winner-why { font-size: 0.78rem; color: #9a8e78; margin-top: 3px; }
    .persona-card__runners { font-size: 0.78rem; color: #9a8e78; margin-top: 8px; }
    .guide-meta { font-size: 0.78rem; color: #7a7260; font-family: 'Arial', sans-serif; margin: 8px 0 0; }
    .static-page__header { display: none; }
    .related-guides, .related-content { display: none; }
    @media (max-width: 640px) { .comparison-row { grid-template-columns: 1fr; } .req-grid { grid-template-columns: 1fr; } }
  </style>`;

const STANDARD_NAV = `<nav class="site-nav" aria-label="Site navigation">
  <a href="/" class="nav__logo">Mauritius Resort Finder</a>
  <a href="/rankings/" class="nav__cta">View Rankings</a>
</nav>`;

const STANDARD_FOOTER = `<footer>
  <p>&copy; 2026 Mauritius Resort Finder &nbsp;&middot;&nbsp; <a href="/affiliate-disclosure/">Affiliate Disclosure</a> &nbsp;&middot;&nbsp; <a href="/methodology/">Methodology</a> &nbsp;&middot;&nbsp; <a href="/contact/">Contact</a></p>
  <p style="margin-top:8px;">Independent hotel reviews. No paid placements. No inflated scores.</p>
</footer>`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Extract content between first opening tag matching pattern and its closing tag
function extractTagContent(html, openRe, closeTag) {
  const m = html.match(openRe);
  if (!m) return null;
  const start = html.indexOf(m[0]) + m[0].length;
  const end = html.indexOf(closeTag, start);
  if (end === -1) return null;
  return { content: html.slice(start, end), outer: html.slice(html.indexOf(m[0]), end + closeTag.length) };
}

// ─── Page-specific extraction config ─────────────────────────────────────────

const PAGES = [
  {
    file: 'grand-gaube-mauritius.html',
    label: 'Regional Guide',
    breadcrumb: 'Grand Gaube Guide',
    // nav: site-nav (lines 110-121)
    // hero inside main: <header class="guide-header"> at line 131
    // main: <main class="guide-main">
  },
  {
    file: 'where-to-stay-in-mauritius.html',
    label: 'Area Guide',
    breadcrumb: 'Where to Stay in Mauritius',
    // nav: <nav class="nav"> at line 180-192
    // hero BEFORE main: <header class="guide-hero"> at line 194-211
    // main: <main id="main"> at line 213
  },
  {
    file: 'mauritius-all-inclusive-resorts.html',
    label: 'Planning Guide',
    breadcrumb: 'All-Inclusive Resorts Mauritius',
  },
  {
    file: 'mauritius-family-holiday-guide.html',
    label: 'Planning Guide',
    breadcrumb: 'Family Holiday Guide',
    // nav: inside <header class="site-header"> (lines 81-94)
    // hero inside main: <header class="static-page__header"> at line 110
  },
  {
    file: 'mauritius-luxury-travel-guide.html',
    label: 'Planning Guide',
    breadcrumb: 'Mauritius Luxury Travel Guide',
    // nav: inside <header class="site-header"> (lines 155-167)
    // hero inside main (has guide-hero__title h1 at line 175, no separate header)
  },
  {
    file: 'mauritius-packing-list.html',
    label: 'Planning Guide',
    breadcrumb: 'Mauritius Packing List',
    // nav: <nav class="nav"> at line 197-206
    // hero: <header class="hero"> at line 208-217 (BEFORE main)
    // main: <main class="container"> at line 219
  },
  {
    file: 'mauritius-restaurants-dining-guide.html',
    label: 'Dining Guide',
    breadcrumb: 'Restaurants &amp; Dining Guide',
    // nav: indented site-nav at 182-192
    // hero: <header class="hero"> at 194-201 (BEFORE main)
    // main: <main class="page-body"> at 203
  },
  {
    file: 'mauritius-wellness-retreat-guide.html',
    label: 'Planning Guide',
    breadcrumb: 'Wellness Retreat Guide',
    // nav: <nav class="nav"> + mobile-menu (lines 144-168)
    // main: <main id="main-content"> at line 170
    // h1 is inside main with inline style
  },
  {
    file: 'things-to-do-in-mauritius.html',
    label: 'Activity Guide',
    breadcrumb: 'Things to Do in Mauritius',
    // nav: plain <nav> at line 189
    // hero: <header class="page-header"> at 205-210 (between breadcrumb nav and main content)
  },
  {
    file: 'trou-deau-douce-mauritius.html',
    label: 'Regional Guide',
    breadcrumb: 'Trou d\'Eau Douce Guide',
    // nav: site-nav at 252-262
    // hero: <header class="hero"> at 264-271 (BEFORE main)
    // main: <main class="page-body"> at 273
  },
];

// ─── Transform logic ──────────────────────────────────────────────────────────

function transformPage(cfg) {
  const filepath = path.join(PAGES_DIR, cfg.file);
  let html = fs.readFileSync(filepath, 'utf8');

  // 1. Extract head meta (preserve exactly)
  const titleM = html.match(/<title>([\s\S]*?)<\/title>/);
  const title = titleM ? titleM[1] : '';

  const descM = html.match(/<meta\s+name="description"\s+content="([^"]*?)"\s*\/?>/);
  const description = descM ? descM[0] : '';

  const canonicalM = html.match(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/);
  const canonical = canonicalM ? canonicalM[0] : '';

  const ogTags = (html.match(/<meta\s+property="og:[^>]*>/g) || []).join('\n  ');

  const ldJsonBlocks = [];
  const ldRe = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let ldM;
  while ((ldM = ldRe.exec(html)) !== null) ldJsonBlocks.push(ldM[0]);

  // 2. Extract h1 and subtitle
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const h1 = h1M ? stripTags(h1M[1]) : title;

  let subtitle = '';
  const subPatterns = [
    /<p\s+class="[^"]*(?:guide-subtitle|page-hero__sub|guide-hero__subtitle|hero__sub|hero-subtitle|subtitle|guide__subtitle)[^"]*"[^>]*>([\s\S]*?)<\/p>/,
    /<p\s+class="[^"]*sub[^"]*"[^>]*>([\s\S]*?)<\/p>/,
  ];
  for (const pat of subPatterns) {
    const m = html.match(pat);
    if (m) { subtitle = stripTags(m[1]); break; }
  }
  // Fallback: first <p> after </h1> inside any hero-like element
  if (!subtitle) {
    const afterH1 = h1M ? html.slice(html.indexOf(h1M[0]) + h1M[0].length) : '';
    const firstPM = afterH1.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (firstPM && firstPM[1].length < 400) subtitle = stripTags(firstPM[1]);
  }

  // 3. Find main content body
  // Strategy: find <main...> opening, get everything until </main>
  // Then strip leading hero/breadcrumb from inside main
  const mainOpenM = html.match(/<main[^>]*>/);
  let mainContent = '';
  if (mainOpenM) {
    const mainStart = html.indexOf(mainOpenM[0]) + mainOpenM[0].length;
    const mainEnd = html.lastIndexOf('</main>');
    if (mainEnd > mainStart) {
      mainContent = html.slice(mainStart, mainEnd);
    }
  } else {
    // No <main> — find content between hero/nav and footer
    const footerStart = html.search(/<footer[\s>]/);
    const bodyAfterNav = html.search(/(?:<\/nav>|<\/header>)\s*\n/);
    if (footerStart > 0 && bodyAfterNav > 0) {
      mainContent = html.slice(bodyAfterNav, footerStart);
    }
  }

  // Strip leading breadcrumb nav from main content
  mainContent = mainContent.replace(/^\s*<nav[^>]*class="[^"]*breadcrumb[^"]*"[^>]*>[\s\S]*?<\/nav>\s*/m, '');
  // Strip leading guide-header / static-page__header / page-header / hero header from main
  mainContent = mainContent.replace(/^\s*<header[^>]*class="[^"]*(?:guide-header|static-page__header|page-header)[^"]*"[^>]*>[\s\S]*?<\/header>\s*/m, '');
  // Strip leading article wrapper if present
  mainContent = mainContent.replace(/^\s*<article[^>]*>\s*/, '');
  mainContent = mainContent.replace(/\s*<\/article>\s*$/, '');
  // Strip trailing related-guides/related-content nav
  mainContent = mainContent.replace(/\s*<nav[^>]*class="[^"]*(?:related-guides|related-content)[^"]*"[^>]*>[\s\S]*?<\/nav>\s*/g, '');

  // 4. Build the hero block
  const hero = `<div class="page-hero">
  <div class="container">
    <div class="breadcrumb"><a href="/">Home</a> &rsaquo; ${cfg.breadcrumb}</div>
    <span class="page-hero__label">${cfg.label}</span>
    <h1>${h1}</h1>
    ${subtitle ? `<p class="page-hero__sub">${subtitle}</p>` : ''}
  </div>
</div>`;

  // 5. Rebuild the full page
  const newHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  ${description}
  ${canonical}

  <!-- Open Graph -->
  ${ogTags}

  <!-- Structured Data -->
  ${ldJsonBlocks.join('\n\n  ')}

${STANDARD_CSS}
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-TN713HPVCQ"></script>
  <script src="/assets/js/analytics.js" defer></script>
</head>
<body>

${STANDARD_NAV}

${hero}

<main class="container">
${mainContent.trim()}
</main>

${STANDARD_FOOTER}

</body>
</html>`;

  fs.writeFileSync(filepath, newHtml);
  console.log(`✓ ${cfg.file} (h1: "${h1.slice(0, 50)}...")`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

for (const page of PAGES) {
  try {
    transformPage(page);
  } catch (err) {
    console.error(`✗ ${page.file}: ${err.message}`);
    console.error(err.stack);
  }
}
console.log('\nAll done.');
