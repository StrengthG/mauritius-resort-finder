# SEO Daily Report — 2026-05-15

## 1. Executive Summary

First audit of Mauritius Resort Finder under Project Lighthouse. Four critical technical SEO issues were found and fixed in this session. Google Analytics was not firing on any page due to a Content Security Policy violation — meaning zero conversion tracking data has been collected. Canonical URLs conflicted with the sitemap, creating a duplicate-content signal on all 61 pages. All ranking page titles were two years stale. Meta descriptions were exposing internal scoring text, hurting CTR across the board.

All four issues are now fixed and pushed. The next highest-priority work is: (1) informational content pages targeting high-volume queries, and (2) expanding the comparison page set to capture branded comparison searches.

---

## 2. Technical Issues Found & Fixed

| Issue | Severity | Status |
|---|---|---|
| CSP blocks GA inline script — no analytics data collected | **Critical** | Fixed |
| Canonical URLs missing trailing slash (sitemap has them) | **High** | Fixed |
| All persona + region page titles showing "2024" | **High** | Fixed |
| Meta descriptions exposing internal scoring text | **High** | Fixed |
| Cloudflare Pages had no build command — site never generated | **Critical** | Fixed (prev. session) |

### CSP / Google Analytics
The `Content-Security-Policy` header had `script-src 'self' https://www.googletagmanager.com` with no `'unsafe-inline'`. The GA initialisation was an inline `<script>` block, which was blocked. Solution: extracted to `assets/js/analytics.js` (served as `'self'`). GA should now fire on all 61 pages.

### Canonical vs Sitemap Trailing Slash
Sitemap: `https://mauritiusresortfinder.com/best-luxury-hotels-mauritius/` (trailing slash)
Canonical was: `https://mauritiusresortfinder.com/best-luxury-hotels-mauritius` (no slash)
Cloudflare Pages serves from directory `index.html` files, so the trailing-slash URL is authoritative. Canonicals now match the sitemap.

### Stale Year in Titles
- Before: "Best Luxury Hotels in Mauritius **2024**"
- After: "Best Luxury Hotels in Mauritius **2026**"
Affects all 6 persona pages and all 16 regional pages (22 pages total).

### Meta Descriptions
- Before (persona pages): Internal scoring text starting with "Four Seasons Resort Mauritius at Anahita: Overall score: 79/100. Leading signal — Brand score: 95/100..."
- Before (hotel pages): Same scoring text for every hotel, regardless of which hotel the page is about
- After (persona pages): Persona-specific copy targeting the user's intent
- After (hotel pages): "Royal Palm Beachcomber Luxury — independent review covering location, amenities, guest ratings, and booking options in Grand Baie, Mauritius."

---

## 3. Content Opportunities

### Missing High-Value Pages (not yet built)
| Page | Target Keyword | Est. Monthly Searches | Priority |
|---|---|---|---|
| Best time to visit Mauritius | "best time to visit Mauritius" | 8,000–12,000 | High |
| East coast vs west coast Mauritius | "east coast vs west coast Mauritius" | 1,000–3,000 | High |
| Mauritius honeymoon guide | "Mauritius honeymoon guide" | 3,000–5,000 | High |
| Mauritius luxury travel guide | "Mauritius luxury travel guide" | 1,000–2,000 | Medium |
| Le Morne luxury hotels | "le morne hotels mauritius" | 500–1,500 | Medium |

### Comparison Pages — Current Coverage Gap
The site has 10 comparison pages covering only 5 hotels. High-value comparisons missing:
- Royal Palm vs One&Only Le Saint Géran
- Shangri-La Le Touessrok vs Four Seasons Mauritius
- LUX* Grand Gaube vs LUX* Belle Mare
- Heritage Awali vs Shanti Maurice

### Sitemap Missing the Homepage
`https://mauritiusresortfinder.com/` is not in `sitemap.xml`. This is the most important page for ranking "best resorts in Mauritius".

---

## 4. Internal Linking Recommendations

- Hotel detail pages do not link back to the persona pages they appear on (e.g. Royal Palm has no link to `/best-luxury-hotels-mauritius/`).
- Regional pages do not cross-link to each other or to the pillar page.
- Compare pages are siloed — no links from hotel detail pages to relevant comparisons.
- Homepage (`index.html`) should link to all 6 persona pages and the top 5 regional pages.

---

## 5. Backlink Opportunities

**Digital PR targets** (sites likely to cover Mauritius luxury travel):
- Condé Nast Traveller (UK/US)
- The Points Guy
- Luxury Travel Magazine
- Travel + Leisure
- Forbes Travel Guide

**Guest post targets:**
- Honeymoon-specific blogs ("The Honeymoon Guy", "Honeymoons Inc blog")
- Expat Mauritius communities
- Beachcomber Hotels travel blog (potential partnership)

**Data-driven PR angles** (unique angles from the scoring data):
- "We ranked every 5-star hotel in Mauritius — here's what the data says"
- "Best value for money luxury hotels in Mauritius 2026 (ranked by algorithm)"

---

## 6. Conversion Improvements

- **CTA placement**: "Check prices" buttons exist on all hotel cards but there is no sticky CTA in the site header for hotel detail pages.
- **Affiliate disclosure**: The disclosure text is present but small and below the fold. Consider adding a brief inline note near each CTA.
- **Missing price context**: Many hotel cards show no price estimate, reducing conversion intent.

---

## 7. Priority Action List

| # | Action | Impact | Effort | Score |
|---|---|---|---|---|
| 1 | Add homepage to sitemap.xml | High | Low | **High** |
| 2 | Build "Best time to visit Mauritius" informational page | High | Medium | **High** |
| 3 | Build "Mauritius honeymoon guide" informational page | High | Medium | **High** |
| 4 | Add internal links from hotel pages → persona pages | Medium | Low | **High** |
| 5 | Add internal links from compare pages → hotel pages | Medium | Low | **Medium** |
| 6 | Expand comparison page set (missing 4 high-value pairs) | Medium | Medium | **Medium** |
| 7 | Build Le Morne regional page | Medium | Low | **Medium** |
| 8 | Add structured data (FAQPage) to persona ranking pages | Medium | Low | **Medium** |

---

## 8. Expected SEO Impact

| Fix | Expected Impact |
|---|---|
| CSP / GA fixed | Analytics data now flowing; can make data-driven decisions |
| Canonical trailing slash | Consolidates ranking signal; removes duplicate-content ambiguity on 61 pages |
| Year 2024 → 2026 in titles | Improved CTR on ranking/persona pages (stale years signal outdated content) |
| Meta descriptions | Improved CTR across all 61 pages; better SERP snippet quality |
| Informational pages (next) | New organic traffic from high-volume head terms; supports topical authority |
