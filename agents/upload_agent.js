/**
 * UploadAgent — Mauritius Resort Finder Agent Pipeline
 *
 * Validates Sort.md, cross-checks affiliate links against hotels.json,
 * rebuilds the site, runs tests, commits, and pushes to GitHub.
 *
 * Usage:
 *   node agents/upload_agent.js [--dry-run]
 *
 * Flags:
 *   --dry-run   Build and validate but do not commit or push.
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '..');
const HOTELS_PATH  = path.join(ROOT, 'data', 'hotels.json');
const EXTRACT_PATH = path.join(ROOT, 'data', 'Extract.md');
const SORT_PATH    = path.join(ROOT, 'data', 'Sort.md');
const STATE_PATH   = path.join(ROOT, 'data', 'state.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[UploadAgent] ${msg}`); }
function warn(msg) { console.warn(`[UploadAgent] WARN  ${msg}`); }
function err(msg)  { console.error(`[UploadAgent] ERROR ${msg}`); }

function timestamp() { return new Date().toISOString(); }

function normaliseName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function shell(cmd, label) {
  log(`  $ ${label || cmd}`);
  try {
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, output };
  } catch (e) {
    return { ok: false, output: e.stdout || '', stderr: e.stderr || '', error: e.message };
  }
}

// ── Sort.md parser ────────────────────────────────────────────────────────────

/**
 * Parse Sort.md and extract all ranked rows as:
 *   [{ rank, hotelName, score, affiliateLink }]
 */
