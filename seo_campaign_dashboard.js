'use strict';

/**
 * seo_campaign_dashboard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 90-day backlink campaign dashboard.
 * Shows live progress, funnel metrics, velocity chart, and next actions.
 * Optionally exports a self-contained HTML report.
 *
 * Goal: 50 live quality backlinks by Day 90 (2026-09-04).
 *
 * Usage (CLI):
 *   node seo_campaign_dashboard.js          → terminal dashboard
 *   node seo_campaign_dashboard.js --html   → export HTML report to ./seo-report.html
 *   node seo_campaign_dashboard.js --html --output=report.html
 *   node seo_campaign_dashboard.js --report → weekly progress text (copy/paste)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

const CAMPAIGN_START  = new Date('2026-06-07');
const CAMPAIGN_END    = new Date('2026-09-04');
const CAMPAIGN_DAYS   = 90;
const LINK_GOAL       = 50;

// Funnel rate assumptions (conservative)
const RESPONSE_RATE    = 0.25;
const ACCEPT_RATE      = 0.60;
const PUBLISH_RATE     = 0.80;
const CONVERSION_RATE  = RESPONSE_RATE * ACCEPT_RATE * PUBLISH_RATE; // ≈ 12%

// ── Data loading ──────────────────────────────────────────────────────────────

/**
 * Load and merge all prospect data.
 *
 * @returns {Object[]}
 */
function loadCampaignData() {
  const { mergeWithTracker } = require('./seo_prospect_discovery.js');
  const { parseCSV }         = require('./seo_outreach.js');

  const CSV_PATH = path.join(__dirname, 'seo_outreach_tracker.csv');
  const csvRecords = fs.existsSync(CSV_PATH)
    ? parseCSV(fs.readFileSync(CSV_PATH, 'utf8'))
    : [];

  return mergeWithTracker(csvRecords);
}

// ── Metrics ───────────────────────────────────────────────────────────────────

/**
 * Compute all campaign metrics from merged prospect array.
 *
 * @param  {Object[]} prospects
 * @returns {Object}
 */
function generateReport(prospects) {
  const today   = new Date();
  const dayNum  = Math.max(1, Math.floor((today - CAMPAIGN_START) / 86_400_000) + 1);
  const weekNum = Math.ceil(dayNum / 7);
  const pctDone = Math.min(100, Math.round((dayNum / CAMPAIGN_DAYS) * 100));

  const total       = prospects.length;
  const notStarted  = prospects.filter(p => p.status === 'not_started').length;
  const contacted   = prospects.filter(p => ['contacted', 'followed_up'].includes(p.status)).length;
  const responded   = prospects.filter(p => ['responded', 'accepted'].includes(p.status)).length;
  const liveLinks   = prospects.filter(p => p.status === 'live').length;
  const declined    = prospects.filter(p => p.status === 'declined').length;
  const skipped     = prospects.filter(p => p.status === 'skip').length;
  const activeCount = contacted + responded;

  const responseRate   = activeCount > 0 ? Math.round(((responded + liveLinks) / (contacted + responded + liveLinks + declined)) * 100) : 0;
  const conversionRate = (contacted + responded + liveLinks) > 0
    ? Math.round((liveLinks / (contacted + responded + liveLinks + declined)) * 100) : 0;

  const daysLeft      = Math.max(0, CAMPAIGN_DAYS - dayNum);
  const linksNeeded   = Math.max(0, LINK_GOAL - liveLinks);
  const onTrack       = (liveLinks / Math.max(1, dayNum)) * CAMPAIGN_DAYS;
  const projected     = Math.round(onTrack);

  // To hit goal: how many contacts needed from here?
  const contactsToGoal = linksNeeded > 0
    ? Math.ceil(linksNeeded / CONVERSION_RATE)
    : 0;

  // Weekly velocity: contacts per week (from tracker dates)
  const weeklyVelocity = _computeWeeklyVelocity(prospects);

  // DA distribution of live + accepted links
  const successLinks = prospects.filter(p => p.status === 'live' || p.status === 'accepted');
  const avgLiveDA    = successLinks.length
    ? Math.round(successLinks.reduce((s, p) => s + (parseInt(p.da_estimate, 10) || 0), 0) / successLinks.length)
    : 0;

  return {
    dayNum, weekNum, pctDone, daysLeft,
    total, notStarted, contacted, responded, liveLinks, declined, skipped,
    activeCount, responseRate, conversionRate,
    linksNeeded, projected, contactsToGoal,
    weeklyVelocity,
    avgLiveDA,
    successLinks: successLinks.length,
  };
}

