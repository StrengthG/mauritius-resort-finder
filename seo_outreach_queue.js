'use strict';

/**
 * seo_outreach_queue.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a prioritised outreach queue and 90-day follow-up schedule from
 * the combined tracker + discovery prospect pool.
 *
 * Queue strategy:
 *   Week 1–2   High-likelihood quick wins (broken_link, resource_link, high likelihood)
 *   Week 3–5   Mid-DA guest post pitches (DA 50–75)
 *   Week 6–9   Warm follow-ups + high-DA resource pitches
 *   Week 10–13 Cleanup, academic/directory outreach, residual pitches
 *
 * Follow-up schedule:
 *   Day 0  → Initial contact
 *   Day 7  → First follow-up (no response)
 *   Day 14 → Final follow-up (still no response)
 *   Day 21 → Mark skip if still silent
 *
 * Usage (CLI):
 *   node seo_outreach_queue.js             → this week's actions
 *   node seo_outreach_queue.js --week=3    → week 3 batch
 *   node seo_outreach_queue.js --full      → full 13-week schedule
 *   node seo_outreach_queue.js --json      → machine-readable output
 *   node seo_outreach_queue.js --followups → follow-ups due this week
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

const CAMPAIGN_START = new Date('2026-06-07');
const CAMPAIGN_DAYS  = 90;
const BATCH_SIZE     = 10;   // contacts per week

// Follow-up intervals in days from initial contact
const FOLLOWUP_1_DAYS = 7;
const FOLLOWUP_2_DAYS = 14;
const SKIP_DAYS       = 21;

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function weekNumberFromStart(targetDate, startDate) {
  const msPerDay  = 86_400_000;
  const days      = Math.floor((targetDate - startDate) / msPerDay);
  return Math.max(1, Math.ceil((days + 1) / 7));
}

function currentWeek() {
  return weekNumberFromStart(new Date(), CAMPAIGN_START);
}

// ── Queue generation ──────────────────────────────────────────────────────────

/**
 * Assign a week number to a prospect based on its priority characteristics.
 * Lower week = sooner = higher priority.
 *
 * @param  {Object} prospect  (with score, outreach_type, link_likelihood)
 * @returns {number}  Week 1–13
 */
function _assignWeek(prospect) {
  const score = prospect.score || 0;
  const type  = prospect.outreach_type || '';
  const ll    = prospect.link_likelihood || 'medium';
  const status = prospect.status || 'not_started';

  // Already responded/accepted → contact immediately regardless of anything else
  if (status === 'responded' || status === 'accepted') return 1;

  // Broken links: quick wins, week 1–2
  if (type === 'broken_link') return ll === 'high' ? 1 : 2;

  // High-score resource links: weeks 2–4
  if (type === 'resource_link') {
    if (score >= 70) return 2;
    if (score >= 55) return 3;
    return 4;
  }

  // Guest posts: mid-run after resource links established
  if (type === 'guest_post') {
    if (score >= 75) return 3;
    if (score >= 60) return 4;
    if (score >= 50) return 5;
    if (score >= 40) return 7;
    return 9;
  }

  // Low-score fallback
  if (score >= 70) return 4;
  if (score >= 55) return 6;
  return 10;
}

/**
 * Generate a full outreach queue from a ranked prospect array.
 * Only includes prospects with status 'not_started'.
 *
 * @param  {Object[]} rankedProspects  (with .score from rankProspects())
 * @param  {Object}   opts
 * @param  {number}   [opts.batchSize=10]
 * @returns {Array<{ week: number, prospects: Object[] }>}
 */
