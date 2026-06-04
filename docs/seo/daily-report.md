# SEO Daily Report — Run 41
**Date:** 2026-06-04
**Agent:** Dodo SEO Agent (Project Lighthouse)

---

## 1. Executive Summary

Run 41 rebuilt the methodology page — the site's primary trust signal, linked from every rebuilt informational page via a "read our methodology" cross-link. The old page used the legacy dark-nav format, referenced "18 Resorts" (actual count: 36), had a 2025 copyright footer, and contained no structured data. The rebuilt page is ~2,400 words with FAQPage + BreadcrumbList schema, a six-item quick facts strip, a traveller personas section explaining how the six persona weights work, a do/don't integrity grid, three hotel CTAs, and a related guides section. Build 74/74, tests 1810/1810.

---

## 2. Technical Issues Found

- **"18 Resorts" reference** — the old page stated "18 Resorts Evaluated" in two places (hero eyebrow and the do/don't section). Updated to 36 throughout.
- **2025 copyright** — footer said "© 2025". Updated to 2026.
- **Old nav/footer format** — the page used the legacy dark global-css nav and a minimal single-line footer. Replaced with the modern white sticky header and multi-column dark footer matching all pages rebuilt since Run 5.
- **No structured data** — the old page had no JSON-LD. Added FAQPage schema (6 questions) and BreadcrumbList schema.
- **Thin "do/don't" section** — still referenced "18 hotels" and had no explanation of the six traveller personas, which is a meaningful gap for readers trying to understand why different persona views produce different rankings.
- No other technical issues. Build 74/74, tests 1810/1810.

---

## 3. Content Work Done This Run

**Rebuilt page: `/methodology/`** (~2,400 words prose; ~4,500 HTML words)

Title: "Our Scoring Methodology — How We Rate Mauritius Hotels | Mauritius Resort Finder"
Meta (157 chars): "How Mauritius Resort Finder scores 36 luxury hotels: four independent criteria, verified guest data, no paid placements. Full methodology explained."

New sections added vs old page:
- **Modern white sticky header** — matches all rebuilt pages
- **Breadcrumb nav** — Home › Methodology
- **Dark navy/slate hero** (`#0c1422 → #1a2840 → #0d1f35`) — authoritative, trust-signal colour palette
- **Quick facts strip** — 6 items: 36 hotels scored, 4 criteria, 0–10 scale, £0 paid placements, May 2026 last review, 6 personas
- **Jump nav** — 9 section anchors
- **The Four Criteria** — each criterion expanded with full prose rationale (~120 words each vs ~50 words in the old page). New detail: review volume confidence weighting, criteria calibration for the Mauritius market, what "value" means at different price brackets.
- **Scoring Formula** — new numeric interpretation guide (9.0+ exceptional, 8.5–8.9 excellent, 8.0–8.4 good, <8.0 average) and explicit no-rounding-up policy
- **Data Sources** — expanded with review recency weighting section; clearer distinction between primary and excluded sources
- **Traveller Personas** (new section) — explains the six personas (luxury, honeymoon, family, wellness, remote_work, value_luxury) and how persona weights shift criteria emphasis. This is the first time the site has explained publicly why persona rankings differ from the Overall Score.
- **Integrity grid** — updated to 36 hotels, added two new "we do/don't" items covering fabrication and evidence standards
- **Affiliate Disclosure** — expanded with architectural explanation (scoring engine runs before affiliate data is loaded) and explicit statement that some hotels have no affiliate relationship
- **Score Updates** — expanded with guidance on what triggers a re-score between full reviews (management changes, renovation periods, credible quality signals)
- **3 hotel CTAs** — Royal Palm (9.2/10, $1,450), Four Seasons Anahita (9.1/10, $1,650), Constance Le Chaland (8.8/10, $820)
- **FAQPage schema + BreadcrumbList schema** — 6 FAQs covering scoring process, paid placements, data sources, update frequency, score scale, and affiliate independence
- **Related guides** — 8 cards: all rankings, Find My Resort, luxury, honeymoon, family, adults-only, value, travel guide
- **Modern 4-column dark footer** with Guides column
- **Copyright 2026** throughout

---

## 4. Content Opportunities Identified

- **Mauritius photography spots guide** — "best photography spots mauritius", "where to take photos in mauritius" — niche but growing. Low priority.
- **Mauritius nightlife guide** — "nightlife mauritius", "things to do at night mauritius" — moderate search volume; useful for the younger luxury traveller segment.
- **Île aux Cerfs dedicated guide** (island, not day-trip section) — the Île aux Cerfs is one of Mauritius's most-searched landmarks; it currently only appears within the island day trips guide. A standalone page could capture "île aux cerfs" directly.

---

## 5. Internal Linking

No new pages this run; rebuild only. The rebuilt methodology page links to: rankings, Find My Resort, luxury persona, honeymoon persona, family persona, adults-only, value resorts, travel guide, affiliate disclosure, contact, privacy. The methodology page cross-link from all rebuilt informational pages now leads to a page that matches the quality standard of those pages.

---

## 6. Backlink Opportunities

The methodology page is a natural trust-link target for:
- Travel journalism ("how AI scores hotels" angle) — the architectural explanation of scoring-before-affiliate-data is genuinely unusual and publishable
- Comparison/review meta-sites that link to transparent scoring methodologies
- Consumer advocacy content on how to evaluate hotel review sites

---

## 7. Conversion Improvements

- **Traveller personas section** — helps undecided visitors understand why the persona-filtered view differs from the overall ranking, which reduces the "why is this hotel ranked higher for honeymoon?" support question. Keeps visitors on the site longer to explore persona pages.
- **3 hotel CTAs on the methodology page** — previously, the methodology page was a dead end with no booking path. Now it feeds into the highest-scoring properties, converting trust into bookings.
- **Score interpretation guide** — "9.0+ exceptional, 8.5–8.9 excellent" gives visitors a framework to confidently shortlist. Reduces decision paralysis.

---

## 8. Priority Action List (Next Run)

| Priority | Task | Type | Keyword Target |
|---|---|---|---|
| Low | Mauritius photography spots guide | Informational | "photography mauritius" |
| Low | Mauritius nightlife guide | Informational | "nightlife mauritius" |
| Medium | Île aux Cerfs standalone guide | Regional | "île aux cerfs" / "ile aux cerfs mauritius" |
| Ongoing | Digital PR outreach (methodology / scoring angle) | Backlinks | Trust-link angle |
| Ongoing | Monitor GSC for impressions with low CTR | Analytics | Weekly |

---

## 9. Expected SEO Impact

The methodology page is not a high-traffic target page — it ranks for branded queries ("mauritius resort finder methodology") rather than competitive informational terms. Its SEO value is indirect: it is a trust signal that reduces bounce on comparison-stage searchers who land on persona or comparison pages, click through to verify scoring credibility, and then convert. FAQPage schema gives the 6 methodology FAQ answers featured-snippet eligibility for the handful of searchers who query "how does mauritius resort finder score hotels" or similar. The bigger impact is CRO: the hotel CTAs on the methodology page now give trust-converted visitors a direct booking path without navigating back to a rankings page. Expected indexing of new schema: 2–4 weeks.