/**
 * Compute contacts-per-week from date_contacted field.
 * Returns array of { week, count } for the last 8 weeks.
 *
 * @param  {Object[]} prospects
 * @returns {Array<{ week: number, count: number }>}
 */
function _computeWeeklyVelocity(prospects) {
  const result = {};
  for (const p of prospects) {
    if (!p.date_contacted) continue;
    const d = new Date(p.date_contacted);
    if (isNaN(d)) continue;
    const w = Math.ceil(Math.max(1, Math.floor((d - CAMPAIGN_START) / 86_400_000) + 1) / 7);
    if (w >= 1 && w <= 13) result[w] = (result[w] || 0) + 1;
  }
  // Fill gaps
  const rows = [];
  for (let w = 1; w <= 13; w++) {
    rows.push({ week: w, count: result[w] || 0 });
  }
  return rows;
}

// ── Terminal dashboard ────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = {
  reset:   isTTY ? '\x1b[0m'  : '',
  bold:    isTTY ? '\x1b[1m'  : '',
  dim:     isTTY ? '\x1b[2m'  : '',
  green:   isTTY ? '\x1b[32m' : '',
  yellow:  isTTY ? '\x1b[33m' : '',
  cyan:    isTTY ? '\x1b[36m' : '',
  red:     isTTY ? '\x1b[31m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
};