function generateQueue(rankedProspects, opts = {}) {
  const batchSize = opts.batchSize || BATCH_SIZE;

  const actionable = rankedProspects.filter(p =>
    p.status === 'not_started' || p.status === 'responded' || p.status === 'accepted',
  );

  // Assign week targets
  const withWeeks = actionable.map(p => ({ ...p, targetWeek: _assignWeek(p) }));

  // Group by week, then trim each week to batchSize
  const byWeek = {};
  for (const p of withWeeks) {
    const w = p.targetWeek;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push(p);
  }

  const weeks = Object.keys(byWeek)
    .map(Number)
    .sort((a, b) => a - b);

  // Overflow: if a week has > batchSize, push surplus to next week
  const finalQueue = [];
  let overflow = [];

  for (const w of weeks) {
    const batch = [...overflow, ...byWeek[w]].slice(0, batchSize * 2); // cap total
    const thisBatch = batch.slice(0, batchSize);
    overflow = batch.slice(batchSize);

    const weekStart = addDays(CAMPAIGN_START, (w - 1) * 7);
    finalQueue.push({
      week:      w,
      weekStart: formatDate(weekStart),
      weekEnd:   formatDate(addDays(weekStart, 6)),
      prospects: thisBatch,
    });
  }

  // Flush remaining overflow into extra weeks
  while (overflow.length > 0) {
    const lastWeek = (finalQueue[finalQueue.length - 1]?.week || 0) + 1;
    const thisBatch = overflow.slice(0, batchSize);
    overflow = overflow.slice(batchSize);
    const weekStart = addDays(CAMPAIGN_START, (lastWeek - 1) * 7);
    finalQueue.push({
      week:      lastWeek,
      weekStart: formatDate(weekStart),
      weekEnd:   formatDate(addDays(weekStart, 6)),
      prospects: thisBatch,
    });
  }

  return finalQueue;
}

/**
 * Generate follow-up schedule for already-contacted prospects.
 *
 * @param  {Object[]} contactedProspects  (status: contacted | followed_up)
 * @returns {Array<{ date: string, action: string, prospect: Object }>}
 */
function generateFollowUpSchedule(contactedProspects) {
  const schedule = [];

  for (const p of contactedProspects) {
    if (!p.date_contacted) continue;
    const contacted = new Date(p.date_contacted);
    if (isNaN(contacted)) continue;

    if (p.status === 'contacted' && !p.date_followed_up) {
      const due = addDays(contacted, FOLLOWUP_1_DAYS);
      schedule.push({ date: formatDate(due), action: 'follow_up_1', prospect: p });
    }

    if (p.status === 'followed_up' && p.date_followed_up) {
      const followed = new Date(p.date_followed_up);
      if (!isNaN(followed)) {
        const due = addDays(followed, FOLLOWUP_2_DAYS - FOLLOWUP_1_DAYS);
        schedule.push({ date: formatDate(due), action: 'follow_up_2', prospect: p });
      }
    }
  }

  return schedule.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Return the outreach batch for a given week number.
 *
 * @param  {Array}  queue
 * @param  {number} week
 * @returns {Object|null}
 */
function getWeekBatch(queue, week) {
  return queue.find(q => q.week === week) || null;
}

/**
 * Return all follow-ups due within the next N days from today.
 *
 * @param  {Object[]} schedule
 * @param  {number}   days
 * @returns {Object[]}
 */
function getDueFollowUps(schedule, days = 7) {
  const today = new Date();
  const limit = addDays(today, days);
  return schedule.filter(s => {
    const d = new Date(s.date);
    return d >= today && d <= limit;
  });
}

// ── Output helpers ────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = {
  reset:   isTTY ? '\x1b[0m'  : '',
  bold:    isTTY ? '\x1b[1m'  : '',
  dim:     isTTY ? '\x1b[2m'  : '',
  green:   isTTY ? '\x1b[32m' : '',
  yellow:  isTTY ? '\x1b[33m' : '',
  cyan:    isTTY ? '\x1b[36m' : '',
};

