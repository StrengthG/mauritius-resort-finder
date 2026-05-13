'use strict';

/**
 * seo_outreach.js
 * ────────────────────────────────────────────────────────────────────────────
 * CLI helper for the Mauritius Resort Finder backlink outreach programme.
 *
 * Usage:
 *   node seo_outreach.js                  → full pipeline summary
 *   node seo_outreach.js --type=guest_post → filter by outreach type
 *   node seo_outreach.js --status=not_started → filter by status
 *   node seo_outreach.js --priority       → top 5 next actions
 *   node seo_outreach.js --stats          → stats only (no table)
 *
 * The script reads seo_outreach_tracker.csv from the same directory and
 * produces a formatted terminal report. No writes are performed; the CSV
 * remains the source of truth.
 * ────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const CSV_PATH = path.join(__dirname, 'seo_outreach_tracker.csv');

const VALID_STATUSES = [
  'not_started',
  'contacted',
  'followed_up',
  'responded',
  'accepted',
  'declined',
  'live',
  'skip',
];

const VALID_TYPES = [
  'guest_post',
  'resource_link',
  'broken_link',
];

const STATUS_LABELS = {
  not_started:  'Not started',
  contacted:    'Contacted',
  followed_up:  'Followed up',
  responded:    'Responded',
  accepted:     'Accepted',
  declined:     'Declined',
  live:         'Live ✓',
  skip:         'Skip',
};

const TYPE_LABELS = {
  guest_post:    'Guest Post',
  resource_link: 'Resource Link',
  broken_link:   'Broken Link',
};

// ANSI colour helpers — degrade gracefully if stdout is not a TTY
const isTTY = process.stdout.isTTY;
const c = {
  reset:  isTTY ? '\x1b[0m'  : '',
  bold:   isTTY ? '\x1b[1m'  : '',
  dim:    isTTY ? '\x1b[2m'  : '',
  green:  isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan:   isTTY ? '\x1b[36m' : '',
  red:    isTTY ? '\x1b[31m' : '',
  magenta:isTTY ? '\x1b[35m' : '',
};

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a CSV file with a header row.
 * Handles commas inside quoted fields.
 *
 * @param  {string} csvText
 * @returns {Object[]}
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = _splitCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = _splitCSVLine(line);
    const record = {};
    headers.forEach((h, idx) => {
      record[h.trim()] = (values[idx] || '').trim();
    });
    records.push(record);
  }

  return records;
}

/**
 * Split one CSV line respecting double-quoted fields.
 *
 * @param  {string} line
 * @returns {string[]}
 */
