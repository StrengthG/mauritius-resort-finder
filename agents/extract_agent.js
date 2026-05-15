/**
 * ExtractAgent — Mauritius Resort Finder Agent Pipeline
 *
 * Reads hotel data from data/hotels.json, validates affiliate links,
 * and writes the inventory to data/Extract.md.
 *
 * Usage:
 *   node agents/extract_agent.js [--force]
 *
 * Flags:
 *   --force   Reprocess all hotels, overwriting Extract.md from scratch.
 *
 * Resume behaviour (default):
 *   Reads existing Extract.md, skips hotels already present by normalised name,
 *   and appends only new entries.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '..');
const HOTELS_PATH  = path.join(ROOT, 'data', 'hotels.json');
const EXTRACT_PATH = path.join(ROOT, 'data', 'Extract.md');
const STATE_PATH   = path.join(ROOT, 'data', 'state.json');
const LOG_DIR      = path.join(ROOT, 'data', 'logs');

// ── Constants ─────────────────────────────────────────────────────────────────

const TARGET_HOTEL_COUNT = 100;
const EXPEDIA_PROVIDER   = 'expedia';

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[ExtractAgent] ${msg}`); }
function warn(msg) { console.warn(`[ExtractAgent] WARN  ${msg}`); }
function err(msg)  { console.error(`[ExtractAgent] ERROR ${msg}`); }

function normaliseName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function timestamp() {
  return new Date().toISOString();
}

// ── Extract.md parser ────────────────────────────────────────────────────────

/**
 * Parse existing Extract.md and return a Set of normalised hotel names
 * already present so we can skip them on resume.
 */
function loadExistingExtract() {
  if (!fs.existsSync(EXTRACT_PATH)) return { names: new Set(), maxIndex: 0 };

  const lines = fs.readFileSync(EXTRACT_PATH, 'utf8').split('\n');
  const names  = new Set();
  let maxIndex = 0;

  for (const line of lines) {
    // Table rows: | 1 | Hotel Name | ...
    const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|/);
    if (match) {
      const idx  = parseInt(match[1], 10);
      const name = match[2].trim();
      if (!isNaN(idx) && name && name !== 'Hotel Name') {
        names.add(normaliseName(name));
        if (idx > maxIndex) maxIndex = idx;
      }
    }
  }

  return { names, maxIndex };
}

// ── Affiliate link helpers ────────────────────────────────────────────────────

function getAffiliateLink(hotel) {
  const links = Array.isArray(hotel._affiliate_links) ? hotel._affiliate_links : [];
  const entry = links.find(l => l.provider === EXPEDIA_PROVIDER);
  return entry ? entry.booking_url : null;
}

