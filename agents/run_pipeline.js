/**
 * run_pipeline.js — Mauritius Resort Finder Agent Orchestrator
 *
 * Runs the full three-agent pipeline in sequence:
 *   1. ExtractAgent → data/Extract.md
 *   2. SortAgent    → data/Sort.md
 *   3. UploadAgent  → rebuild + test + commit + push
 *
 * Usage:
 *   node agents/run_pipeline.js [options]
 *
 * Options:
 *   --force      Reprocess all agents from scratch
 *   --dry-run    Build and validate but do not push
 *   --extract    Run ExtractAgent only
 *   --sort       Run SortAgent only
 *   --upload     Run UploadAgent only
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '..');
const EXTRACT_PATH = path.join(ROOT, 'data', 'Extract.md');
const SORT_PATH    = path.join(ROOT, 'data', 'Sort.md');
const STATE_PATH   = path.join(ROOT, 'data', 'state.json');
const LOG_DIR      = path.join(ROOT, 'data', 'logs');
const REPORT_PATH  = path.join(LOG_DIR, 'latest_pipeline_report.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[Pipeline] ${msg}`); }
function warn(msg) { console.warn(`[Pipeline] WARN  ${msg}`); }
function err(msg)  { console.error(`[Pipeline] ERROR ${msg}`); }

function timestamp() { return new Date().toISOString(); }

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return {}; }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function banner(title) {
  const line = '═'.repeat(60);
  log(line);
  log(`  ${title}`);
  log(line);
}

// ── Validation gates ──────────────────────────────────────────────────────────

function validateExtractOutput() {
  if (!fs.existsSync(EXTRACT_PATH)) {
    return { ok: false, reason: 'Extract.md does not exist' };
  }
  const content = fs.readFileSync(EXTRACT_PATH, 'utf8');
  const rows    = content.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
  const verified = rows.filter(l => l.includes('| Verified |') || l.endsWith('| Verified |'));

  if (rows.length === 0) {
    return { ok: false, reason: 'Extract.md has no data rows' };
  }
  if (verified.length === 0) {
    return { ok: false, reason: 'Extract.md has no Verified rows' };
  }

  return { ok: true, total: rows.length, verified: verified.length };
}

function validateSortOutput() {
  if (!fs.existsSync(SORT_PATH)) {
    return { ok: false, reason: 'Sort.md does not exist' };
  }
  const content  = fs.readFileSync(SORT_PATH, 'utf8');
  const rows     = content.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
  const withLink = rows.filter(l => l.includes('expedia.com/affiliate/'));

  if (rows.length === 0) {
    return { ok: false, reason: 'Sort.md has no ranked rows' };
  }

  const missingLinks = rows.length - withLink.length;
  return { ok: true, rows: rows.length, withLink: withLink.length, missingLinks };
}

// ── Report writer ─────────────────────────────────────────────────────────────

function writeReport({ startTime, endTime, stages, extractVal, sortVal }) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const durationMs = new Date(endTime) - new Date(startTime);
  const durationS  = (durationMs / 1000).toFixed(1);

  const stageRows = stages.map(s =>
    `| ${s.name.padEnd(14)} | ${s.status.padEnd(8)} | ${(s.note || '').slice(0, 60)} |`
  ).join('\n');

  const report = [
    `# Pipeline Report — ${startTime.slice(0, 10)}`,
    '',
    `**Run started:** ${startTime}  `,
    `**Run ended:**   ${endTime}  `,
    `**Duration:**    ${durationS}s  `,
    '',
    '## Stage Results',
    '',
    '| Stage          | Status   | Notes                                                        |',
    '|----------------|----------|--------------------------------------------------------------|',
    stageRows,
    '',
    '## Extract Summary',
    '',
    extractVal
      ? `- Total rows: ${extractVal.total}  \n- Verified: ${extractVal.verified}`
      : '- Not run',
    '',
    '## Sort Summary',
    '',
    sortVal
      ? `- Ranked rows: ${sortVal.rows}  \n- Rows with affiliate link: ${sortVal.withLink}  \n- Missing links: ${sortVal.missingLinks}`
      : '- Not run',
    '',
    '## Next Steps',
    '',
    `- Review \`data/Extract.md\` for any Failed rows`,
    `- If hotel count is below 100, add more hotels to \`data/hotels.json\``,
    `- Run \`node agents/run_pipeline.js\` again after adding hotels`,
    '',
  ].join('\n');

  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  log(`Report written to ${path.relative(ROOT, REPORT_PATH)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const args    = process.argv.slice(2);
  const force   = args.includes('--force');
  const dryRun  = args.includes('--dry-run');
  const only    = args.find(a => ['--extract', '--sort', '--upload'].includes(a));

  // Inject flags into process.argv for sub-agents
  if (force   && !process.argv.includes('--force'))   process.argv.push('--force');
  if (dryRun  && !process.argv.includes('--dry-run'))  process.argv.push('--dry-run');

  const startTime = timestamp();
  const stages    = [];

  banner('Mauritius Resort Finder — Agent Pipeline');
  log(`Started: ${startTime}`);
  if (force)  log('Mode: --force (full rebuild)');
  if (dryRun) log('Mode: --dry-run (no push)');
  if (only)   log(`Mode: ${only} only`);

  let extractVal = null;
  let sortVal    = null;

  // ── Stage 1: ExtractAgent ─────────────────────────────────────────────────

  if (!only || only === '--extract') {
    banner('Stage 1 — ExtractAgent');
    try {
      const { run: extract } = require('./extract_agent');
      const result = extract();
      extractVal = validateExtractOutput();

      if (!extractVal.ok) {
        throw new Error(`ExtractAgent output invalid: ${extractVal.reason}`);
      }

      stages.push({
        name: 'ExtractAgent',
        status: 'OK',
        note: `${extractVal.verified}/${extractVal.total} verified, gap ${result.gap} to target`,
      });
      log(`Stage 1 passed — ${extractVal.verified} verified hotels in Extract.md`);
    } catch (e) {
      stages.push({ name: 'ExtractAgent', status: 'FAILED', note: e.message });
      err(`Stage 1 FAILED: ${e.message}`);
      if (!only) {
        err('Aborting pipeline — ExtractAgent must succeed before SortAgent.');
        writeReport({ startTime, endTime: timestamp(), stages, extractVal, sortVal });
        process.exit(1);
      }
    }
  }

  // ── Stage 2: SortAgent ────────────────────────────────────────────────────

  if (!only || only === '--sort') {
    banner('Stage 2 — SortAgent');

    // Pre-condition check
    if (!only) {
      extractVal = extractVal || validateExtractOutput();
      if (!extractVal.ok) {
        err(`Cannot run SortAgent: ${extractVal.reason}`);
        stages.push({ name: 'SortAgent', status: 'SKIPPED', note: 'Extract.md invalid' });
      }
    }

    if (!stages.find(s => s.name === 'SortAgent')) {
      try {
        const { run: sort } = require('./sort_agent');
        sort();
        sortVal = validateSortOutput();

        if (!sortVal.ok) {
          throw new Error(`SortAgent output invalid: ${sortVal.reason}`);
        }

        stages.push({
          name: 'SortAgent',
          status: 'OK',
          note: `${sortVal.rows} ranked rows, ${sortVal.withLink} with affiliate links`,
        });
        log(`Stage 2 passed — ${sortVal.rows} ranked rows in Sort.md`);

        if (sortVal.missingLinks > 0) {
          warn(`${sortVal.missingLinks} ranked row(s) are missing affiliate links`);
        }
      } catch (e) {
        stages.push({ name: 'SortAgent', status: 'FAILED', note: e.message });
        err(`Stage 2 FAILED: ${e.message}`);
        if (!only) {
          err('Aborting pipeline — SortAgent must succeed before UploadAgent.');
          writeReport({ startTime, endTime: timestamp(), stages, extractVal, sortVal });
          process.exit(1);
        }
      }
    }
  }

  // ── Stage 3: UploadAgent ──────────────────────────────────────────────────

  if (!only || only === '--upload') {
    banner('Stage 3 — UploadAgent');

    // Pre-condition check
    if (!only) {
      sortVal = sortVal || validateSortOutput();
      if (!sortVal.ok) {
        err(`Cannot run UploadAgent: ${sortVal.reason}`);
        stages.push({ name: 'UploadAgent', status: 'SKIPPED', note: 'Sort.md invalid' });
      }
    }

    if (!stages.find(s => s.name === 'UploadAgent')) {
      try {
        const { run: upload } = require('./upload_agent');
        const result = upload();
        const note   = dryRun ? 'dry-run: built + validated, no push' : 'built, tested, pushed';

        stages.push({ name: 'UploadAgent', status: 'OK', note });
        log(`Stage 3 passed — ${note}`);
      } catch (e) {
        stages.push({ name: 'UploadAgent', status: 'FAILED', note: e.message });
        err(`Stage 3 FAILED: ${e.message}`);
      }
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────

  const endTime  = timestamp();
  const allOk    = stages.every(s => s.status === 'OK');

  writeReport({ startTime, endTime, stages, extractVal, sortVal });

  banner(allOk ? 'Pipeline Complete — All stages passed' : 'Pipeline Complete — Some stages failed');
  stages.forEach(s => {
    const icon = s.status === 'OK' ? '✓' : s.status === 'SKIPPED' ? '−' : '✗';
    log(`  ${icon} ${s.name.padEnd(14)} ${s.status.padEnd(8)} ${s.note || ''}`);
  });
  log(`Duration: ${((new Date(endTime) - new Date(startTime)) / 1000).toFixed(1)}s`);

  process.exit(allOk ? 0 : 1);
}

// ── Entry point ───────────────────────────────────────────────────────────────

run().catch(e => {
  console.error(`[Pipeline] Fatal: ${e.message}`);
  process.exit(1);
});