function _pad(str, len) {
  str = String(str || '');
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function printQueue(queue, opts = {}) {
  const weeks = opts.week ? queue.filter(q => q.week === opts.week) : queue;

  for (const wk of weeks) {
    console.log(`\n${c.bold}Week ${wk.week}  ${wk.weekStart} → ${wk.weekEnd}${c.reset}  (${wk.prospects.length} contacts)`);
    console.log('  ' + '─'.repeat(90));

    const header = [
      _pad('#', 3),
      _pad('Site', 30),
      _pad('DA', 4),
      _pad('Sc', 4),
      _pad('Type', 14),
      _pad('Target page', 28),
    ].join('  ');
    console.log(`  ${c.bold}${header}${c.reset}`);

    wk.prospects.forEach((p, i) => {
      const type = (p.outreach_type || '').replace('_', ' ').slice(0, 13);
      const row  = [
        _pad(i + 1, 3),
        _pad(p.site_name, 30),
        _pad(p.da_estimate, 4),
        _pad(p.score || '—', 4),
        _pad(type, 14),
        _pad(p.target_page, 28),
      ].join('  ');
      console.log(`  ${c.cyan}${row}${c.reset}`);
    });
  }
}

function printFollowUps(schedule) {
  if (schedule.length === 0) {
    console.log(`\n  ${c.dim}No follow-ups due.${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}Follow-ups due (${schedule.length})${c.reset}`);
  console.log('  ' + '─'.repeat(72));

  for (const s of schedule) {
    const label = s.action === 'follow_up_1' ? 'Follow-up 1' : 'Final follow-up';
    console.log(`  ${c.yellow}${s.date}${c.reset}  ${label.padEnd(15)} ${s.prospect.site_name} ${c.dim}(${s.prospect.contact_email || 'no email'})${c.reset}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const { mergeWithTracker }  = require('./seo_prospect_discovery.js');
  const { rankProspects }     = require('./seo_prospect_scorer.js');
  const { parseCSV }          = require('./seo_outreach.js');

  const args = process.argv.slice(2).reduce((acc, a) => {
    if (a === '--full')      { acc.full      = true; return acc; }
    if (a === '--json')      { acc.json      = true; return acc; }
    if (a === '--followups') { acc.followups = true; return acc; }
    const m = a.match(/^--(\w+)=(.+)$/);
    if (m) acc[m[1]] = m[2];
    return acc;
  }, {});

  const CSV_PATH = path.join(__dirname, 'seo_outreach_tracker.csv');
  const csvRecords = fs.existsSync(CSV_PATH)
    ? parseCSV(fs.readFileSync(CSV_PATH, 'utf8'))
    : [];

  const merged  = mergeWithTracker(csvRecords);
  const ranked  = rankProspects(merged);
  const queue   = generateQueue(ranked);

  const contacted = merged.filter(p => ['contacted', 'followed_up'].includes(p.status));
  const schedule  = generateFollowUpSchedule(contacted);

  if (args.json) {
    console.log(JSON.stringify({ queue, followUpSchedule: schedule }, null, 2));
    process.exit(0);
  }

  const today  = new Date();
  const week   = args.week ? parseInt(args.week, 10) : weekNumberFromStart(today, CAMPAIGN_START);
  const dayNum = Math.floor((today - CAMPAIGN_START) / 86_400_000) + 1;

  console.log(`\n${c.bold}═══ Outreach Queue — Day ${dayNum} of ${CAMPAIGN_DAYS} ═══${c.reset}`);
  console.log(`  Campaign: ${formatDate(CAMPAIGN_START)} → ${formatDate(addDays(CAMPAIGN_START, CAMPAIGN_DAYS - 1))}`);
  console.log(`  Total actionable: ${ranked.filter(p => p.status === 'not_started').length}`);
  console.log(`  Total weeks planned: ${queue.length}`);

  if (args.followups) {
    const due = getDueFollowUps(schedule, 7);
    printFollowUps(due);
  } else if (args.full) {
    printQueue(queue);
  } else {
    const batch = getWeekBatch(queue, week);
    if (batch) {
      printQueue([batch]);
    } else {
      console.log(`\n  ${c.dim}No batch scheduled for week ${week}.${c.reset}`);
    }
  }

  const dueFollowUps = getDueFollowUps(schedule, 7);
  if (!args.followups && dueFollowUps.length > 0) {
    console.log(`\n  ${c.yellow}⚠  ${dueFollowUps.length} follow-up(s) due this week — run --followups to view${c.reset}`);
  }

  console.log('');
}

module.exports = {
  generateQueue,
  generateFollowUpSchedule,
  getWeekBatch,
  getDueFollowUps,
  printQueue,
  printFollowUps,
  // exposed for testing
  _assignWeek,
  addDays,
  formatDate,
  weekNumberFromStart,
  currentWeek,
  CAMPAIGN_START,
  CAMPAIGN_DAYS,
  BATCH_SIZE,
  FOLLOWUP_1_DAYS,
  FOLLOWUP_2_DAYS,
  SKIP_DAYS,
};
