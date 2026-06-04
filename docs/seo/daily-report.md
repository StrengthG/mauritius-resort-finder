# SEO Daily Report — Run 40
**Date:** 2026-06-04
**Agent:** Dodo SEO Agent (Project Lighthouse)

---

## 1. Executive Summary

Run 40 published the Mauritius currency & money guide — a high-priority informational gap identified in Runs 38 and 39. The page covers the Mauritian Rupee, six methods for obtaining local currency ranked by cost-efficiency (ATM best, hotel exchange worst), card acceptance realities, a 10-row price comparison table, an 8-row tipping guide, three budget-tier cost breakdowns, six practical money tips, and three hotel CTAs. Build 74/74, tests 1810/1810.

---

## 2. Technical Issues Found

None. Build clean, all tests pass.

---

## 3. Content Work Done This Run

**New page: `/mauritius-currency-money-guide/`** (~2,300 words prose; ~4,200 HTML words)

Target keywords: "mauritius currency" / "how much money mauritius" / "mauritius budget tips" / "mauritius rupee" / "cash or card mauritius"

Title: "Mauritius Currency & Money Guide 2026 — ATMs, Budgets & Tipping Tips"
Meta: "Mauritius uses the Mauritian Rupee (MUR). Get local cash from ATMs on arrival — best rates. Covers tipping, typical costs, card acceptance, and budget planning for 2026."

Sections published:
- **Green/emerald hero** (`#052e16 → #14532d → #065f46`) — currency-appropriate colour palette
- **Quick facts strip** — 6 items: currency name, ISO code, approx USD rate, ATM availability, card acceptance, tipping norm
- **Jump nav** — 9 section anchors
- **The Mauritian Rupee** — background, denominations, coins vs notes
- **6-method card grid** — ATM (Best), Bank exchange (Good), Travel money card (Good), Hotel exchange (Avoid), Airport bureau (Avoid), Foreign cash (Limited use); each rated with colour-coded badge
- **Card acceptance & cash reality** — prose covering which venues are card-friendly, why cash is essential for local restaurants/markets/taxis, and dynamic currency conversion warning
- **10-row typical cost table** — street food MUR 60–120 through scuba diving MUR 2,500+; USD equivalents included
- **8-row tipping guide** — restaurants, hotel staff, taxi, tour guides, spa, drivers, room service, optional contexts
- **3-tier budget breakdown cards** — Budget ($150–250/day), Mid-range ($400–700/day), Luxury ($1,200–3,500/day); each with 4 example line items
- **6 practical money tip cards** — notify your bank, withdraw on arrival, small notes for taxis, duty-free MRU limit, no Uber so budget for taxis, keep receipts for reconversion
- **3 hotel CTAs** — Lagoon Attitude (8.7/10, $520, `expedia.com/affiliate/4toq7Ie`), Lux* Grand Gaube (8.7/10, $680, `expedia.com/affiliate/usEpyj6`), Constance Le Chaland (8.8/10, $820, `expedia.com/affiliate/a1VWvT2`)
- **FAQPage schema + BreadcrumbList schema**
- **6 FAQs** — official currency, best way to get cash, credit cards accepted, tipping etiquette, how much money needed, airport exchange or ATM
- **Related guides** — travel guide, budget travel guide, visa & entry, car hire, best time to visit, best value resorts, island day trips, packing list

Wiring:
- Added to `STATIC_PAGE_SPECS` in `site_builder.js` (priority 0.8, monthly)
- Added to `getRelatedGuides()` in `static_page_renderer.js` (label: 'Currency & Money Guide')

---

## 4. Content Opportunities Identified

- **Mauritius photography spots guide** — "best photography spots mauritius" — niche but growing. Lower priority.
- **Rebuild methodology page** — currently thin and old-format. Cross-linked from rebuilt pages ("read our methodology"). Rebuilding improves trust signals for comparison-stage searchers.

---

## 5. Internal Linking

The currency guide links outward to: mauritius-travel-guide, mauritius-budget-travel-guide, mauritius-visa-entry-guide, mauritius-car-hire-guide, best-time-to-visit-mauritius, best-value-resorts-mauritius, mauritius-island-day-trips, mauritius-packing-list.

The currency guide now appears in the `getRelatedGuides()` pool, so it will surface as a related guide link on all dynamically generated pages (persona, hotel, region, comparison pages).

---

## 6. Backlink Opportunities

- **Budget travel blogs** — "mauritius on a budget" content naturally references currency and money guides
- **Honeymoon planning sites** — cost planning is a top pre-trip query; currency guide is a natural link target
- **Expat / digital nomad communities** — "how much does it cost to live in Mauritius" adjacent content

---

## 7. Conversion Improvements

- **Budget tier cards** are segmented by traveller type, nudging readers toward the hotel CTA that matches their budget tier. The budget tier card sits directly above the hotel CTAs.
- **ATM-best framing** reduces anxiety around cash access, which is a common pre-trip concern — reduces the "maybe I shouldn't go" friction for budget-conscious travellers.

---

## 8. Priority Action List (Next Run)

| Priority | Task | Type | Keyword Target |
|---|---|---|---|
| Medium | Rebuild methodology page to modern standard | Technical/Trust | — |
| Low | Mauritius photography spots guide | Informational | "photography mauritius" |
| Ongoing | Digital PR outreach (honeymoon, family, budget angles) | Backlinks | Multiple |
| Ongoing | Monitor GSC for impressions with low CTR | Analytics | Weekly |

---

## 9. Expected SEO Impact

"Mauritius currency" is a pre-trip planning query with consistent search volume year-round — it peaks in the 6–8 weeks before peak travel season (November–April). The page targets three keyword clusters: currency basics ("mauritius rupee", "mauritius currency"), practical logistics ("cash or card mauritius", "ATM mauritius"), and budget planning ("how much money mauritius", "mauritius budget tips"). FAQPage schema gives the 6 FAQ answers featured-snippet eligibility. The cost table provides a scannable comparison format that competes directly with generic travel forum posts that currently rank for these queries. Expected indexing: 2–4 weeks.