function validateAffiliateLink(url) {
  if (!url || typeof url !== 'string') return false;
  // Expedia Creator links use /affiliate/ path
  return url.includes('expedia.com/affiliate/') || url.includes('expedia.com/h/');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function run() {
  const force = process.argv.includes('--force');
  log(`Starting — ${timestamp()}${force ? ' (force mode)' : ''}`);

  // ── Load source data ──────────────────────────────────────────────────────

  if (!fs.existsSync(HOTELS_PATH)) {
    err(`hotels.json not found at ${HOTELS_PATH}`);
    process.exit(1);
  }

  const hotels = loadJSON(HOTELS_PATH);
  log(`Loaded ${hotels.length} hotels from hotels.json`);

  if (hotels.length < TARGET_HOTEL_COUNT) {
    warn(
      `Dataset has ${hotels.length} hotels — target is ${TARGET_HOTEL_COUNT}. ` +
      `Add more hotels to data/hotels.json (via Airtable sync or manual entry) ` +
      `to meet the pipeline target.`
    );
  }

  // ── Load state ────────────────────────────────────────────────────────────

  let state = {
    lastProcessedHotelIndex: 0,
    lastExtractRun: '',
    lastSortRun: '',
    lastUploadRun: '',
    completedHotels: [],
    failedHotels: [],
  };

  if (fs.existsSync(STATE_PATH)) {
    try {
      state = { ...state, ...loadJSON(STATE_PATH) };
    } catch (e) {
      warn(`Could not parse state.json — starting fresh. (${e.message})`);
    }
  }

  // ── Load existing Extract.md ──────────────────────────────────────────────

  let existingNames = new Set();
  let startIndex    = 0;

  if (!force) {
    const existing = loadExistingExtract();
    existingNames  = existing.names;
    startIndex     = existing.maxIndex;
    log(`Resuming: ${existingNames.size} hotels already in Extract.md`);
  } else {
    log('Force mode: rebuilding Extract.md from scratch');
  }

  // ── Process hotels ────────────────────────────────────────────────────────

  const rows         = [];
  const newCompleted = [];
  const newFailed    = [];
  let   counter      = startIndex;

  for (const hotel of hotels) {
    const name       = hotel.hotel_name || '';
    const normalised = normaliseName(name);

    if (!force && existingNames.has(normalised)) {
      log(`  skip  ${name} (already in Extract.md)`);
      continue;
    }

    counter++;
    const affiliateLink = getAffiliateLink(hotel);
    const isValid       = validateAffiliateLink(affiliateLink);
    const status        = isValid ? 'Verified' : 'Failed — no affiliate link';
    // Expedia Creator link is the canonical Expedia URL for this hotel
    const expediaUrl    = affiliateLink || '(pending — generate via Expedia Creator)';

    rows.push({ index: counter, name, expediaUrl, affiliateLink: affiliateLink || '', status });

    if (isValid) {
      newCompleted.push(normalised);
      log(`  ok    #${counter} ${name}`);
    } else {
      newFailed.push({ name, reason: 'No Expedia affiliate link in _affiliate_links' });
      warn(`  fail  #${counter} ${name} — no affiliate link`);
    }
  }

  if (rows.length === 0) {
    log('No new hotels to process — Extract.md is up to date.');
  }

  // ── Write / append Extract.md ─────────────────────────────────────────────

  let output = '';

  if (force || !fs.existsSync(EXTRACT_PATH)) {
    // Full file header
    output =
      '# Mauritius Resort Finder Affiliate Inventory\n\n' +
      `Generated: ${timestamp()}  \n` +
      `Source: data/hotels.json (${hotels.length} hotels)\n\n` +
      '| # | Hotel Name | Expedia URL | Affiliate Link | Status |\n' +
      '|---|------------|-------------|----------------|--------|\n';
  }

  for (const row of rows) {
    const safeName      = row.name.replace(/\|/g, '&#124;');
    const safeUrl       = row.expediaUrl.replace(/\|/g, '');
    const safeAffiliate = row.affiliateLink.replace(/\|/g, '');
    output += `| ${row.index} | ${safeName} | ${safeUrl} | ${safeAffiliate} | ${row.status} |\n`;
  }

  if (output) {
    if (force) {
      fs.writeFileSync(EXTRACT_PATH, output, 'utf8');
    } else {
      // Append new rows to existing file
      const existing = fs.existsSync(EXTRACT_PATH)
        ? fs.readFileSync(EXTRACT_PATH, 'utf8')
        : '# Mauritius Resort Finder Affiliate Inventory\n\n' +
          '| # | Hotel Name | Expedia URL | Affiliate Link | Status |\n' +
          '|---|------------|-------------|----------------|--------|\n';
      fs.writeFileSync(EXTRACT_PATH, existing.trimEnd() + '\n' + output, 'utf8');
    }
    log(`Wrote ${rows.length} new rows to Extract.md`);
  }

  // ── Update state ──────────────────────────────────────────────────────────

  state.lastExtractRun         = timestamp();
  state.lastProcessedHotelIndex = counter;
  state.completedHotels        = [
    ...new Set([...state.completedHotels, ...newCompleted]),
  ];
  state.failedHotels           = [
    ...state.failedHotels.filter(f => !newCompleted.includes(normaliseName(f.name))),
    ...newFailed,
  ];

  saveJSON(STATE_PATH, state);

  // ── Summary ───────────────────────────────────────────────────────────────

  const total     = counter;
  const verified  = state.completedHotels.length;
  const failed    = state.failedHotels.length;
  const gap       = Math.max(0, TARGET_HOTEL_COUNT - total);

  log('─'.repeat(60));
  log(`Extract complete`);
  log(`  Total hotels in inventory : ${total}`);
  log(`  Verified (affiliate link) : ${verified}`);
  log(`  Failed (no link)          : ${failed}`);
  if (gap > 0) {
    log(`  Gap to ${TARGET_HOTEL_COUNT}-hotel target    : ${gap} more hotels needed`);
    log(`  Action: add hotels to data/hotels.json via Airtable sync`);
  } else {
    log(`  Target of ${TARGET_HOTEL_COUNT} hotels reached`);
  }
  log('─'.repeat(60));

  return { total, verified, failed, gap, newRows: rows.length };
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
