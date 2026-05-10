# Mauritius Resort Finder

> AI-powered hotel and resort affiliate platform for Mauritius — static site generator with persona-driven scoring, hallucination-safe content generation, and Airtable CMS integration.

**Production URL:** [mauritiusresortfinder.com](https://mauritiusresortfinder.com)  
**Deployment:** Cloudflare Pages  
**Test Status:** ✅ 1,614 tests passing across 8 suites  

---

## Overview

Mauritius Resort Finder is a content-first affiliate platform that helps travellers find the best hotels and resorts in Mauritius. The platform uses a multi-stage AI pipeline to score hotels against six traveller personas, generate editorial-quality explanations, assemble structured HTML page blocks, and render a complete static site — all without any runtime infrastructure or paid AI APIs.

Every page is generated from Airtable CMS data, scored deterministically, and deployed as static HTML to Cloudflare Pages. Revenue is earned through affiliate commissions on hotel bookings.

---

## Architecture

```
Airtable CMS
    │
    ▼
airtable_sync.js          ← Layer 0: Data ingestion & normalization
    │
    ▼
integration_harness.js    ← Layer 1: Pipeline orchestration
    │
    ├──▶ scoring_engine.js        ← Persona-driven hotel ranking (0–100)
    │
    ├──▶ phrase_library.js        ← 2,000+ editorial phrase templates
    │
    ├──▶ hallucination_guard.js   ← Fabrication detection & evidence checks
    │
    ├──▶ confidence_enforcer.js   ← Confidence scoring & hedging
    │
    ├──▶ explanation_engine.js    ← AI explanation generation per hotel
    │
    └──▶ block_assembler.js       ← HTML block assembly & trust scoring
            │
            ▼
    static_page_renderer.js       ← Full HTML page rendering (XSS-safe)
            │
            ▼
    site_builder.js               ← Static site orchestrator
            │
            ▼
    dist/                         ← deployable static site
         ├── index.html
         ├── sitemap.xml
         ├── robots.txt
         ├── feed.xml
         └── [slug]/index.html × N pages
```

### Page Types

| Type | Description | Example slug |
|---|---|---|
| `pillar` | Main luxury guide | `/best-luxury-hotels-mauritius` |
| `persona` | Per-traveller-type page | `/mauritius-hotels-honeymoon` |
| `region` | Per-region page | `/hotels-grand-baie-mauritius` |
| `hotel` | Individual hotel page | `/hotels/royal-palm-beachcomber` |
| `comparison` | Side-by-side comparison | `/compare/royal-palm-vs-lux-grand-gaube` |
| `seasonal` | Seasonal travel guides | `/best-time-visit-mauritius-january` |

### Six Traveller Personas

`luxury` · `honeymoon` · `family` · `wellness` · `remote_work` · `value_luxury`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 (zero external dependencies) |
| CMS | Airtable REST API |
| Hosting | Cloudflare Pages |
| DNS | Cloudflare |
| Domain | mauritiusresortfinder.com |
| Testing | Custom zero-dependency test harness |
| CI/CD | GitHub Actions |

**Zero external npm dependencies.** The entire platform uses only Node.js built-in modules.

---

## Monetization Model

Revenue is earned through hotel affiliate commissions:

- **Primary:** Booking.com Partner Programme (up to 25% commission)
- **Secondary:** Hotels.com, Expedia, direct hotel partnerships
- **Commission tiers:** `standard` / `premium` (reflected in ranking adjustments)
- **Disclosure:** Every affiliate link carries a mandatory disclosure block, enforced at the renderer level

The scoring engine is commission-aware but not commission-driven — hotels are ranked by quality first, with a minor ±1 position adjustment for affiliate relationships.

---

## Directory Structure

```
mauritius-resort-finder/
│
├── scoring_engine.js          # Hotel scoring & persona ranking (0–100)
├── scoring_engine.test.js     # 234 tests
│
├── phrase_library.js          # 2,000+ editorial phrase templates
│
├── hallucination_guard.js     # Fabrication detection & confidence checks
├── hallucination_guard.test.js # 176 tests
│
├── confidence_enforcer.js     # Confidence scoring, hedging, citation enforcement
├── confidence_enforcer.test.js # 230 tests
│
├── explanation_engine.js      # Per-hotel AI explanation generation
├── explanation_engine.test.js # 111 tests
│
├── block_assembler.js         # HTML block assembly, trust scoring, QA gates
├── block_assembler.test.js    # 138 tests
│
├── static_page_renderer.js    # Full HTML page rendering (XSS-safe, structured data)
├── static_page_renderer.test.js # 242 tests
│
├── airtable_sync.js           # Airtable CMS integration, normalization, snapshots
├── airtable_sync.test.js      # 245 tests
│
├── site_builder.js            # Static site orchestrator (sitemap, RSS, robots)
├── site_builder.test.js       # 238 tests
│
├── integration_harness.js     # End-to-end pipeline harness
│
├── run_tests.js               # Master test runner
├── package.json
├── .gitignore
├── LICENSE
└── .github/
    └── workflows/
        └── ci.yml             # GitHub Actions CI pipeline
```

---

## Test Status

| Suite | Tests | Status |
|---|---|---|
| scoring_engine | 234 | ✅ |
| hallucination_guard | 176 | ✅ |
| confidence_enforcer | 230 | ✅ |
| explanation_engine | 111 | ✅ |
| block_assembler | 138 | ✅ |
| static_page_renderer | 242 | ✅ |
| airtable_sync | 245 | ✅ |
| site_builder | 238 | ✅ |
| **Total** | **1,614** | ✅ **All passing** |

---

## Build Instructions

### Prerequisites

- Node.js ≥ 18.0.0
- No npm install required (zero external dependencies)

### Run All Tests

```bash
node run_tests.js
# or
npm test
```

### Run Individual Test Suite

```bash
node scoring_engine.test.js
node site_builder.test.js
# etc.
```

### Sync Data from Airtable

```bash
export AIRTABLE_API_KEY=patXXXXXXXXXXXXXX
export AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX

node airtable_sync.js --out ./data
```

This writes four artifacts to `./data/`:
- `raw_tables.json` — raw Airtable records
- `normalized_dataset.json` — normalized schema
- `hotels.json` — final hotel objects for scoring
- `sync_report.json` — counts, warnings, timing

### Build the Static Site

```bash
node site_builder.js \
  --out ./dist \
  --base https://mauritiusresortfinder.com \
  --verbose
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--out` | `./dist` | Output directory |
| `--base` | `https://mauritiusresortfinder.com` | Base URL for sitemap & canonical links |
| `--verbose` | off | Print per-page build status |
| `--dry-run` | off | Plan pages without writing files |
| `--concurrency` | `10` | Parallel page builds |
| `--top-n` | `5` | Top N hotels for comparison pages |
| `--fail-on-error` | off | Exit non-zero if any page fails |

---

## Deployment to Cloudflare Pages

### Option A — Automatic (via GitHub Actions)

1. Connect the GitHub repo to Cloudflare Pages in the Cloudflare dashboard.
2. Set build command: `node site_builder.js --out ./dist`
3. Set output directory: `dist`
4. Add environment variables in Cloudflare Pages settings:
   - `AIRTABLE_API_KEY`
   - `AIRTABLE_BASE_ID`
5. Every push to `main` triggers a deploy.

### Option B — Manual Deploy via Wrangler

```bash
npm install -g wrangler
wrangler pages deploy dist --project-name mauritius-resort-finder
```

### Environment Variables

Set these in Cloudflare Pages → Settings → Environment Variables:

| Variable | Required | Description |
|---|---|---|
| `AIRTABLE_API_KEY` | ✅ | Airtable personal access token |
| `AIRTABLE_BASE_ID` | ✅ | Airtable base ID (`appXXXXXXXX`) |
| `AIRTABLE_TOKEN` | optional | Alternative token env var name |

---

## Security

The codebase has undergone a full security audit. Hardening applied:

- **Path traversal prevention** — `_buildOutputPath` validates all slug paths stay within the output directory
- **URL-scheme XSS protection** — `_safeUrl()` blocks `javascript:`, `data:`, `vbscript:` in all `href` attributes
- **Response body size limit** — Airtable HTTP client caps responses at 50 MB to prevent OOM
- **Request timeout** — 30-second timeout on all Airtable API calls
- **Division-by-zero guard** — `computePersonaWeights` throws `RangeError` if total weight reaches zero
- **XSS escaping** — all user-controlled values HTML-escaped before output; JSON-LD blocks protected against `</script>` injection
- **No `eval`, no `innerHTML`, no `child_process`** — confirmed across entire codebase

---

## Contributing

This is a private commercial project. For internal contributors:

1. Branch from `main`: `git checkout -b feature/your-feature`
2. Make changes
3. Run the full test suite: `node run_tests.js`
4. Open a pull request against `main`
5. CI must pass before merge

---

## License

MIT — see [LICENSE](./LICENSE)
