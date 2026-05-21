# SEO Daily Report — Run 21
**Date:** 2026-05-21
**Agent:** Dodo SEO Agent (Project Lighthouse)

---

## 1. Executive Summary

Run 21 shipped the Cap Malheureux north coast editorial guide (~2,100 words) and fixed a site-wide `rel="nofollow"` error on 32 affiliate links across 5 static pages. Cap Malheureux is the strongest remaining regional guide opportunity — 4 hotels in the dataset, including the 9.0/10 Paradise Cove (equal to One&Only Le Saint Géran), and the island's highest concentration of adults-only boutique properties. The compare pages internal link audit confirmed no changes needed — all 22 guides are already properly linked from every compare page. All 1,768 tests pass; 67/67 pages build successfully.

## 2. Technical Issues Found & Fixed

### rel="nofollow sponsored" on 32 affiliate links in static pages (Run 20 follow-up)

The Run 20 audit identified this pattern on `index.html` (5 links); a full audit this run found 32 more across 5 static pages:
- `pages/rankings.html` — 12 affiliate links corrected
- `pages/mauritius-wellness-retreat-guide.html` — 5 links corrected
- `pages/mauritius-family-holiday-guide.html` — 5 links corrected
- `pages/best-value-resorts-mauritius.html` — 5 links corrected
- `pages/adults-only-resorts-mauritius.html` — 5 links corrected

All changed from `rel="nofollow sponsored"` → `rel="noopener sponsored"`. Code examples in `methodology.html` and `affiliate-disclosure.html` also updated to reflect the correct value.

Remaining `rel="nofollow"` instances in static pages are on non-affiliate external links (Google Analytics opt-out, Expedia/Cloudflare privacy policies) — these are correct usage.

### Compare pages internal link audit

All 15 compare pages (plus 4 stale local-only pages) verified. Every compare page already links to all 22 informational guides via the Related Guides section — no changes needed. Task marked complete.

## 3. Content Work Done This Run

**New page: `/cap-malheureux-mauritius/`** (~2,100 words)

Target keyword: "best hotels in Cap Malheureux Mauritius"

- 4 Cap Malheureux hotels with independent scores:
  - Paradise Cove Boutique Hotel (9.0/10, $890/night, adults-only) — highest-rated hotel in northern Mauritius
  - Lagoon Attitude — Adults Only (8.7/10, $520/night)
  - Sea Diamond Boutique Hotel & Spa (8.5/10, $680/night, adults-preferred)
  - Zilwa Attitude (8.2/10, $340/night, family-friendly)
- 2 nearby Grand Gaube picks: LUX* Grand Gaube (8.7/10, $680/night), Mythic Suites & Villas (8.4/10, $500/night)
- 7-factor Cap Malheureux vs Grand Baie comparison table (atmosphere, adults-only options, top hotel score, price range, Coin de Mire view, off-resort scene, best for)
- Area guide: Notre Dame Auxiliatrice church, Coin de Mire island, village character, excursion options
- Who should / shouldn't stay section with internal links to related pages
- 6 FAQs with FAQPage schema, BreadcrumbList, Article structured data
- 6 affiliate CTAs with disclosure; added to sitemap (priority 0.8)

Editorial angle: Cap Malheureux is framed as the best adults-only/boutique alternative to the east coast ultra-luxury tier — same 9.0/10 score as One&Only Le Saint Géran, at lower rates, with the distinctive Coin de Mire view.

## 4. Internal Linking Changes

Cap Malheureux guide added to `getRelatedGuides()` — appears in Related Guides on all 67 generated/static pages. Added to footer Guides column. Added to `STATIC_PAGE_SPECS` for sitemap inclusion. Internal links from the new page: adults-only-resorts, best-honeymoon-hotels, best-luxury-hotels, grand-baie-mauritius, where-to-stay-in-mauritius.

## 5. Priority Action List for Next Run

1. **Grand Gaube dedicated guide** — 2 more scored hotels (LUX* Grand Gaube 8.7/10, Mythic Suites 8.4/10) not yet featured in their own regional guide; natural companion to Cap Malheureux
2. **Mauritius packing list** — informational page for the "what to pack for Mauritius" keyword cluster; low competition, useful for time-on-site
3. **Digital PR prep** — draft "we scored every 5-star hotel in Mauritius" pitch for Condé Nast Traveller and The Points Guy
4. **Hotel page photo/gallery** — improving time-on-site for hotel detail pages

## 6. Expected SEO Impact

Paradise Cove Boutique Hotel is significantly under-represented in search — a 9.0/10 hotel with fewer indexed review pages than One&Only or Four Seasons despite similar quality scores. The Cap Malheureux guide creates the first editorial page specifically targeting "Cap Malheureux" geography and "Paradise Cove" informational queries. The adults-only angle (2 of 4 hotels strictly adults-only) opens an additional keyword cluster: "adults only hotels north Mauritius" and "boutique hotels Cap Malheureux." The `rel` fixes ensure 32 previously-nofollow affiliate links now pass the correct Google signal.

Site now has 15 informational guides + 7 persona pages + 29 hotel pages + 15 compare pages + 17 regional pages = 83 indexed pages.
