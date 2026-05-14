# SEO Daily Report — 2026-05-15 (Run 2)

## 1. Executive Summary

Four issues fixed and one high-value content page launched. The One&Only Le Saint Géran hotel had a broken URL slug in every URL it appeared in (hotel detail + 4 compare pages) — now corrected. All 7 static pages were still using the CSP-blocked inline GA script despite the earlier fix to generated pages — now corrected. Static pages (methodology, rankings, etc.) were not in the sitemap at all — now included. The new "Best time to visit Mauritius" page (2,100+ words, FAQPage schema) targets 8,000–12,000 monthly searches and is fully internal-linked to 8 persona and regional pages.

---

## 2. Technical Issues Found & Fixed

| Issue | Severity | Status |
|---|---|---|
| `_slugify()` drops accented chars — One&Only slug broken in 5 URLs | High | Fixed |
| Inline GA script in all 7 static pages still CSP-blocked | High | Fixed |
| Static pages (methodology, rankings, etc.) absent from sitemap | Medium | Fixed |
| PAGE_TYPES missing `informational` type | Low | Fixed |

### Slug encoding
`_slugify('One&Only Le Saint Géran')` was producing `oneandonly-le-saint-g-ran` because `é` is non-ASCII and was replaced by `-`. Fixed by adding NFD normalisation + strip combining marks before slugifying. Affects: hotel detail page, and 4 compare pages. All 5 URLs now correct (`oneandonly-le-saint-geran`).

### CSP in static pages
The earlier fix applied to dynamically generated pages only. The 7 hand-authored HTML files in `pages/` still contained the inline GA init block. Replaced with `<script src="/assets/js/analytics.js" defer>` across all 7 files.

### Static pages in sitemap
`methodology`, `rankings`, `adults-only-resorts-mauritius`, `best-value-resorts-mauritius`, `best-resort-mauritius`, and the new `best-time-to-visit-mauritius` page were not appearing in `sitemap.xml`. Added `STATIC_PAGE_SPECS` constant that merges into the sitemap generation step only (not into the dynamic build pipeline).

---

## 3. Content Work Done This Run

### New page: Best Time to Visit Mauritius
- **URL**: `/best-time-to-visit-mauritius/`
- **Target keyword**: "best time to visit Mauritius" (est. 8,000–12,000 searches/month)
- **Word count**: 2,142 words
- **Structured data**: BreadcrumbList + FAQPage (6 questions)
- **Internal links**: 8 links to persona and regional pages
- **Content**: Month-by-month table, season comparison cards, coast guide, activity breakdown (beach, diving, golf, honeymoon), 6-item FAQ

---

## 4. Internal Linking Changes

- New informational page links to: best-luxury, best-honeymoon, best-family, best-wellness, best-value-luxury + belle-mare, flic-en-flac, bel-ombre regional pages
- Roadmap next: add a link to the new informational page from persona ranking pages (reverse linking)

---

## 5. Priority Action List for Next Run

| # | Action | Type | Impact |
|---|---|---|---|
| 1 | Add link to /best-time-to-visit-mauritius/ from persona ranking pages | Internal linking | Medium |
| 2 | Build "Mauritius honeymoon guide" | Content | High |
| 3 | Build "East coast vs west coast Mauritius" | Content | Medium |
| 4 | Expand comparison page set — 4 missing high-value pairs | Comparison | Medium |
| 5 | Add FAQ schema to persona ranking pages (already in assembler, verify output) | Technical | Medium |

---

## 6. Expected SEO Impact

| Change | Expected Impact |
|---|---|
| One&Only slug fix | Corrects 5 broken URLs; Google can now index and attribute the hotel correctly |
| CSP fix in static pages | GA now fires on all 61 pages including hand-authored static pages |
| Static pages in sitemap | Methodology, rankings, adults-only etc. now crawlable via sitemap signal |
| Best time to visit page | New organic entry point for 8–12k monthly searches; supports topical authority |
