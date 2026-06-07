'use strict';

/**
 * seo_prospect_scorer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Scores and ranks link-building prospects on a 0–100 scale.
 *
 * Scoring formula (4 weighted components):
 *   DA score          40%  — Domain Authority proxy for link equity
 *   Relevance score   30%  — How closely the site's audience matches ours
 *   Traffic score     20%  — Referral potential (estimated tier)
 *   Link likelihood   10%  — Probability the site will actually link
 *
 * Works on any prospect object — both tracker CSV records (extended with
 * inference) and discovery database entries.
 *
 * Usage (CLI):
 *   node seo_prospect_scorer.js                  → score and rank all prospects
 *   node seo_prospect_scorer.js --top=20          → show top 20
 *   node seo_prospect_scorer.js --min_score=60    → filter by minimum score
 *   node seo_prospect_scorer.js --type=guest_post → filter by outreach type
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ── Scoring component functions ───────────────────────────────────────────────

/**
 * DA score contribution (max 40).
 * Uses stepped bands to reward meaningful authority differences.
 *
 * @param  {number} da  Domain Authority estimate (0–100)
 * @returns {number}
 */
function scoreDA(da) {
  const n = Number(da) || 0;
  if (n >= 80) return 40;
  if (n >= 70) return 34;
  if (n >= 60) return 28;
  if (n >= 50) return 22;
  if (n >= 40) return 16;
  if (n >= 30) return 10;
  return 5;
}

/**
 * Relevance score contribution (max 30).
 *
 * @param  {string} relevance  direct | strong | moderate | tangential
 * @returns {number}
 */
function scoreRelevance(relevance) {
  switch (relevance) {
    case 'direct':     return 30;
    case 'strong':     return 22;
    case 'moderate':   return 14;
    case 'tangential': return 6;
    default:           return 10;
  }
}

/**
 * Traffic tier score contribution (max 20).
 *
 * @param  {string} tier  high | medium | low_medium | low
 * @returns {number}
 */
function scoreTraffic(tier) {
  switch (tier) {
    case 'high':       return 20;
    case 'medium':     return 14;
    case 'low_medium': return 9;
    case 'low':        return 5;
    default:           return 8;
  }
}

/**
 * Link likelihood score contribution (max 10).
 *
 * @param  {string} likelihood  high | medium | low
 * @returns {number}
 */
function scoreLinkLikelihood(likelihood) {
  switch (likelihood) {
    case 'high':   return 10;
    case 'medium': return 7;
    case 'low':    return 4;
    default:       return 5;
  }
}

// ── Main scorer ───────────────────────────────────────────────────────────────

/**
 * Score a single prospect. Returns a number 0–100.
 * Prospect must have: da_estimate, relevance, traffic_tier, link_likelihood.
 *
 * @param  {Object} prospect
 * @returns {number}
 */
function scoreProspect(prospect) {
  const da  = parseInt(prospect.da_estimate, 10) || 0;
  const rel = prospect.relevance        || 'moderate';
  const tt  = prospect.traffic_tier     || 'low_medium';
  const ll  = prospect.link_likelihood  || 'medium';

  return scoreDA(da) + scoreRelevance(rel) + scoreTraffic(tt) + scoreLinkLikelihood(ll);
}

/**
 * Rank an array of prospects by score descending.
 * Returns new array — does not mutate input.
 *
 * @param  {Object[]} prospects
 * @returns {Object[]}  Same objects with `score` property added
 */
