# Mauritius Resort Finder — Agent Pipeline

Three autonomous agents that keep affiliate links and persona rankings in sync
with the live site at mauritiusresortfinder.com.

---

## Quick Start

```bash
# Full pipeline (dry-run — build and validate but do not push)
node agents/run_pipeline.js --dry-run

# Full pipeline (live — build, validate, commit, push)
node agents/run_pipeline.js

# Force full rebuild from scratch
node agents/run_pipeline.js --force

# Run individual agents
node agents/extract_agent.js
node agents/sort_agent.js
node agents/upload_agent.js --dry-run
```

---

## Architecture

```
data/hotels.json          ← source of truth (hotel data + affiliate links)
        │
        ▼
 ExtractAgent             → data/Extract.md   (verified inventory)
        │
        ▼
   SortAgent              → data/Sort.md      (persona-ranked tables)
        │
        ▼
 UploadAgent              → site rebuild → tests → git push
        │
        ▼
  run_pipeline.js         → data/logs/latest_pipeline_report.md
```

---

## Agents

### ExtractAgent (`agents/extract_agent.js`)

**What it does:**
- Reads all hotels from `data/hotels.json`
- Validates each hotel's Expedia Creator affiliate link
- Writes a deduplicated, numbered inventory to `data/Extract.md`
- Reports any hotels missing affiliate links as `Failed`
- Updates `data/state.json` with run metadata

**Resume behaviour:**
By default, ExtractAgent reads the existing `Extract.md` and skips hotels
already present (matched by normalised name). Only new hotels are appended.
Use `--force` to rebuild from scratch.

**Current status:**
29 hotels in `data/hotels.json`, all with verified Expedia Creator links.
The pipeline target is 100 hotels — add more via `airtable_sync.js` or by
directly extending `data/hotels.json`.

**Output format:**
```markdown
| # | Hotel Name | Expedia URL | Affiliate Link | Status |
|---|------------|-------------|----------------|--------|
| 1 | Royal Palm Beachcomber Luxury | https://expedia.com/affiliate/LLPswc1 | https://expedia.com/affiliate/LLPswc1 | Verified |
```

---

### SortAgent (`agents/sort_agent.js`)

**What it does:**
- Parses `data/Extract.md` for the verified hotel list and affiliate links
- Cross-references with `data/hotels.json` to get scoring data
- Uses `scoring_engine.js` (`rankHotels`) to rank hotels for each persona:
  `luxury`, `honeymoon`, `family`, `wellness`, `remote_work`, `value_luxury`
- Writes persona-ranked tables to `data/Sort.md`
- **Affiliate links are copied verbatim from Extract.md** — never recomputed

**Validation:**
- Every ranked row must have a non-empty affiliate link
- Ranking is deterministic: same input always produces the same Sort.md

**Output format:**
```markdown
# Honeymoon Rankings

| Rank | Hotel | Score | Why It Fits — Honeymoon | Affiliate Link |
|------|-------|-------|------------------------|----------------|
| 1    | Four Seasons Resort Mauritius at Anahita | 89.8 | 89.8/100 — spa, private beach, butler service | https://expedia.com/affiliate/s7PgDXw |
```

---

### UploadAgent (`agents/upload_agent.js`)

**What it does:**
- Parses `data/Sort.md` and validates all 169 ranked rows
- Cross-checks every affiliate link in Sort.md against `hotels.json` — fails
  if any link is missing or mismatched
- Confirms every hotel has a non-empty affiliate link (Check Price CTA
  requirement)
- Runs `node site_builder.js` — fails if any page fails to build
- Runs `node run_tests.js` — fails if any test fails
- Spot-checks built pages for affiliate CTAs
- Git commits source files (never `dist/`) and pushes to origin main
- Updates `data/state.json`

**Flags:**
- `--dry-run`: Build and validate but skip commit and push

---

### Orchestrator (`agents/run_pipeline.js`)

Runs all three agents in sequence with validation gates between each:

1. ExtractAgent must produce a valid Extract.md (≥1 Verified row) before
   SortAgent runs.
2. SortAgent must produce a valid Sort.md (≥1 ranked row) before UploadAgent
   runs.
3. If any stage fails, the pipeline aborts and writes a report explaining
   what failed.

**Partial runs (single-agent mode):**
```bash
node agents/run_pipeline.js --extract   # ExtractAgent only
node agents/run_pipeline.js --sort      # SortAgent only
node agents/run_pipeline.js --upload    # UploadAgent only
```

---

## Shared State (`data/state.json`)

```json
{
  "lastProcessedHotelIndex": 29,
  "lastExtractRun": "2026-05-15T...",
  "lastSortRun": "2026-05-15T...",
  "lastUploadRun": "2026-05-15T...",
  "completedHotels": ["royalpalmbeachcomberluxury", "..."],
  "failedHotels": []
}
```

The state file enables resume: if ExtractAgent is interrupted mid-run,
re-running it skips already-completed hotels and picks up where it left off.

---

## Pipeline Report (`data/logs/latest_pipeline_report.md`)

Written after every orchestrator run. Contains:
- Stage-by-stage pass/fail status
- Extract summary (total vs verified hotels)
- Sort summary (ranked rows, affiliate link coverage)
- Next steps if anything needs attention

---

## Adding More Hotels

The pipeline processes whatever is in `data/hotels.json`. To add hotels:

1. **Via Airtable sync**: Run `node airtable_sync.js` with the appropriate
   credentials — it populates `hotels.json` from the Airtable base.

2. **Manually**: Add a record to `hotels.json` in the existing schema.
   Required fields:
   ```json
   {
     "hotel_id": "MQ030",
     "hotel_name": "New Hotel Name",
     "overall_rating": 8.5,
     "location_score": 8,
     "amenity_score": 8,
     "brand_score": 7,
     "value_score": 7,
     "region": "Grand Baie",
     "star_rating": 5,
     "_affiliate_links": [
       {
         "booking_url": "https://expedia.com/affiliate/XXXXXXX",
         "provider": "expedia",
         "commission_rate": 0.05,
         "commission_tier": "standard"
       }
     ]
   }
   ```

3. Re-run: `node agents/run_pipeline.js`

**Generating Expedia Creator affiliate links:**
Expedia Creator links must be generated manually through the
[Expedia Creator dashboard](https://creator.expedia.com). There is no public
API. Once generated, add the link to the hotel record's `_affiliate_links`
array before running the pipeline.

---

## Global Rules

- **Accuracy is critical.** The pipeline validates that hotel names and
  affiliate links match between Extract.md, Sort.md, and hotels.json. Any
  mismatch aborts the upload.
- **Never overwrite valid data.** Extract.md appends by default; use `--force`
  only when you intend a full rebuild.
- **Deterministic.** Same hotels.json always produces the same Extract.md,
  Sort.md, and ranking order.
- **Resume-safe.** State.json tracks progress. Re-running any agent after an
  interruption picks up where it left off.
- **Never commit dist/.** The site is rebuilt on Cloudflare from source.
  Only source files are committed.

---

## Success Criteria

| Criterion | Current Status |
|---|---|
| 100+ verified hotels with Expedia affiliate links | ⚠️ 29/100 — add more via Airtable sync |
| Persona-based rankings in Sort.md | ✅ 169 ranked rows across 6 personas |
| All ranking pages updated on site | ✅ 66/66 pages, 78+ affiliate links per persona page |
| Every hotel card has Check Price CTA | ✅ Validated by UploadAgent |
| Pipeline resumes from previous state | ✅ state.json + deduplication |
