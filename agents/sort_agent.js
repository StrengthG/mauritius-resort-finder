/**
 * SortAgent — Mauritius Resort Finder Agent Pipeline
 *
 * Reads the verified hotel inventory from data/Extract.md, scores each hotel
 * against all six traveller personas using the project's scoring_engine.js,
 * and writes ranked tables to data/Sort.md.
 *
 * Usage:
 *   node agents/sort_agent.js [--force]
 *
 * Affiliate links are copied verbatim from Extract.md — never recomputed.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '..');
const HOTELS_PATH  = path.join(ROOT, 'data', 'hotels.json');
const EXTRACT_PATH = path.join(ROOT, 'data', 'Extract.md');
const SORT_PATH    = path.join(ROOT, 'data', 'Sort.md');
const STATE_PATH   = path.join(ROOT, 'data', 'state.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[SortAgent] ${msg}`); }
function warn(msg) { console.warn(`[SortAgent] WARN  ${msg}`); }
function err(msg)  { console.error(`[SortAgent] ERROR ${msg}`); }

function timestamp() { return new Date().toISOString(); }

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function normaliseName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Extract.md parser ─────────────────────────────────────────────────────────

/**
 * Parse Extract.md and return a Map of:
 *   normalisedName → { name, affiliateLink, expediaUrl, status }
 *
 * Only 'Verified' rows are included — failed rows are skipped.
 */
function parseExtract() {
  if (!fs.existsSync(EXTRACT_PATH)) {
    throw new Error(`Extract.md not found at ${EXTRACT_PATH}. Run ExtractAgent first.`);
  }

  const lines   = fs.readFileSync(EXTRACT_PATH, 'utf8').split('\n');
  const entries = new Map();

  for (const line of lines) {
    // Match table rows: | index | name | expediaUrl | affiliateLink | status |
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 5) continue;

    const [idx, name, expediaUrl, affiliateLink, status] = parts;

    // Skip header and separator rows
    if (!idx || isNaN(parseInt(idx, 10)) || name === 'Hotel Name') continue;
    if (status !== 'Verified') {
      warn(`  skipping "${name}" — status: ${status}`);
      continue;
    }

    const key = normaliseName(name);
    entries.set(key, { name, affiliateLink, expediaUrl, status });
  }

  return entries;
}

// ── Persona metadata ──────────────────────────────────────────────────────────

const PERSONA_META = {
  luxury: {
    label:    'Luxury',
    heading:  '# Luxury Rankings',
    why_col:  'Why It Fits — Luxury',
    intro:    'Top hotels for discerning luxury travellers, ranked by overall quality, brand prestige, and five-star amenities.',
  },
  honeymoon: {
    label:    'Honeymoon',
    heading:  '# Honeymoon Rankings',
    why_col:  'Why It Fits — Honeymoon',
    intro:    'Best resorts for honeymoon couples, ranked on romance, privacy, spa quality, and beach access.',
  },
  family: {
    label:    'Family',
    heading:  '# Family Rankings',
    why_col:  'Why It Fits — Family',
    intro:    'Best family-friendly resorts in Mauritius, ranked on kids\' facilities, space, safety, and value.',
  },
  wellness: {
    label:    'Wellness',
    heading:  '# Wellness Rankings',
    why_col:  'Why It Fits — Wellness',
    intro:    'Top wellness resorts ranked by spa quality, fitness facilities, and holistic programmes.',
  },
  remote_work: {
    label:    'Remote Work',
    heading:  '# Remote Work Rankings',
    why_col:  'Why It Fits — Remote Work',
    intro:    'Best resorts for digital nomads and remote workers: reliable Wi-Fi, workspace, and long-stay value.',
  },
  value_luxury: {
    label:    'Best Value Luxury',
    heading:  '# Best Value Luxury Rankings',
    why_col:  'Why It Fits — Best Value',
    intro:    'Best value-for-money luxury hotels: high quality at a relatively accessible price point.',
  },
  budget: {
    label:    'Best Cheap Hotels',
    heading:  '# Best Cheap Hotels Rankings',
    why_col:  'Why It Fits — Budget',
    intro:    'Best cheap hotels in Mauritius under $500/night — independently scored so you get the most quality for your money.',
  },
};

// ── Why-it-fits generator ─────────────────────────────────────────────────────

/**
 * Generate a brief "why it fits" rationale for a hotel under a given persona,
 * derived entirely from the hotel's scored data (no fabrication).
 */
