# Mauritius Resort Finder — Project Handoff
**Last updated:** May 2026  
**Live site:** https://mauritiusresortfinder.com  
**GitHub:** https://github.com/StrengthG/mauritius-resort-finder  
**Owner:** Strength-Given Ncube (strengthygivenncube@gmail.com)

---

## What this site is

An independent Mauritius luxury hotel review and affiliate platform. It scores 18 hotels across four criteria (Location, Amenities, Brand, Value), generates 43 static pages, and earns revenue through Expedia Creator Program affiliate links.

**Positioning:** Independent reviews. Real guest data. No paid placements. No marketing copy.  
**Revenue model:** Expedia affiliate commissions on hotel bookings (~5% per booking).  
**Tech stack:** Node.js static site generator → Cloudflare Pages → Namecheap domain.

---

## Architecture overview

```
hotels.json (source of truth)
      │
      ▼
site_builder.js          ← orchestrates the full build
      │
      ├── scoring_engine.js       ← scores each hotel per persona
      ├── explanation_engine.js   ← generates written explanations per hotel
      ├── block_assembler.js      ← assembles blocks (hero, cards, FAQs, CTAs)
      └── static_page_renderer.js ← renders blocks → HTML with full CSS
                                          │
                                          ▼
                                    dist/  (static files)
                                          │
                                          ▼
                              Cloudflare Pages (auto-deploy on git push)
```

### Data source priority (at build time)
1. **Airtable live sync** — if `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` env vars are set
2. **`data/hotels.json`** — committed snapshot; used when Airtable creds are absent (local dev, CI without secrets)
3. **`integration_harness.js`** — hardcoded test dataset; fallback only

---

## File structure

```
mauritius-resort-finder/
│
├── index.html                  ← Homepage (copied to dist/ on every build)
├── site_builder.js             ← Build orchestrator — run `node site_builder.js`
├── static_page_renderer.js     ← HTML renderer + full CSS for all 43 pages
├── scoring_engine.js           ← Scores hotels across 4 dimensions per persona
├── explanation_engine.js       ← Generates written content for hotel cards
├── block_assembler.js          ← Assembles page blocks (hero, cards, CTAs, FAQs)
├── airtable_sync.js            ← Syncs Airtable → data/hotels.json
├── hallucination_guard.js      ← Prevents fabricated claims in generated copy
├── confidence_enforcer.js      ← Enforces confidence levels on explanations
├── phrase_library.js           ← Vocabulary for generated descriptions
├── integration_harness.js      ← Test/fallback hotel dataset
│
├── data/
│   └── hotels.json             ← Hotel data snapshot (committed to git)
│
├── dist/                       ← Generated site output (NOT committed — built by CI)
│   ├── index.html              ← Homepage (copied from root index.html)
│   ├── sitemap.xml
│   ├── robots.txt
│   ├── feed.xml
│   ├── best-luxury-hotels-mauritius/index.html
│   ├── hotels/royal-palm-beachcomber-luxury/index.html
│   ├── compare/[hotel-a]-vs-[hotel-b]/index.html
│   └── ... (43 pages total)
│
├── wrangler.toml               ← Cloudflare Pages config
├── package.json
└── HANDOFF.md                  ← This file
```

---

## Pages generated (43 total)

| Type | Count | Example URL |
|------|-------|-------------|
| Pillar | 1 | `/best-luxury-hotels-mauritius/` |
| Persona | 5 | `/best-honeymoon-hotels-mauritius/` |
| Region | 9 | `/grand-baie-luxury-hotels/` |
| Hotel detail | 18 | `/hotels/royal-palm-beachcomber-luxury/` |
| Comparison | 10 | `/compare/four-seasons-vs-royal-palm/` |

---

## Hotel data — current state

18 active hotels. 12 have verified Expedia affiliate links. 6 are missing links.