function _progressBar(pct, width = 40) {
  const filled = Math.round((pct / 100) * width);
  const empty  = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function _statusColour(pct) {
  if (pct >= 80) return c.green;
  if (pct >= 50) return c.yellow;
  return c.red;
}

/**
 * Print the full terminal dashboard.
 *
 * @param  {Object[]} prospects  Merged prospect array
 * @param  {Object}   opts       { compact: bool }
 */
function printDashboard(prospects, opts = {}) {
  const r = generateReport(prospects);
  const WIDTH = 64;
  const LINE  = '═'.repeat(WIDTH);

  console.log(`\n${c.bold}${LINE}${c.reset}`);
  console.log(`${c.bold}  Mauritius Resort Finder — Backlink Campaign${c.reset}`);
  console.log(`${c.bold}  Goal: ${LINK_GOAL} live links by ${CAMPAIGN_END.toISOString().slice(0, 10)}${c.reset}`);
  console.log(`${c.bold}${LINE}${c.reset}`);

  // ── Campaign timeline ──────────────────────────────────────────────────────
  const tlCol = _statusColour(r.pctDone);
  console.log(`\n  ${c.bold}Timeline${c.reset}`);
  console.log(`  Day ${r.dayNum} / ${CAMPAIGN_DAYS}  (Week ${r.weekNum})   ${r.daysLeft} days remaining`);
  console.log(`  ${tlCol}[${_progressBar(r.pctDone, 44)}]${c.reset} ${r.pctDone}%`);

  // ── Goal progress ──────────────────────────────────────────────────────────
  const goalPct = Math.min(100, Math.round((r.liveLinks / LINK_GOAL) * 100));
  const goalCol = _statusColour(goalPct);
  console.log(`\n  ${c.bold}Link Goal${c.reset}`);
  console.log(`  Live: ${c.bold}${c.green}${r.liveLinks}${c.reset} / ${LINK_GOAL}   Needed: ${r.linksNeeded}`);
  console.log(`  ${goalCol}[${_progressBar(goalPct, 44)}]${c.reset} ${goalPct}%`);

  if (r.projected < LINK_GOAL && r.daysLeft > 0) {
    const gap = LINK_GOAL - r.projected;
    console.log(`  ${c.yellow}At current pace: ~${r.projected} by Day 90 (${gap} short of goal)${c.reset}`);
    console.log(`  ${c.yellow}Need ~${r.contactsToGoal} more outreach contacts to bridge the gap${c.reset}`);
  } else if (r.liveLinks >= LINK_GOAL) {
    console.log(`  ${c.green}✓ Goal achieved!${c.reset}`);
  } else {
    console.log(`  ${c.green}On track — projected ${r.projected} links by Day 90${c.reset}`);
  }

  // ── Funnel ─────────────────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Pipeline Funnel${c.reset}`);
  const funnelWidth = 44;
  const steps = [
    { label: 'Total prospects', count: r.total,      ref: r.total },
    { label: 'Not started',     count: r.notStarted, ref: r.total },
    { label: 'Contacted',       count: r.contacted,  ref: r.total },
    { label: 'Responded',       count: r.responded,  ref: r.total },
    { label: 'Live',            count: r.liveLinks,  ref: r.total },
  ];

  for (const step of steps) {
    const pct  = step.ref > 0 ? Math.round((step.count / step.ref) * 100) : 0;
    const col  = step.label === 'Live' ? c.green : step.label === 'Responded' ? c.cyan : '';
    const bar  = _progressBar(pct, funnelWidth);
    console.log(`  ${col}${step.label.padEnd(18)}${c.reset} ${String(step.count).padEnd(4)} ${c.dim}${bar}${c.reset}`);
  }

  // ── Rates ──────────────────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Conversion Rates${c.reset}`);
  console.log(`  Response rate:    ${r.responseRate}%  ${c.dim}(target: 25%)${c.reset}`);
  console.log(`  Conversion rate:  ${r.conversionRate}%  ${c.dim}(target: 12%)${c.reset}`);
  if (r.avgLiveDA > 0) {
    console.log(`  Avg DA of live:   ${r.avgLiveDA}`);
  }

  // ── Weekly velocity chart ──────────────────────────────────────────────────
  if (!opts.compact) {
    const maxCount = Math.max(1, ...r.weeklyVelocity.map(v => v.count));
    const chartH   = 5;
    const barChar  = '▓';
    const today    = new Date();
    const currentW = Math.ceil(Math.max(1, Math.floor((today - CAMPAIGN_START) / 86_400_000) + 1) / 7);

    console.log(`\n  ${c.bold}Weekly Contact Velocity${c.reset}  (contacts sent)`);

    for (let row = chartH; row >= 1; row--) {
      const threshold = Math.round((row / chartH) * maxCount);
      let line = '  ';
      for (const v of r.weeklyVelocity) {
        const barH = Math.round((v.count / maxCount) * chartH);
        const isNow = v.week === currentW;
        const col = isNow ? c.cyan : v.count > 0 ? c.green : '';
        line += (barH >= row ? `${col}${barChar}${c.reset}` : ' ') + ' ';
      }
      console.log(line + `  ${c.dim}${row === chartH ? maxCount : ''}${c.reset}`);
    }

    // X-axis labels
    let xAxis = '  ';
    for (const v of r.weeklyVelocity) {
      xAxis += String(v.week).padEnd(2);
    }
    console.log(xAxis + `  ${c.dim}week${c.reset}`);
  }

  // ── Declined / skipped ─────────────────────────────────────────────────────
  if (r.declined > 0 || r.skipped > 0) {
    console.log(`\n  ${c.bold}Inactive${c.reset}`);
    if (r.declined > 0) console.log(`  Declined: ${r.declined}`);
    if (r.skipped  > 0) console.log(`  Skipped:  ${r.skipped}`);
  }

  console.log(`\n${c.bold}${LINE}${c.reset}\n`);
}

// ── Weekly report text ────────────────────────────────────────────────────────

/**
 * Generate a human-readable weekly progress report (copy/paste ready).
 *
 * @param  {Object[]} prospects
 * @returns {string}
 */
function weeklyReportText(prospects) {
  const r   = generateReport(prospects);
  const now = new Date().toISOString().slice(0, 10);

  return [
    `## Backlink Campaign — Week ${r.weekNum} Report (${now})`,
    '',
    `**Campaign progress:** Day ${r.dayNum} of ${CAMPAIGN_DAYS} (${r.pctDone}% complete)`,
    `**Link goal:** ${r.liveLinks} / ${LINK_GOAL} live (${LINK_GOAL - r.liveLinks} remaining)`,
    '',
    '### Pipeline',
    `| Stage | Count |`,
    `|---|---|`,
    `| Total prospects | ${r.total} |`,
    `| Not started | ${r.notStarted} |`,
    `| Contacted | ${r.contacted} |`,
    `| Responded | ${r.responded} |`,
    `| Live | **${r.liveLinks}** |`,
    `| Declined | ${r.declined} |`,
    '',
    '### Rates',
    `- Response rate: **${r.responseRate}%** (target 25%)`,
    `- Conversion to live: **${r.conversionRate}%** (target 12%)`,
    r.avgLiveDA > 0 ? `- Average DA of live links: **${r.avgLiveDA}**` : '',
    '',
    '### Projection',
    r.projected >= LINK_GOAL
      ? `On track to hit ${LINK_GOAL} links by Day 90.`
      : `At current pace: ~${r.projected} links by Day 90 (${LINK_GOAL - r.projected} short). Need ~${r.contactsToGoal} more contacts.`,
    '',
    '### Next steps',
    `1. Send this week's batch of ${Math.min(10, r.notStarted)} outreach emails`,
    `2. Follow up with any contacts 7+ days without response`,
    `3. Update tracker CSV with responses received`,
  ].filter(l => l !== null).join('\n');
}

// ── HTML report ───────────────────────────────────────────────────────────────

/**
 * Export a self-contained HTML dashboard report.
 *
 * @param  {Object[]} prospects
 * @param  {string}   outputPath
 */
function exportHTMLReport(prospects, outputPath) {
  const r   = generateReport(prospects);
  const now = new Date().toISOString().slice(0, 10);

  const goalPct     = Math.min(100, Math.round((r.liveLinks / LINK_GOAL) * 100));
  const timelinePct = r.pctDone;

  const velBars = r.weeklyVelocity.map(v => {
    const pct = Math.round((v.count / Math.max(1, ...r.weeklyVelocity.map(x => x.count))) * 100);
    return `<div class="vel-bar" style="height:${Math.max(4, pct)}%" title="Week ${v.week}: ${v.count} contacts"><span>${v.count || ''}</span></div>`;
  }).join('');

  // Top 20 prospects by score
  const { rankProspects } = require('./seo_prospect_scorer.js');
  const ranked = rankProspects(prospects).slice(0, 20);
  const topRows = ranked.map(p => `
    <tr>
      <td>${p.site_name}</td>
      <td>${p.da_estimate}</td>
      <td>${p.score}</td>
      <td>${(p.outreach_type || '').replace('_', ' ')}</td>
      <td class="status-${p.status}">${p.status.replace('_', ' ')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Backlink Campaign Report — ${now}</title>
<style>
  :root { --green:#2ecc71; --yellow:#f39c12; --red:#e74c3c; --blue:#3498db; --dark:#1a1a2e; --card:#16213e; --text:#eee; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: var(--dark); color: var(--text); padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .08em; color: #aaa; margin: 24px 0 12px; }
  .subtitle { color: #aaa; font-size: .875rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: var(--card); border-radius: 8px; padding: 16px; }
  .card .val { font-size: 2rem; font-weight: 700; }
  .card .lbl { font-size: .8rem; color: #aaa; margin-top: 2px; }
  .card.green .val { color: var(--green); }
  .card.yellow .val { color: var(--yellow); }
  .card.blue .val { color: var(--blue); }
  .progress-wrap { background: #333; border-radius: 4px; height: 12px; margin: 8px 0 4px; }
  .progress-fill { border-radius: 4px; height: 100%; transition: width .3s; }
  .progress-fill.green { background: var(--green); }
  .progress-fill.yellow { background: var(--yellow); }
  .progress-fill.red { background: var(--red); }
  .prog-label { font-size: .75rem; color: #aaa; }
  .vel-chart { display: flex; align-items: flex-end; gap: 6px; height: 80px; background: var(--card); border-radius: 8px; padding: 12px; margin-bottom: 24px; }
  .vel-bar { min-width: 24px; background: var(--blue); border-radius: 4px 4px 0 0; flex: 1; position: relative; display: flex; align-items: flex-start; justify-content: center; }
  .vel-bar span { font-size: 10px; color: #fff; padding-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 8px; overflow: hidden; font-size: .875rem; }
  th { text-align: left; padding: 10px 12px; background: #0d0d2b; color: #aaa; font-size: .75rem; text-transform: uppercase; }
  td { padding: 8px 12px; border-bottom: 1px solid #1f2a4a; }
  .status-live { color: var(--green); font-weight: 600; }
  .status-declined { color: var(--red); }
  .status-responded { color: var(--blue); }
  .status-contacted, .status-followed_up { color: var(--yellow); }
  .report-footer { text-align: center; color: #555; font-size: .75rem; margin-top: 24px; }
</style>
</head>
<body>
<h1>Mauritius Resort Finder — Backlink Campaign</h1>
<p class="subtitle">Goal: ${LINK_GOAL} live links by ${CAMPAIGN_END.toISOString().slice(0, 10)} · Report generated ${now}</p>

<h2>Campaign Progress</h2>
<div style="background:var(--card);border-radius:8px;padding:16px;margin-bottom:12px">
  <div class="prog-label">Timeline — Day ${r.dayNum} of ${CAMPAIGN_DAYS} (${r.daysLeft} days left)</div>
  <div class="progress-wrap"><div class="progress-fill ${timelinePct >= 80 ? 'green' : timelinePct >= 40 ? 'yellow' : 'red'}" style="width:${timelinePct}%"></div></div>
  <div class="prog-label">Link goal — ${r.liveLinks} / ${LINK_GOAL} live (${goalPct}%)</div>
  <div class="progress-wrap"><div class="progress-fill ${goalPct >= 80 ? 'green' : goalPct >= 40 ? 'yellow' : 'red'}" style="width:${goalPct}%"></div></div>
</div>

<div class="grid">
  <div class="card green"><div class="val">${r.liveLinks}</div><div class="lbl">Live links</div></div>
  <div class="card blue"><div class="val">${r.responded}</div><div class="lbl">Responded</div></div>
  <div class="card yellow"><div class="val">${r.contacted}</div><div class="lbl">Contacted</div></div>
  <div class="card"><div class="val">${r.total}</div><div class="lbl">Total prospects</div></div>
  <div class="card"><div class="val">${r.responseRate}%</div><div class="lbl">Response rate</div></div>
  <div class="card"><div class="val">${r.projected}</div><div class="lbl">Projected at Day 90</div></div>
</div>

<h2>Weekly Contact Velocity</h2>
<div class="vel-chart">${velBars}</div>

<h2>Top 20 Prospects by Score</h2>
<table>
<thead><tr><th>Site</th><th>DA</th><th>Score</th><th>Type</th><th>Status</th></tr></thead>
<tbody>${topRows}</tbody>
</table>

<p class="report-footer">mauritius-resort-finder · seo_campaign_dashboard.js · ${now}</p>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2).reduce((acc, a) => {
    if (a === '--html')   { acc.html   = true; return acc; }
    if (a === '--report') { acc.report = true; return acc; }
    const m = a.match(/^--(\w+)=(.+)$/);
    if (m) acc[m[1]] = m[2];
    return acc;
  }, {});

  const prospects = loadCampaignData();

  if (args.report) {
    console.log(weeklyReportText(prospects));
    console.log('');
    process.exit(0);
  }

  if (args.html) {
    const outPath = args.output || path.join(__dirname, 'seo-report.html');
    exportHTMLReport(prospects, outPath);
    console.log(`HTML report written to: ${outPath}`);
    process.exit(0);
  }

  printDashboard(prospects);
}

module.exports = {
  loadCampaignData,
  generateReport,
  printDashboard,
  weeklyReportText,
  exportHTMLReport,
  // exposed for testing
  _computeWeeklyVelocity,
  CAMPAIGN_START,
  CAMPAIGN_END,
  LINK_GOAL,
  CONVERSION_RATE,
};