function rankProspects(prospects) {
  return prospects
    .map(p => ({ ...p, score: scoreProspect(p) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Determine the most appropriate link type based on prospect metadata.
 * Returns: 'guest_post' | 'resource_link' | 'broken_link'
 *
 * @param  {Object} prospect
 * @returns {string}
 */
function classifyLinkType(prospect) {
  if (prospect.outreach_type) return prospect.outreach_type;

  const da = parseInt(prospect.da_estimate, 10) || 0;
  const cat = (prospect.category || '').toLowerCase();

  // Directories and bodies → resource link
  if (cat === 'tourism_directory' || cat === 'university') return 'resource_link';
  // Very high DA media → resource link (guest posts rarely accepted cold)
  if (da >= 85) return 'resource_link';
  // Mid-range travel blogs → guest post
  if (da >= 40 && da <= 75 && cat === 'travel_blog') return 'guest_post';

  return 'resource_link';
}

// ── Score summary ─────────────────────────────────────────────────────────────

/**
 * Compute scoring distribution across a ranked prospect array.
 *
 * @param  {Object[]} rankedProspects  (must have .score property)
 * @returns {Object}  { tier90, tier70, tier50, tier50minus, avgScore }
 */
function scoreSummary(rankedProspects) {
  const scores = rankedProspects.map(p => p.score);
  const avg    = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  return {
    tier90:      scores.filter(s => s >= 90).length,
    tier70:      scores.filter(s => s >= 70 && s < 90).length,
    tier50:      scores.filter(s => s >= 50 && s < 70).length,
    tier50minus: scores.filter(s => s < 50).length,
    avgScore:    avg,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = {
  reset:   isTTY ? '\x1b[0m'  : '',
  bold:    isTTY ? '\x1b[1m'  : '',
  dim:     isTTY ? '\x1b[2m'  : '',
  green:   isTTY ? '\x1b[32m' : '',
  yellow:  isTTY ? '\x1b[33m' : '',
  cyan:    isTTY ? '\x1b[36m' : '',
  red:     isTTY ? '\x1b[31m' : '',
};

function _pad(str, len) {
  str = String(str || '');
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function _scoreBar(score) {
  const filled = Math.round(score / 5);
  const empty  = 20 - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

function _scoreColour(score) {
  if (score >= 80) return c.green;
  if (score >= 60) return c.cyan;
  if (score >= 45) return c.yellow;
  return c.dim;
}

if (require.main === module) {
  const { mergeWithTracker } = require('./seo_prospect_discovery.js');
  const { parseCSV }         = require('./seo_outreach.js');

  const args = process.argv.slice(2).reduce((acc, a) => {
    const m = a.match(/^--(\w+)=(.+)$/);
    if (m) acc[m[1]] = m[2];
    return acc;
  }, {});

  const CSV_PATH = path.join(__dirname, 'seo_outreach_tracker.csv');
  const csvRecords = fs.existsSync(CSV_PATH)
    ? parseCSV(fs.readFileSync(CSV_PATH, 'utf8'))
    : [];

  let prospects = mergeWithTracker(csvRecords);

  if (args.type)       prospects = prospects.filter(p => p.outreach_type === args.type);
  if (args.status)     prospects = prospects.filter(p => p.status        === args.status);
  if (args.category)   prospects = prospects.filter(p => p.category      === args.category);

  const ranked    = rankProspects(prospects);
  const topN      = parseInt(args.top || '30', 10);
  const minScore  = parseInt(args.min_score || '0', 10);
  const displayed = ranked.filter(p => p.score >= minScore).slice(0, topN);

  const summary = scoreSummary(ranked);

  console.log(`\n${c.bold}═══ Prospect Scorer — ${ranked.length} prospects ═══${c.reset}`);
  console.log(`  Average score: ${c.bold}${summary.avgScore}${c.reset}`);
  console.log(`  Score ≥ 90:  ${summary.tier90}`);
  console.log(`  Score 70–89: ${summary.tier70}`);
  console.log(`  Score 50–69: ${summary.tier50}`);
  console.log(`  Score < 50:  ${summary.tier50minus}`);

  console.log(`\n${c.bold}  ${'#'.padEnd(3)} ${'Site'.padEnd(32)} ${'DA'.padEnd(4)} ${'Score'.padEnd(5)} ${'Bar'.padEnd(22)} Type${c.reset}`);
  console.log('  ' + '─'.repeat(85));

  displayed.forEach((p, i) => {
    const col  = _scoreColour(p.score);
    const bar  = _scoreBar(p.score);
    const type = (p.outreach_type || '').replace('_', ' ').slice(0, 13);
    console.log(
      `  ${col}${String(i + 1).padEnd(3)} ${_pad(p.site_name, 32)} ${_pad(p.da_estimate, 4)} ${_pad(p.score, 5)} ${bar} ${type}${c.reset}`
    );
  });

  console.log(`\n  ${c.dim}Flags: --top=N  --min_score=N  --type=guest_post  --status=not_started  --category=travel_blog${c.reset}\n`);
}

module.exports = {
  scoreDA,
  scoreRelevance,
  scoreTraffic,
  scoreLinkLikelihood,
  scoreProspect,
  rankProspects,
  classifyLinkType,
  scoreSummary,
};