function parseSortRows() {
  if (!fs.existsSync(SORT_PATH)) {
    throw new Error(`Sort.md not found at ${SORT_PATH}. Run SortAgent first.`);
  }

  const lines = fs.readFileSync(SORT_PATH, 'utf8').split('\n');
  const rows  = [];

  for (const line of lines) {
    // Rank rows start with | number |
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 4) continue;

    const rank          = parseInt(parts[0], 10);
    const hotelName     = parts[1];
    const score         = parseFloat(parts[2]);
    // Affiliate link is last column
    const affiliateLink = parts[parts.length - 1];

    if (isNaN(rank) || !hotelName || hotelName === 'Hotel') continue;
    rows.push({ rank, hotelName, score, affiliateLink });
  }

  return rows;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateSortRows(rows, hotelsLookup) {
  const errors   = [];
  const warnings = [];

  const seen = new Map(); // normalisedName → first seen affiliateLink

  for (const row of rows) {
    const key = normaliseName(row.hotelName);

    // 1. Affiliate link must be non-empty
    if (!row.affiliateLink) {
      errors.push(`"${row.hotelName}" has an empty affiliate link`);
      continue;
    }

    // 2. Affiliate link format check
    if (!row.affiliateLink.includes('expedia.com/affiliate/')) {
      errors.push(`"${row.hotelName}" affiliate link does not look like an Expedia Creator URL: ${row.affiliateLink}`);
    }

    // 3. Cross-check against hotels.json
    const hotel = hotelsLookup.get(key);
    if (!hotel) {
      warnings.push(`"${row.hotelName}" found in Sort.md but not in hotels.json`);
    } else {
      const jsonLink = ((hotel._affiliate_links || []).find(l => l.provider === 'expedia') || {}).booking_url;
      if (jsonLink && jsonLink !== row.affiliateLink) {
        errors.push(
          `Affiliate link mismatch for "${row.hotelName}": ` +
          `Sort.md has "${row.affiliateLink}" but hotels.json has "${jsonLink}"`
        );
      }
    }

    // 4. Consistency: same hotel must have same link across all persona tables
    if (seen.has(key)) {
      if (seen.get(key) !== row.affiliateLink) {
        errors.push(
          `Inconsistent affiliate link for "${row.hotelName}" across persona tables`
        );
      }
    } else {
      seen.set(key, row.affiliateLink);
    }
  }

  return { errors, warnings };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  const dryRun = process.argv.includes('--dry-run');
  log(`Starting — ${timestamp()}${dryRun ? ' (dry-run)' : ''}`);

  // ── Load state ────────────────────────────────────────────────────────────

  let state = {};
  if (fs.existsSync(STATE_PATH)) {
    try { state = loadJSON(STATE_PATH); } catch (_) {}
  }

  // ── Parse Sort.md ─────────────────────────────────────────────────────────

  log('Parsing Sort.md...');
  const sortRows = parseSortRows();
  log(`  ${sortRows.length} ranked rows found across all personas`);

  // ── Load hotels.json for cross-check ──────────────────────────────────────

  const hotels      = loadJSON(HOTELS_PATH);
  const hotelLookup = new Map();
  for (const h of hotels) {
    hotelLookup.set(normaliseName(h.hotel_name || ''), h);
  }

  // ── Validate ──────────────────────────────────────────────────────────────

  log('Validating Sort.md against hotels.json...');
  const { errors, warnings } = validateSortRows(sortRows, hotelLookup);

  warnings.forEach(w => warn(`  ${w}`));

  if (errors.length > 0) {
    errors.forEach(e => err(`  ${e}`));
    err(`Validation failed with ${errors.length} error(s). Aborting upload.`);
    process.exit(1);
  }

  log(`  Validation passed — ${sortRows.length} rows, 0 errors, ${warnings.length} warnings`);

  // ── Verify no empty Check Price CTAs ─────────────────────────────────────

  const rowsMissingLink = sortRows.filter(r => !r.affiliateLink);
  if (rowsMissingLink.length > 0) {
    err(`${rowsMissingLink.length} hotel(s) have no affiliate link — every hotel card must have a Check Price CTA.`);
    rowsMissingLink.forEach(r => err(`  Missing: ${r.hotelName}`));
    process.exit(1);
  }

  // ── Rebuild site ──────────────────────────────────────────────────────────

  log('Building site...');
  const buildResult = shell('node site_builder.js', 'node site_builder.js');

  if (!buildResult.ok) {
    err('site_builder.js failed:');
    err(buildResult.stderr || buildResult.output);
    process.exit(1);
  }

  // Check build output for success
  const buildOut = buildResult.output;
  if (!buildOut.includes('Build complete') && !buildOut.includes('succeeded')) {
    err('Build output did not confirm success. Manual review required.');
    err(buildOut.slice(-500));
    process.exit(1);
  }

  // Extract page count from build output
  const pagesMatch = buildOut.match(/Pages:\s*(\d+)\/(\d+)/);
  if (pagesMatch) {
    log(`  Build: ${pagesMatch[0]}`);
    if (pagesMatch[1] !== pagesMatch[2]) {
      err(`Build had failures: ${pagesMatch[0]}`);
      process.exit(1);
    }
  } else {
    log('  Build completed (page count not found in output)');
  }

  // ── Run tests ─────────────────────────────────────────────────────────────

  log('Running test suite...');
  const testResult = shell('node run_tests.js', 'node run_tests.js');

  if (!testResult.ok) {
    err('Test suite failed:');
    err(testResult.stderr || testResult.output);
    process.exit(1);
  }

  const testOut = testResult.output;
  const passMatch = testOut.match(/TOTAL:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
  if (passMatch) {
    const passed = parseInt(passMatch[1], 10);
    const failed = parseInt(passMatch[2], 10);
    log(`  Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      err(`${failed} test(s) failed. Aborting upload.`);
      process.exit(1);
    }
  } else {
    // Fallback: check for error indicators
    if (testOut.includes('failed') && !testOut.includes('0 failed')) {
      err('Tests appear to have failures. Check output manually.');
      process.exit(1);
    }
    log('  Tests passed');
  }

  // ── Check for Check Price CTAs in built pages ─────────────────────────────

  log('Spot-checking built pages for affiliate CTAs...');
  const distDir    = path.join(ROOT, 'dist');
  const samplePage = path.join(distDir, 'best-luxury-hotels-mauritius', 'index.html');

  if (fs.existsSync(samplePage)) {
    const html = fs.readFileSync(samplePage, 'utf8');
    const ctaCount = (html.match(/Check prices/gi) || []).length;
    const affCount = (html.match(/expedia\.com\/affiliate\//g) || []).length;
    log(`  ${path.basename(path.dirname(samplePage))}: ${ctaCount} CTA(s), ${affCount} affiliate link(s)`);
    if (ctaCount === 0 || affCount === 0) {
      warn('  No affiliate CTAs found on sample page — review site_builder output');
    }
  }

  if (dryRun) {
    log('Dry-run mode — skipping commit and push.');
    log('─'.repeat(60));
    log('Upload (dry-run) complete — build and tests passed.');
    log('─'.repeat(60));
    return { dryRun: true };
  }

  // ── Git commit ────────────────────────────────────────────────────────────

  log('Committing...');

  // Stage source files (never dist/)
  const filesToStage = [
    'data/Extract.md',
    'data/Sort.md',
    'data/state.json',
  ].filter(f => fs.existsSync(path.join(ROOT, f)));

  if (filesToStage.length === 0) {
    warn('No pipeline output files to stage.');
  } else {
    const stageResult = shell(
      `git add ${filesToStage.map(f => `"${f}"`).join(' ')}`,
      `git add pipeline outputs`
    );
    if (!stageResult.ok) {
      warn(`git add warning: ${stageResult.stderr}`);
    }
  }

  // Check if there's actually anything to commit
  const statusResult = shell('git status --short', 'git status --short');
  if (statusResult.output.trim() === '') {
    log('Nothing to commit — pipeline outputs are unchanged.');
  } else {
    const now         = new Date().toISOString().slice(0, 10);
    const hotelCount  = [...new Set(sortRows.map(r => normaliseName(r.hotelName)))].size;
    const commitMsg   = [
      `data: update affiliate links and persona rankings ${now}`,
      '',
      `- Extract.md: ${hotelCount} verified hotels with Expedia Creator links`,
      `- Sort.md: ${sortRows.length} ranked entries across 6 personas`,
      '- All affiliate links validated against hotels.json',
      '',
      'Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>',
    ].join('\n');

    const commitResult = shell(
      `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`,
      'git commit'
    );

    if (!commitResult.ok && !commitResult.output.includes('nothing to commit')) {
      err('git commit failed:');
      err(commitResult.stderr);
      process.exit(1);
    }
  }

  // ── Git push ──────────────────────────────────────────────────────────────

  log('Pushing to origin main...');
  const pushResult = shell('git push origin main', 'git push origin main');

  if (!pushResult.ok) {
    err('git push failed:');
    err(pushResult.stderr || pushResult.output);
    process.exit(1);
  }

  log('  Pushed successfully');

  // ── Update state ──────────────────────────────────────────────────────────

  const updatedState = { ...state, lastUploadRun: timestamp() };
  saveJSON(STATE_PATH, updatedState);

  // ── Summary ───────────────────────────────────────────────────────────────

  log('─'.repeat(60));
  log('Upload complete');
  log(`  Hotels validated : ${[...new Set(sortRows.map(r => normaliseName(r.hotelName)))].size}`);
  log(`  Ranked rows      : ${sortRows.length}`);
  log(`  Build            : passed`);
  log(`  Tests            : passed`);
  log(`  Git              : pushed`);
  log('─'.repeat(60));

  return { success: true, sortRows: sortRows.length };
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
