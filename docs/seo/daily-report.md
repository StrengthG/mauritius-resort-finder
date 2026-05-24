# SEO Daily Report — Run 26
**Date:** 2026-05-24
**Agent:** Dodo SEO Agent (Project Lighthouse)

---

## 1. Executive Summary

Run 26 fixed a site-wide `rel="nofollow sponsored"` → `rel="noopener sponsored"` error on all generated pages (5 occurrences in `static_page_renderer.js`), added a null-score guard so the 7 new admin-managed hotels build cleanly without fabricated data, and published the Trou d'Eau Douce & Île aux Cerfs regional guide (~2,200 words). The guide targets "hotels near Île aux Cerfs Mauritius" and "Trou d'Eau Douce hotels" — east coast keyword gaps with clear commercial intent. All 1810 tests pass; 74/74 pages build successfully (104 sitemap entries).

---

## 2. Technical Issues Found & Fixed

### `rel="nofollow sponsored"` on all generated affiliate CTAs
**Found:** `static_page_renderer.js` — all 5 CTA rendering functions used `rel="nofollow sponsored"`. Per CLAUDE.md invariant, affiliate links must use `rel="noopener sponsored"`. `nofollow` is redundant when `sponsored` is present and inconsistent with the static pages (fixed in Run 21).
**Fixed:** Global replacement across `static_page_renderer.js`; 3 test assertions in `static_page_renderer.test.js` updated to match.
**Impact:** Corrects link attribute signal on all 67 generated pages.

### Hotel detail pages for admin-managed hotels with null scores
**Found:** 7 hotels imported from the production admin DB (The Residence Mauritius, The Bay Club at Anahita, Palmar Hotels Seasense Boutique Hotel Spa, Crystals Beach Hotel Mauritius, Sunrise Attitude, Veranda Palmar Beach Hotel, Solana Beach Hotel) had `null` for all score fields. `hotel_content_engine.js` was calling `.toFixed()` on these nulls, crashing 7 hotel detail pages.
**Fixed:** Added null-score guard in `site_builder.js` before calling `hotel_content_engine.generateContent()` — pages build cleanly without the editorial score section.
**Test:** 74/74 pages now succeed (was 67/74).

---

## 3. Content Work Done This Run

**New page: `/trou-deau-douce-mauritius/`** (~2,200 words)

Target keywords: "Trou d'Eau Douce hotels Mauritius" / "hotels near Île aux Cerfs" / "Anahita resort Mauritius"

Page sections:
- **Introduction** — Trou d'Eau Douce as east coast gateway to Île aux Cerfs; Anahita Estate context
- **The Hotels** — 3 CTA cards with verified data:
  - Four Seasons Resort Mauritius at Anahita (9.1/10, $1,650/night, affiliate/s7PgDXw) — highest-scoring east coast hotel
  - Anahita Golf & Spa Resort (8.7/10, $780/night, affiliate/6oyzyzA) — same estate, half the price
  - Bubble Lodge Île aux Cerfs (8.4/10, $750/night, affiliate/nOTJrFM) — unique on-island glamping
- **Île aux Cerfs** — island overview, day-trip logistics, jetty access, water sports, golf club
- **Golf** — Ernie Els course (Anahita Estate), Bernhard Langer course (Île aux Cerfs Golf Club), AfrAsia Bank Mauritius Open context
- **Lagoon & Water** — reef-protected conditions, snorkelling, calm swimming
- **Comparison table** — Trou d'Eau Douce vs Belle Mare across 7 factors
- **Best time to visit** — dry/wet season guidance with link to best-time guide
- **Getting there** — airport distance, transfer options, cost
- **6 FAQs** with FAQPage schema: closest hotels to Île aux Cerfs, how to get there, Four Seasons worth the price, what is TdED known for, staying on the island, vs Belle Mare
- FAQPage, Article, BreadcrumbList structured data

Meta description: "Best hotels in Trou d'Eau Douce, Mauritius: Four Seasons Anahita, Anahita Golf Resort near Île aux Cerfs. East coast golf, lagoon and island guide." (147 chars ✓)

All CTAs use `rel="noopener sponsored"` with affiliate disclosure.

---

## 4. Internal Linking Changes

Trou d'Eau Douce guide added to:
- `getRelatedGuides()` in `static_page_renderer.js` — appears in Related Guides section on all 74 generated pages
- Footer Guides column in `static_page_renderer.js`
- `STATIC_PAGE_SPECS` in `site_builder.js` — included in sitemap at priority 0.7

Internal links from the new page: where-to-stay-in-mauritius, belle-mare-mauritius, east-coast-vs-west-coast-mauritius, best-beaches-in-mauritius, things-to-do-in-mauritius, mauritius-honeymoon-guide, best-time-to-visit-mauritius, le-morne-hotels-mauritius, grand-baie-mauritius, affiliate-disclosure.

---

## 5. Priority Action List for Next Run

1. **Hotel photo/gallery pages** — still blocked on missing hotel-specific image data
2. **"Mauritius restaurants & dining guide"** — next high-volume keyword gap; targets "best restaurants Mauritius" / "where to eat in Mauritius"; strong internal linking to hotel fine dining descriptions
3. **Score data for 7 admin hotels** — these hotels are live on the site but have thin pages (no editorial content) because they have no scoring data; needs user decision on data source or manual entry
4. **Digital PR prep** — draft "we scored every 5-star hotel" pitch for Condé Nast Traveller and The Points Guy

---

## 6. Expected SEO Impact

"Hotels near Île aux Cerfs" and "Trou d'Eau Douce hotels" are medium-volume east coast keywords previously uncovered. The Île aux Cerfs angle is the strongest hook — it is the single most searched island destination in Mauritius and was entirely absent from site content. The comparison table (Trou d'Eau Douce vs Belle Mare) provides a featured-snippet candidate.

The page internally links to 10 existing pages, strengthening the internal link structure across east coast, beach, and activity guides. The 3 hotel CTAs cover the full price range for the area ($750–$1,650) with distinct angles (golf estate, unique island glamping, ultra-luxury lagoon villa).

Updated topical map:
- Intent: "best hotels" (all personas and regions) ✓
- Intent: "when to visit" ✓
- Intent: "where to stay" (region guides) ✓
- Intent: "how to plan" (travel guide) ✓
- Intent: "what to pack" ✓
- Intent: "what to do" ✓
- Intent: "best beaches" ✓
- Intent: "Île aux Cerfs / Trou d'Eau Douce" ✓ (this run)

Site now has 19 informational guides + 7 persona pages + 36 hotel pages + 15 compare pages + 18 regional pages = 95+ indexed pages (104 sitemap entries).
Test suite: 12 suites, 1810 tests.
