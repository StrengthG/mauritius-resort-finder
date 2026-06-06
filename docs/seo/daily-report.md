# SEO Daily Report — Run 43
**Date:** 2026-06-06
**Agent:** Dodo SEO Agent (Project Lighthouse)

---

## 1. Executive Summary

Run 43 published a dedicated snorkelling guide — a high-intent activity query currently covered only as a section within the water sports guide. The Rodrigues Island guide (next item on roadmap) was deferred: no Rodrigues hotels exist in the dataset, making meaningful hotel CTAs impossible without fabricating data. The snorkelling guide fills a genuine content gap with six ranked snorkel zones, an 8-creature marine life grid, a snorkelling vs. diving comparison table, seasonal visibility guidance, and three hotel CTAs covering the island's three top snorkelling zones. Build 74/74, tests 1810/1810.

---

## 2. Technical Issues Found

None. Build clean, all tests pass.

---

## 3. Content Work Done This Run

**New page: `/best-snorkelling-mauritius/`** (~2,500 words prose; ~4,800 HTML words)

Target keywords: "best snorkelling mauritius" / "snorkelling mauritius" / "blue bay marine park snorkelling" / "snorkelling spots mauritius" / "where to snorkel mauritius"

Title: "Best Snorkelling in Mauritius 2026 — Top Spots, Marine Life & Where to Stay"
Meta (159 chars): "The best snorkelling in Mauritius: Blue Bay Marine Park leads for coral diversity, with five more world-class zones around the island. Spots, seasons, marine life, and where to stay."

Hero: Deep ocean/teal (`#0c2a4a → #0a4d6e → #0d7a8a`)

Sections published:
- **Quick facts strip** — 6 items: 6 snorkel zones, 22–28°C water temp, best May–Nov, top site Blue Bay, 1–15m depth range, gear hire from MUR 300
- **Jump nav** — 8 section anchors
- **Top 6 Snorkel Sites** — ranked spot cards with level, access type, and ~120-word prose each:
  1. Blue Bay Marine Park (best overall, beach + boat, all levels)
  2. Coin de Mire (best clarity, boat only, confident swimmers)
  3. Balaclava Marine Park (best fish variety, beach + boat, all levels)
  4. Île aux Cerfs Lagoon (most accessible, beach, beginners)
  5. Belle Mare Reef (best for hotel guests, beach, all levels)
  6. Le Morne Lagoon (best for turtles, beach + boat, beginners)
- **8-species marine life grid** — sea turtles, parrotfish, blacktip reef sharks, octopus, pufferfish, spinner dolphins, lionfish, moray eels; with honest habitat notes and coral health status
- **3-tier season cards** — Best (May–Oct), Good (Nov–Dec), Reduced Visibility (Jan–Apr); includes plankton bloom / cyclone context
- **8-row snorkelling vs. scuba diving comparison table** — certification, depth, what you see, cost, duration, physical demand, child suitability
- **Gear & operators section** — hire vs. bring breakdown, typical costs (MUR 300–600 gear hire, MUR 1,200–2,000 guided boat tours)
- **6 safety & tips cards** — check conditions, reef-safe sunscreen, don't touch coral, go early, defog your mask, stay hydrated
- **3 hotel CTAs** — One&Only Le Saint Géran (9.0/10, $940, Belle Mare reef, `expedia.com/affiliate/61eoozV`), Constance Le Chaland (8.8/10, $820, Blue Bay Marine Park, `expedia.com/affiliate/a1VWvT2`), Westin Turtle Bay (8.6/10, $650, Balaclava Marine Park, `expedia.com/affiliate/PJytcSS`)
- **FAQPage + BreadcrumbList schema** — 6 FAQs covering best site, swimming ability needed, year-round availability, sharks, beach vs boat, Blue Bay entry fee
- **Related guides** — 8 cards: water sports, best beaches, island day trips, Île aux Cerfs, Belle Mare, Balaclava, things to do, travel guide

Wiring:
- Added to `STATIC_PAGE_SPECS` in `site_builder.js` (informational, priority 0.8, monthly)
- Added to `getRelatedGuides()` in `static_page_renderer.js`

---

## 4. Content Opportunities Identified

- **Rodrigues Island guide** — deferred this run (no dataset hotels). Could be built as a purely informational page with CTA framing of "best mainland hotels before flying to Rodrigues" — requires careful framing to avoid CTA irrelevance
- **Mauritius wildlife guide** — "wildlife mauritius", "animals in mauritius" — covers the Casela Nature Parks, the pink pigeon, fruit bats, giant tortoises. Medium intent, good topical authority signal
- **Mauritius nightlife guide** — "nightlife mauritius" — moderate search volume
- **Mauritius photography spots guide** — "photography mauritius" — lower priority, niche

---

## 5. Internal Linking

The snorkelling guide links to: water sports, best beaches, island day trips, Île aux Cerfs, Belle Mare, Balaclava, things to do, travel guide. It now appears in the `getRelatedGuides()` pool — will surface on all generated hotel and persona pages. The three hotel CTAs create conversion pathways from activity research into accommodation booking for three distinct coastal zones.

---

## 6. Backlink Opportunities

- **Scuba diving forums and sites** — "snorkelling vs. diving mauritius" content is natural link bait for dive-focused publications; the comparison table is a uniquely structured resource
- **Family travel sites** — "snorkelling mauritius with kids" angle; the beginner-friendly framing of Blue Bay and Île aux Cerfs is explicitly targeted at families
- **Blue Bay Marine Park conservation organisations** — the reef-safe sunscreen and no-touch-coral sections align with conservation messaging; park-adjacent NGOs sometimes share resources that promote responsible visiting

---

## 7. Conversion Improvements

- **Zone-matched CTAs** — each of the three hotel CTAs is explicitly positioned as adjacent to one of the top three snorkel zones (Belle Mare, Blue Bay, Balaclava). A visitor researching "snorkelling near blue bay mauritius" lands on the Constance Le Chaland CTA — which sits directly adjacent to that marine park. This is a tighter intent match than the generic "top picks" approach used on some earlier pages.
- **Gear hire cost table** — MUR and USD pricing for hire and guided tours gives visitors a realistic budget expectation. Visitors who feel informed about costs convert more readily than visitors who feel uncertain.

---

## 8. Priority Action List (Next Run)

| Priority | Task | Type | Keyword Target |
|---|---|---|---|
| Medium | Mauritius wildlife guide | Informational | "wildlife mauritius" / "animals mauritius" |
| Low | Mauritius nightlife guide | Informational | "nightlife mauritius" |
| Low | Mauritius photography spots guide | Informational | "photography mauritius" |
| Low | Rodrigues Island guide (informational only) | Informational | "rodrigues island mauritius" |
| Ongoing | Digital PR outreach | Backlinks | Snorkelling / conservation angle |
| Ongoing | Monitor GSC for low-CTR impressions | Analytics | Weekly |

---

## 9. Expected SEO Impact

"Best snorkelling in Mauritius" is searched year-round with a seasonal peak during the booking window before peak travel season (April–June for Nov–Jan travel). The existing competition is primarily generic travel aggregators (Tripadvisor activity pages, Lonely Planet) with limited site-specific depth. The six-ranked-spots format with per-site accessibility, level, and access-type labels directly answers the intent better than any single current ranking result. FAQPage schema targets the "is there sharks", "year-round?" and "Blue Bay entry fee" queries, all of which are currently answered in forum posts rather than structured schema. The Coin de Mire section specifically targets "coin de mire snorkelling" — a long-tail query with almost no dedicated page competition. Expected indexing: 2–4 weeks.