function buildWhyItFits(hotel, persona, score) {
  const amenities = hotel.amenities || {};
  const parts     = [];

  switch (persona) {
    case 'luxury':
      if (hotel.brand_score   >= 8) parts.push('top-tier brand prestige');
      if (amenities.butler_service)  parts.push('butler service');
      if (amenities.private_beach)   parts.push('private beach');
      if (amenities.fine_dining)     parts.push('fine dining');
      if (hotel.overall_rating >= 9) parts.push(`${hotel.overall_rating}/10 overall rating`);
      break;

    case 'honeymoon':
      if (amenities.private_beach)  parts.push('private beach');
      if (amenities.spa)            parts.push('spa');
      if (amenities.butler_service) parts.push('butler service');
      if (amenities.private_pool)   parts.push('private pool');
      if (hotel.location_score >= 8) parts.push('exceptional location');
      break;

    case 'family':
      if (amenities.pool)          parts.push('pool');
      if (amenities.private_beach) parts.push('beach');
      if (hotel.value_score >= 7)  parts.push('good value');
      if (hotel.amenity_score >= 8) parts.push('strong amenities');
      if (hotel.overall_rating >= 8) parts.push(`${hotel.overall_rating}/10 rating`);
      break;

    case 'wellness':
      if (amenities.spa)  parts.push('full spa');
      if (amenities.gym)  parts.push('fitness centre');
      if (amenities.pool) parts.push('pool');
      if (hotel.amenity_score >= 8) parts.push('premium amenities');
      if (hotel.location_score >= 8) parts.push('serene location');
      break;

    case 'remote_work':
      if (amenities.concierge)     parts.push('concierge support');
      if (hotel.value_score >= 7)  parts.push('good long-stay value');
      if (hotel.amenity_score >= 7) parts.push('strong facilities');
      if (amenities.pool)          parts.push('pool for decompressing');
      break;

    case 'value_luxury':
      if (hotel.value_score >= 8)  parts.push(`value score ${hotel.value_score}/10`);
      if (hotel.overall_rating >= 8) parts.push(`${hotel.overall_rating}/10 overall`);
      if (amenities.spa)           parts.push('spa included');
      if (amenities.private_beach) parts.push('beach access');
      break;

    case 'budget':
      if (hotel.price_per_night_usd) parts.push(`from $${hotel.price_per_night_usd}/night`);
      if (hotel.value_score >= 8)    parts.push(`value score ${hotel.value_score}/10`);
      if (hotel.overall_rating >= 8) parts.push(`${hotel.overall_rating}/10 rated`);
      if (amenities.private_beach)   parts.push('beach access');
      if (amenities.pool)            parts.push('pool');
      break;
  }

  const base = parts.length > 0
    ? parts.slice(0, 3).join(', ')
    : `score ${score.toFixed(1)}/100`;

  return `${score.toFixed(1)}/100 — ${base}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  const force = process.argv.includes('--force');
  log(`Starting — ${timestamp()}${force ? ' (force mode)' : ''}`);

  // ── Guard: Sort.md already fresh ─────────────────────────────────────────

  const state = fs.existsSync(STATE_PATH)
    ? { ...loadJSON(STATE_PATH) }
    : {};

  if (!force && fs.existsSync(SORT_PATH) && state.lastSortRun) {
    const sortTime    = new Date(state.lastSortRun).getTime();
    const extractTime = fs.statSync(EXTRACT_PATH).mtimeMs;
    if (sortTime > extractTime) {
      log('Sort.md is already up to date — run with --force to rebuild.');
      return { skipped: true };
    }
  }

  // ── Load Extract.md ───────────────────────────────────────────────────────

  log('Parsing Extract.md...');
  const extractMap = parseExtract();
  log(`  ${extractMap.size} verified hotels found`);

  if (extractMap.size === 0) {
    err('No verified hotels in Extract.md. Aborting.');
    process.exit(1);
  }

  // ── Load hotels.json for scoring data ─────────────────────────────────────

  log('Loading hotels.json for scoring data...');
  const allHotels = loadJSON(HOTELS_PATH);

  // Build lookup: normalisedName → hotel record
  const hotelLookup = new Map();
  for (const h of allHotels) {
    hotelLookup.set(normaliseName(h.hotel_name || ''), h);
  }

  // Cross-reference Extract with hotels.json; warn on mismatches
  const scorableHotels = [];
  for (const [key, extractEntry] of extractMap) {
    const hotel = hotelLookup.get(key);
    if (!hotel) {
      warn(`"${extractEntry.name}" is in Extract.md but not found in hotels.json — skipping scoring`);
      continue;
    }
    scorableHotels.push({ hotel, affiliateLink: extractEntry.affiliateLink });
  }

  log(`  ${scorableHotels.length} hotels matched to hotels.json for scoring`);

  // ── Score each hotel per persona ──────────────────────────────────────────

  const { rankHotels } = require(path.join(ROOT, 'scoring_engine.js'));
  const personas        = Object.keys(PERSONA_META);
  const personaRankings = {};

  for (const persona of personas) {
    log(`  Scoring persona: ${persona}`);

    let result;
    try {
      result = rankHotels(allHotels, persona);
    } catch (e) {
      err(`  Failed to rank hotels for persona "${persona}": ${e.message}`);
      personaRankings[persona] = [];
      continue;
    }

    const ranked = result.ranked_hotels || [];

    // Attach affiliate link from Extract.md (not from hotels.json) — preserve exactly
    personaRankings[persona] = ranked
      .map(r => {
        const key        = normaliseName(r.hotel_name || '');
        const extract    = extractMap.get(key);
        const affiliate  = extract ? extract.affiliateLink : '';
        return { ...r, affiliateLink: affiliate };
      });
  }

  // ── Generate Sort.md ──────────────────────────────────────────────────────

  log('Writing Sort.md...');

  let md = `# Mauritius Resort Finder — Persona Rankings\n\n`;
  md += `Generated: ${timestamp()}  \n`;
  md += `Source: Extract.md (${extractMap.size} verified hotels)\n`;
  md += `Scoring: scoring_engine.js v${require(path.join(ROOT, 'scoring_engine.js')).SCORE_VERSION}\n\n`;
  md += `---\n\n`;

  for (const persona of personas) {
    const meta    = PERSONA_META[persona];
    const ranked  = personaRankings[persona];

    md += `${meta.heading}\n\n`;
    md += `${meta.intro}\n\n`;

    if (!ranked || ranked.length === 0) {
      md += `_No hotels ranked for this persona._\n\n`;
    } else {
      md += `| Rank | Hotel | Score | ${meta.why_col} | Affiliate Link |\n`;
      md += `|------|-------|-------|${'-'.repeat(meta.why_col.length + 2)}|----------------|\n`;

      ranked.forEach((r, i) => {
        const rank      = i + 1;
        const name      = (r.hotel_name || '').replace(/\|/g, '&#124;');
        const score     = typeof r.scores?.final_ranking_score === 'number'
          ? r.scores.final_ranking_score.toFixed(1)
          : (r.scores?.intent_score || 0).toFixed(1);
        const hotelData = r.hotel || hotelLookup.get(normaliseName(r.hotel_name || '')) || {};
        const why       = buildWhyItFits(hotelData, persona, parseFloat(score)).replace(/\|/g, ',');
        const link      = r.affiliateLink || '';

        md += `| ${rank} | ${name} | ${score} | ${why} | ${link} |\n`;
      });
    }

    md += `\n---\n\n`;
  }

  fs.writeFileSync(SORT_PATH, md, 'utf8');
  log(`Wrote Sort.md (${personas.length} persona tables)`);

  // ── Validate Sort.md ──────────────────────────────────────────────────────

  log('Validating Sort.md...');
  const sortLines     = md.split('\n');
  const dataRows      = sortLines.filter(l => /^\|\s*\d+\s*\|/.test(l));
  const rowsWithLink  = dataRows.filter(l => l.includes('expedia.com/affiliate/'));
  const rowsNoLink    = dataRows.filter(l => !l.includes('expedia.com/affiliate/'));

  log(`  Total ranked rows : ${dataRows.length}`);
  log(`  Rows with link    : ${rowsWithLink.length}`);
  if (rowsNoLink.length > 0) {
    warn(`  Rows missing link : ${rowsNoLink.length}`);
    rowsNoLink.slice(0, 5).forEach(l => warn(`    ${l.split('|')[2]?.trim()}`));
  }

  // ── Update state ──────────────────────────────────────────────────────────

  const updatedState = {
    ...state,
    lastSortRun: timestamp(),
  };
  saveJSON(STATE_PATH, updatedState);

  log('─'.repeat(60));
  log('Sort complete');
  personas.forEach(p => {
    const n = (personaRankings[p] || []).length;
    log(`  ${PERSONA_META[p].label.padEnd(20)} ${n} hotels ranked`);
  });
  log('─'.repeat(60));

  return { personas: personaRankings, dataRows: dataRows.length };
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
  try {
    run();
  } catch (e) {
    err(e.message);
    process.exit(1);
  }
}

module.exports = { run };