| ID | Hotel | Region | Score | Affiliate Link |
|----|-------|--------|-------|----------------|
| MQ001 | Royal Palm Beachcomber Luxury | Grand Baie | 9.2 | ✅ `LLPswc1` |
| MQ002 | Four Seasons Resort Mauritius at Anahita | Beau Champ | 9.1 | ✅ `s7PgDXw` |
| MQ003 | One&Only Le Saint Géran | Belle Mare | 9.0 | ✅ `jJhAhIn` |
| MQ004 | Constance Le Chaland Iko Mauritius | Blue Bay | 8.8 | ✅ `a1VWvT2` |
| MQ005 | Shangri-La Le Touessrok Resort & Spa | Trou d'Eau Douce | 8.9 | ❌ Missing |
| MQ006 | Lux* Grand Gaube Resort & Villas | Grand Gaube | 8.7 | ✅ `usEpyj6` |
| MQ007 | Constance Prince Maurice | Poste de Flacq | 9.0 | ✅ `WmRuuHu` |
| MQ008 | Paradise Cove Boutique Hotel - Adults Only | Cap Malheureux | 9.0 | ✅ `muB8P70` |
| MQ009 | Lagoon Attitude - Adults Only | Cap Malheureux | 8.7 | ✅ `4toq7Ie` |
| MQ010 | Mythic Suites & Villas by MJ Holidays | Grand Gaube | 8.4 | ✅ `c9Mfa5v` |
| MQ011 | Sea Diamond Boutique Hotel & Spa | Cap Malheureux | 8.5 | ✅ `FA2X6xD` |
| MQ012 | Villa Alizée | Port Louis | 8.3 | ✅ `FyoIgaK` |
| MQ013 | Heritage Awali Golf & Spa Resort | Blue Bay | 8.4 | ❌ Missing |
| MQ014 | LUX* Belle Mare | Belle Mare | 8.6 | ❌ Missing |
| MQ015 | Oberoi Beach Resort Mauritius | Grand Baie | 8.8 | ❌ Missing |
| MQ016 | Zilwa Attitude | Cap Malheureux | 8.2 | ✅ `yLn0geY` |
| MQ018 | Victoria Beachcomber Resort & Spa | Grand Baie | 8.3 | ❌ Missing |
| MQ019 | Shandrani Beachcomber Resort & Spa | Blue Bay | 8.2 | ❌ Missing |

> Hotels MQ017 and MQ020 are `_status: "inactive"` and do not generate pages.

### How to add/update a hotel affiliate link

