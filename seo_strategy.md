# SEO Link Acquisition Strategy
## Mauritius Resort Finder

**Goal:** 50 quality referring domains within 6 months, DA 30+ average  
**Monetisation:** Expedia affiliate commission (disclosed on all pages)  
**Editorial position:** Independent, data-driven, no paid placements

---

## Phase 1 — Foundation (Months 1–2)

**Objective:** Establish topical authority and get first 10 links

### Week 1–2: Broken Link Outreach (quickest wins)
- Run Ahrefs or Moz on the top 10 Mauritius travel pages and audit their
  outbound links for 404s
- Use `seo_outreach.js` to print the 5 highest-priority `broken_link` targets
- Send Template 3 to each — aim for 2–3 links placed by end of week 2

### Week 3–4: Resource Page Submissions
- Contact tourism boards: Mauritius Tourism Promotion Authority, Vanilla Islands
- Submit methodology page as a resource to Oyster, HotelsCombined
- These convert slowly but carry institutional authority

### Month 2: First Guest Posts
- Target DA 40–55 blogs first: Africa Travel Magazine, Africa.com, Global
  Grasshopper
- Pitch angles aligned to existing content on the site
- Write 1,200–1,800 word pieces; link back to one deep page (not homepage)
- Aim for 3–4 published posts by end of month 2

---

## Phase 2 — Growth (Months 3–4)

**Objective:** 25–35 total referring domains, rising DA

### Continued Guest Posting — Mid-Tier Targets
- Wanderlust, Hand Luggage Only, The Travel Hack, Be My Travel Muse
- These require a stronger pitch because they receive high volume
- Lead with data: *"Our scoring model across 20 hotels shows adults-only
  resorts outperform standard luxury on value by 18%"*
- Turnaround time: 4–8 weeks from pitch to publication

### HARO / Source Opportunities
- Sign up for HARO (Help a Reporter Out) at journalistsource.org
- Monitor for Mauritius + Indian Ocean + luxury travel queries
- Respond within 2 hours of query — speed is the differentiator
- Even DA 30 press mentions build topical relevance signals

### Internal Link Audit
- Run `node seo_outreach.js` monthly to confirm tracker is up to date
- Ensure each published guest post links to a different internal page
  (distribute equity: rankings, best-resort, adults-only, methodology)

---

## Phase 3 — Authority (Months 5–6)

**Objective:** 50 referring domains, average DA 45+

### High-DA Pitches (DA 70+)
- Rough Guides, Lonely Planet, TripAdvisor Insights, The Points Guy
- These require an angle they can't produce internally
- Best pitch: *"I have 12-metric scoring data on every major Mauritius resort —
  happy to share the raw dataset for a story you're working on"*
- Offer data exclusivity for a defined window (e.g. 30 days)

### Expedia Affiliate Relationship
- Contact Expedia's affiliate team directly to explore co-editorial
  opportunities (not paid; exchange of editorial value)
- Our ranking data is legitimately useful to them

### Link Reclamation
- Use Google Alerts for brand mentions of "mauritius-resort-finder" without a
  linked URL — email the author to add the link
- Set alerts for all hotel names on the site too

---

## Weekly Operating Rhythm

| Day | Task |
|-----|------|
| Monday | Run `node seo_outreach.js` — review pipeline stats |
| Tuesday | Send 3–5 new outreach emails using templates |
| Wednesday | Follow up on emails sent 7–10 days ago |
| Thursday | Write / edit guest post content |
| Friday | Update `seo_outreach_tracker.csv` with all responses and status changes |

---

## KPIs

| Metric | Month 1 | Month 2 | Month 3 | Month 6 |
|--------|---------|---------|---------|---------|
| Referring domains | 2 | 8 | 18 | 50 |
| Average DA of links | 30 | 35 | 40 | 45 |
| Emails sent (cumulative) | 20 | 40 | 65 | 120 |
| Response rate | — | 12% | 14% | 16% |
| Acceptance / link rate | — | 6% | 8% | 10% |
| Organic impressions (GSC) | baseline | +20% | +50% | +200% |
| Affiliate clicks / month | baseline | +15% | +40% | +150% |

---

## Link Quality Rules

1. **Never buy links.** Google penalises paid links; affiliate disclosure is
   fine, paid editorial links are not.
2. **Minimum DA 30** for any pursued link (exceptions: highly relevant
   niche sites, tourism boards, government domains).
3. **Anchor text diversity.** No more than 20% exact-match anchors
   ("best resorts mauritius"). Prefer branded, natural, or partial-match.
4. **No link farms or PBNs.** Any offer of a "link package" should be rejected.
5. **Editorial context only.** Links must appear within editorial body text,
   not footers, sidebars, or blogroll widgets.

---

## Tools Required

- **Ahrefs / Moz / Semrush** — broken link detection, DA check, competitor
  backlink analysis (any one of these; Ahrefs preferred)
- **Google Search Console** — impression and CTR tracking, index status
- **Google Alerts** — brand mention monitoring
- **HARO** — journalistsource.org
- **`seo_outreach.js`** — local CLI for pipeline status review
- **`seo_outreach_tracker.csv`** — master database; update weekly