function _splitCSVLine(line) {
  const result = [];
  let cur  = '';
  let inQ  = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQ) { inQ = true; continue; }
    if (ch === '"' && inQ)  { inQ = false; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Filter records by optional type and status flags.
 *
 * @param  {Object[]} records
 * @param  {Object}   filters  { type, status }
 * @returns {Object[]}
 */
function filterRecords(records, filters = {}) {
  return records.filter(r => {
    if (filters.type   && r.outreach_type !== filters.type)   return false;
    if (filters.status && r.status        !== filters.status) return false;
    return true;
  });
}

// ── Stats computation ─────────────────────────────────────────────────────────

/**
 * Compute aggregate statistics from a records array.
 *
 * @param  {Object[]} records
 * @returns {Object}
 */
function computeStats(records) {
  const byStatus = {};
  const byType   = {};
  let liveCount  = 0;
  let totalDA    = 0;
  let daCount    = 0;

  for (const r of records) {
    // status counts
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;

    // type counts
    byType[r.outreach_type] = (byType[r.outreach_type] || 0) + 1;

    // live links
    if (r.status === 'live') liveCount++;

    // DA average
    const da = parseInt(r.da_estimate, 10);
    if (!isNaN(da) && da > 0) { totalDA += da; daCount++; }
  }

  const contacted = (byStatus.contacted || 0) +
                    (byStatus.followed_up || 0) +
                    (byStatus.responded || 0) +
                    (byStatus.accepted || 0) +
                    (byStatus.live || 0) +
                    (byStatus.declined || 0);

  const responded = (byStatus.responded || 0) +
                    (byStatus.accepted || 0) +
                    (byStatus.live || 0);

  return {
    total:       records.length,
    byStatus,
    byType,
    liveCount,
    contacted,
    responded,
    avgDA: daCount > 0 ? Math.round(totalDA / daCount) : 0,
    responseRate: contacted > 0 ? Math.round((responded / contacted) * 100) : 0,
    conversionRate: contacted > 0 ? Math.round((liveCount / contacted) * 100) : 0,
  };
}

// ── Priority scoring ──────────────────────────────────────────────────────────

/**
 * Score a record to determine outreach priority.
 * Higher score = higher priority.
 *
 * Criteria:
 *   - not_started + broken_link → highest urgency
 *   - not_started + resource_link → high
 *   - not_started + guest_post → medium
 *   - contacted (pending follow-up) → also high
 *   - DA bonus
 *
 * @param  {Object} record
 * @returns {number}
 */
function priorityScore(record) {
  let score = 0;

  if (record.status === 'not_started') {
    if (record.outreach_type === 'broken_link')   score += 30;
    if (record.outreach_type === 'resource_link') score += 20;
    if (record.outreach_type === 'guest_post')    score += 15;
  } else if (record.status === 'contacted') {
    // follow-up needed
    score += 25;
  } else if (record.status === 'responded' || record.status === 'accepted') {
    score += 35; // close the deal
  }

  // DA bonus (0–10 extra points)
  const da = parseInt(record.da_estimate, 10);
  if (!isNaN(da)) score += Math.round(da / 10);

  return score;
}

/**
 * Return top N records by priority score, excluding inactive statuses.
 *
 * @param  {Object[]} records
 * @param  {number}   n
 * @returns {Object[]}
 */
function getTopPriority(records, n = 5) {
  const active = records.filter(r => !['live', 'declined', 'skip'].includes(r.status));
  return [...active]
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .slice(0, n);
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function _pad(str, len) {
  str = String(str || '');
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function _statusColour(status) {
  switch (status) {
    case 'live':       return c.green;
    case 'accepted':   return c.green;
    case 'responded':  return c.cyan;
    case 'followed_up':return c.yellow;
    case 'contacted':  return c.yellow;
    case 'declined':   return c.dim;
    case 'skip':       return c.dim;
    default:           return '';
  }
}

// ── Output sections ───────────────────────────────────────────────────────────

function printHeader(title) {
  const bar = '-'.repeat(72);
  console.log(`\n${c.bold}${bar}${c.reset}`);
  console.log(`${c.bold}  ${title}${c.reset}`);
  console.log(`${c.bold}${bar}${c.reset}`);
}

function printStats(stats) {
  printHeader('Pipeline Stats');
  console.log(`  ${c.bold}Total targets:${c.reset}   ${stats.total}`);
  console.log(`  ${c.bold}Live links:${c.reset}      ${c.green}${stats.liveCount}${c.reset}`);
  console.log(`  ${c.bold}Contacted:${c.reset}       ${stats.contacted}`);
  console.log(`  ${c.bold}Responded:${c.reset}       ${stats.responded}`);
  console.log(`  ${c.bold}Response rate:${c.reset}   ${stats.responseRate}%`);
  console.log(`  ${c.bold}Conversion rate:${c.reset} ${stats.conversionRate}%`);
  console.log(`  ${c.bold}Avg DA (target):${c.reset} ${stats.avgDA}`);

  console.log(`\n  ${c.bold}By status:${c.reset}`);
  for (const [st, n] of Object.entries(stats.byStatus)) {
    const colour = _statusColour(st);
    console.log(`    ${colour}${_pad(STATUS_LABELS[st] || st, 16)}${c.reset} ${n}`);
  }

  console.log(`\n  ${c.bold}By type:${c.reset}`);
  for (const [tp, n] of Object.entries(stats.byType)) {
    console.log(`    ${_pad(TYPE_LABELS[tp] || tp, 16)} ${n}`);
  }
}

function printTable(records) {
  if (records.length === 0) {
    console.log(`\n  ${c.dim}No records match the filter.${c.reset}`);
    return;
  }

  printHeader(`Records (${records.length})`);

  // Header row
  const header = [
    _pad('ID',   4),
    _pad('Site', 30),
    _pad('DA',   4),
    _pad('Type', 14),
    _pad('Status', 14),
    _pad('Target page', 28),
  ].join('  ');
  console.log(`  ${c.bold}${header}${c.reset}`);
  console.log('  ' + '-'.repeat(100));

  for (const r of records) {
    const colour = _statusColour(r.status);
    const row = [
      _pad(r.id,             4),
      _pad(r.site_name,     30),
      _pad(r.da_estimate,    4),
      _pad(TYPE_LABELS[r.outreach_type] || r.outreach_type, 14),
      _pad(STATUS_LABELS[r.status]      || r.status,        14),
      _pad(r.target_page,   28),
    ].join('  ');
    console.log(`  ${colour}${row}${c.reset}`);
  }
}

function printPriority(records) {
  const top = getTopPriority(records, 5);
  printHeader('Top 5 Next Actions');

  if (top.length === 0) {
    console.log(`  ${c.dim}All active targets complete or no targets found.${c.reset}`);
    return;
  }

  top.forEach((r, i) => {
    const colour = _statusColour(r.status);
    const action = r.status === 'contacted'
      ? 'Follow up'
      : r.status === 'responded' || r.status === 'accepted'
        ? 'Close / confirm'
        : 'Send initial email';

    console.log(`\n  ${c.bold}${i + 1}. ${r.site_name}${c.reset}  ${c.dim}(DA ${r.da_estimate})${c.reset}`);
    console.log(`     ${c.cyan}Action:${c.reset}   ${action}`);
    console.log(`     ${c.cyan}Type:${c.reset}     ${TYPE_LABELS[r.outreach_type] || r.outreach_type}`);
    console.log(`     ${c.cyan}Status:${c.reset}   ${colour}${STATUS_LABELS[r.status] || r.status}${c.reset}`);
    console.log(`     ${c.cyan}Page:${c.reset}     ${r.target_page}`);
    if (r.contact_email) {
      console.log(`     ${c.cyan}Contact:${c.reset}  ${r.contact_email}`);
    }
    if (r.notes) {
      console.log(`     ${c.dim}${r.notes}${c.reset}`);
    }
  });
}

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg === '--priority') { args.priority = true; continue; }
    if (arg === '--stats')    { args.stats    = true; continue; }
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Main entry point.
 *
 * @param  {string[]} argv  process.argv or equivalent
 * @returns {void}
 */
function main(argv) {
  // Load CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Error: CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const allRecords = parseCSV(csvText);

  if (allRecords.length === 0) {
    console.error('Error: CSV parsed to 0 records — check file format.');
    process.exit(1);
  }

  const args = parseArgs(argv);

  // Apply filters
  const filters = {};
  if (args.type   && VALID_TYPES.includes(args.type))     filters.type   = args.type;
  if (args.status && VALID_STATUSES.includes(args.status)) filters.status = args.status;
  const records = filterRecords(allRecords, filters);

  const stats = computeStats(records);

  // --stats only
  if (args.stats) {
    printStats(stats);
    console.log('');
    return;
  }

  // --priority only
  if (args.priority) {
    printPriority(records);
    console.log('');
    return;
  }

  // Full report: stats + priority + table
  printStats(stats);
  printPriority(records);
  printTable(records);
  console.log('');
}

// ── Module / CLI boundary ─────────────────────────────────────────────────────

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    console.error("Fatal error:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

module.exports = {
  parseCSV,
  filterRecords,
  computeStats,
  getTopPriority,
  priorityScore,
  parseArgs,
  main,
  // Exposed for testing
  _splitCSVLine,
};