1. Go to [Expedia Creator Hub](https://creator.expedia.com)
2. Find the hotel and generate a short link (`expedia.com/affiliate/XXXXXXX`)
3. Open `data/hotels.json`
4. Find the hotel by `hotel_id`
5. Set the `_affiliate_links` array:
```json
"_affiliate_links": [
  {
    "booking_url": "https://expedia.com/affiliate/XXXXXXX",
    "provider": "expedia",
    "commission_rate": 0.05,
    "commission_tier": "standard"
  }
]
```
6. Rebuild: `node site_builder.js`
7. Commit and push: `git add data/hotels.json && git commit -m "add affiliate link for [hotel]" && git push`

### How to add a new hotel

Add a new object to `data/hotels.json` following this schema:

```json
{
  "hotel_id": "MQ021",
  "hotel_name": "Hotel Name",
  "overall_rating": 8.5,
  "location_score": 8.7,
  "amenity_score": 8.4,
  "brand_score": 8.2,
  "value_score": 7.9,
  "review_count": 500,
  "avg_rating": 4.6,
  "price_per_night_usd": 800,
  "star_rating": 5,
  "property_type": "resort",
  "region": "Grand Baie",
  "_status": "active",
  "_brand_name": "Brand Name",
  "_brand_tier": 8,
  "_affiliate_links": [],
  "amenities": {
    "spa": true,
    "private_beach": true,
    "butler_service": false,
    "fine_dining": true,
    "pool": true,
    "golf": false,
    "kids_club": false
  }
}
```

Valid regions: `Grand Baie`, `Beau Champ`, `Belle Mare`, `Poste de Flacq`, `Cap Malheureux`, `Trou d'Eau Douce`, `Blue Bay`, `Grand Gaube`, `Port Louis`

---

## Deployment pipeline

### How a deploy works

```
git push origin main
      │
      ▼
GitHub triggers Cloudflare Pages build
      │
      ▼
Cloudflare runs: node site_builder.js
      │
      ▼
dist/ folder is deployed to CDN edge
      │
      ▼
mauritiusresortfinder.com goes live (~60-90 seconds)
```

### GitHub secrets required

Set in: GitHub → Settings → Secrets → Actions

| Secret name | Purpose |
|-------------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Pages deploy auth |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `AIRTABLE_API_KEY` | Live hotel data sync (optional — falls back to hotels.json) |
| `AIRTABLE_BASE_ID` | Airtable base reference (optional) |

### Manual local build

```bash
cd mauritius-resort-finder
node site_builder.js          # builds to dist/
node site_builder.js --verbose # with progress output
```

### Run tests

```bash
node run_tests.js             # all test suites
node scoring_engine.test.js   # scoring only
node static_page_renderer.test.js  # renderer only
```

---

## Design system

All pages (homepage + 43 generated) share the same design tokens:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#0d1117` | Page background |
| `--bg-card` | `#161b22` | Card backgrounds |
| `--bg-raised` | `#1c2128` | Elevated surfaces |
| `--gold` | `#c9a84c` | Accent, CTAs, scores |
| `--text` | `#e6edf3` | Primary text |
| `--muted` | `#8b949e` | Secondary text |
| `--border` | `rgba(255,255,255,0.08)` | Borders |
| `--border-gold` | `rgba(201,168,76,0.3)` | Gold borders |

**Homepage CSS** lives in `index.html` `<style>` block.  
**Generated pages CSS** lives in `static_page_renderer.js` → `generateHead()` function.

If you update the design, update **both** locations to keep them in sync.

---

## Scoring model

Each hotel is scored out of 10 per dimension. The composite `overall_rating` is the mean of all four.

| Dimension | Field | What it measures |
|-----------|-------|-----------------|
| Location | `location_score` | Beach quality, reef access, airport distance, surroundings |
| Amenities | `amenity_score` | Spa, pool, dining, watersports, butler, kids club |
| Brand | `brand_score` | Chain reputation, consistency, accreditation |
| Value | `value_score` | Quality delivered relative to nightly rate |

Scores are stored in `data/hotels.json` and converted to 0–100 scale internally by `_adaptScoredHotel()` for the renderer's progress bars.

---

## Editorial standards

**What we never do (reflected in methodology section):**
- Accept paid placements or sponsored rankings
- Use hotel PR copy in generated content
- Inflate scores to protect affiliate revenue
- Hide affiliate relationships
- Display stale prices (we show no prices — only "Check prices →" linking to live Expedia rates)

**Affiliate disclosure:**
- Every "Check prices →" link carries `rel="nofollow sponsored"`
- Every affiliate CTA renders an adjacent disclosure note
- Footer on every page has full affiliate disclosure
- `/affiliate-disclosure/` page is linked in all footers

---

## What's not done yet — priority order

### High priority

**1. Missing affiliate links (revenue impact)**
MQ005, MQ013, MQ014, MQ015, MQ018, MQ019 have no booking links. Hotel detail pages for these show no CTA. Go to [Expedia Creator Hub](https://creator.expedia.com), find each hotel, generate a short link, add to `hotels.json`, rebuild, push.

**2. Google Analytics GA4**
No tracking is wired up. Add your GA4 measurement ID to both `index.html` and `static_page_renderer.js` → `generateHead()`:
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

**3. Resubmit sitemap to Google Search Console**
New hotel slugs were introduced (MQ007–MQ012 were replaced). Old URLs are dead. Go to:
Search Console → [mauritiusresortfinder.com] → Sitemaps → Submit `https://mauritiusresortfinder.com/sitemap.xml`

**4. Update year in page titles**
All generated persona/region titles say "2024". Fix in `site_builder.js` `PERSONA_DEFINITIONS` and the region/comparison title templates (search for `2024`, replace with `2025`). One rebuild + push deploys it everywhere.

### Medium priority

**5. `/rankings/` page**
The homepage links to `/rankings/` but that URL doesn't exist. Either:
- Create a dedicated rankings page, or
- Update the link in `index.html` to point to `/best-luxury-hotels-mauritius/`

**6. `/best-resort-mauritius/` page**
Linked from the homepage CTA. Doesn't exist yet. This would be a "which resort is right for me" persona-matching guide — high SEO value.

**7. `/adults-only-resorts-mauritius/` and `/best-value-resorts-mauritius/`**
Linked from the footer. These pages don't exist. Could be new persona pages added to `PERSONA_DEFINITIONS` in `site_builder.js`.

**8. Hotel images**
No hotel images anywhere. Even stock imagery per region would significantly improve click-through rates and time on page.

**9. Airtable sync validation**
The Airtable integration is wired but hasn't been tested in production with live credentials. Confirm that a push with `AIRTABLE_API_KEY` set correctly pulls live data.

### Lower priority

**10. `package.json` description**
Still says "AI-powered hotel and resort affiliate platform". Update to match the editorial positioning.

**11. Privacy policy page**
Linked from footer (`/privacy/`) but doesn't exist. Required for GDPR compliance once analytics is added.

**12. Affiliate disclosure page**
`/affiliate-disclosure/` is linked but doesn't exist as a standalone page.

**13. `/methodology/` standalone page**
The renderer links to `/methodology` from every page's disclosure section. Currently this is only an anchor on the homepage.

---

## External accounts and access

| Service | URL | What it does |
|---------|-----|-------------|
| Cloudflare Pages | dash.cloudflare.com | Hosts and deploys the static site |
| Namecheap | namecheap.com | Domain registrar for mauritiusresortfinder.com |
| GitHub | github.com/StrengthG/mauritius-resort-finder | Source code and CI/CD trigger |
| Google Search Console | search.google.com/search-console | SEO indexing and sitemap submission |
| Expedia Creator Hub | creator.expedia.com | Affiliate link generation |
| Airtable | airtable.com | Hotel data CMS (optional — site works from hotels.json) |

---

## Routine maintenance

### Monthly
- Check Expedia Creator Hub for new affiliate link formats or policy changes
- Review Google Search Console for crawl errors, especially after any hotel slug changes
- Check for 404s on dead old slugs (if you replace hotels)

### When you add or change hotels
1. Edit `data/hotels.json`
2. Run `node site_builder.js` locally to verify no build errors
3. `git add data/hotels.json && git commit -m "update: [description]" && git push`
4. Cloudflare auto-deploys within 90 seconds
5. If slugs changed, resubmit sitemap in Search Console

### When you update copy or design
- **Homepage:** edit `index.html` directly
- **Generated pages:** edit `static_page_renderer.js` (CSS in `generateHead()`, copy in the block renderer functions)
- Always rebuild locally (`node site_builder.js`) before pushing to catch errors

---

## Key invariants (don't break these)

- `_status: "inactive"` hotels are filtered from all page generation — do not remove this filter in `site_builder.js`
- Every affiliate CTA must have `affiliate_disclosure: true` in its payload — the renderer will throw if missing
- All user-provided strings are HTML-escaped via `esc()` before output — never bypass this
- Slugs are generated by `_slugify()` — accented characters are stripped (e.g. "Géran" → "g-ran"). This is intentional for URL safety but means hotel names with accents get simplified slugs
- `dist/` is not committed to git — it's generated fresh on every Cloudflare build

---

*This document covers the state of the project as of May 2026. Every numbered task in the "What's not done yet" section was known at handoff time.*
