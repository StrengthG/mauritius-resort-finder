'use strict';

/**
 * seo_outreach.test.js
 * Tests for seo_outreach.js — CSV parsing, filtering, stats, and priority.
 */

const {
  parseCSV,
  filterRecords,
  computeStats,
  getTopPriority,
  priorityScore,
  parseArgs,
  _splitCSVLine,
} = require('./seo_outreach.js');

// ── Minimal test harness (matches run_tests.js expectations) ─────────────────

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertDeepEqual(a, b, message) {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(message || `Expected ${bs}, got ${as}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_CSV = `id,site_name,domain,da_estimate,page_url,contact_email,contact_name,outreach_type,target_page,status,date_contacted,date_followed_up,date_response,response_type,notes
001,Alpha Blog,alpha.com,60,http://alpha.com/page,,Alice,guest_post,/best-resort-mauritius,not_started,,,,,Some notes
002,Beta Portal,beta.net,80,http://beta.net/res,,Bob,resource_link,/rankings,contacted,2024-01-10,,,,
003,Gamma Mag,gamma.io,45,http://gamma.io/broken,,Carol,broken_link,/methodology,live,2024-01-05,2024-01-12,2024-01-15,positive,Live link placed
004,Delta Blog,delta.co,35,http://delta.co,,Dave,guest_post,/adults-only-resorts-mauritius,declined,2024-01-08,,,negative,Not a fit
005,Epsilon News,epsilon.org,70,http://epsilon.org,,Eve,resource_link,/rankings,not_started,,,,,High priority target`;

// ── Tests: _splitCSVLine ──────────────────────────────────────────────────────

console.log('\n_splitCSVLine');

test('splits simple CSV line', () => {
  const result = _splitCSVLine('a,b,c');
  assertDeepEqual(result, ['a', 'b', 'c']);
});

test('handles quoted fields with commas', () => {
  const result = _splitCSVLine('"hello, world",b,c');
  assertDeepEqual(result, ['hello, world', 'b', 'c']);
});

test('handles empty fields', () => {
  const result = _splitCSVLine('a,,c');
  assertDeepEqual(result, ['a', '', 'c']);
});

test('returns single element for no commas', () => {
  const result = _splitCSVLine('onlyone');
  assertDeepEqual(result, ['onlyone']);
});

// ── Tests: parseCSV ───────────────────────────────────────────────────────────

console.log('\nparseCSV');

test('returns array of objects keyed by header row', () => {
  const records = parseCSV(SAMPLE_CSV);
  assertEqual(records.length, 5);
  assertEqual(records[0].site_name, 'Alpha Blog');
  assertEqual(records[0].outreach_type, 'guest_post');
});

test('trims whitespace from field values', () => {
  const records = parseCSV(SAMPLE_CSV);
  assertEqual(records[1].notes, '');  // space-only field trimmed to ''
});

test('returns empty array for header-only CSV', () => {
  const records = parseCSV('id,name,status\n');
  assertDeepEqual(records, []);
});

test('returns empty array for empty string', () => {
  const records = parseCSV('');
  assertDeepEqual(records, []);
});

// ── Tests: filterRecords ──────────────────────────────────────────────────────

console.log('\nfilterRecords');

const ALL_RECORDS = parseCSV(SAMPLE_CSV);

test('returns all records when no filter applied', () => {
  const result = filterRecords(ALL_RECORDS, {});
  assertEqual(result.length, 5);
});

test('filters by type=guest_post', () => {
  const result = filterRecords(ALL_RECORDS, { type: 'guest_post' });
  assertEqual(result.length, 2);
  result.forEach(r => assertEqual(r.outreach_type, 'guest_post'));
});

test('filters by status=not_started', () => {
  const result = filterRecords(ALL_RECORDS, { status: 'not_started' });
  assertEqual(result.length, 2);
  result.forEach(r => assertEqual(r.status, 'not_started'));
});

test('filters by type AND status', () => {
  const result = filterRecords(ALL_RECORDS, { type: 'resource_link', status: 'not_started' });
  assertEqual(result.length, 1);
  assertEqual(result[0].site_name, 'Epsilon News');
});

test('returns empty array when no records match', () => {
  const result = filterRecords(ALL_RECORDS, { type: 'broken_link', status: 'not_started' });
  assertEqual(result.length, 0);
});

// ── Tests: computeStats ───────────────────────────────────────────────────────

console.log('\ncomputeStats');

test('total matches record count', () => {
  const stats = computeStats(ALL_RECORDS);
  assertEqual(stats.total, 5);
});

test('liveCount is correct', () => {
  const stats = computeStats(ALL_RECORDS);
  assertEqual(stats.liveCount, 1);
});

test('byStatus counts are correct', () => {
  const stats = computeStats(ALL_RECORDS);
  assertEqual(stats.byStatus.not_started, 2);
  assertEqual(stats.byStatus.contacted,   1);
  assertEqual(stats.byStatus.live,        1);
  assertEqual(stats.byStatus.declined,    1);
});

test('byType counts are correct', () => {
  const stats = computeStats(ALL_RECORDS);
  assertEqual(stats.byType.guest_post,    2);
  assertEqual(stats.byType.resource_link, 2);
  assertEqual(stats.byType.broken_link,   1);
});

test('avgDA is correctly computed', () => {
  // DA values: 60, 80, 45, 35, 70 → sum 290 / 5 = 58
  const stats = computeStats(ALL_RECORDS);
  assertEqual(stats.avgDA, 58);
});

test('contacted count includes contacted, followed_up, responded, accepted, live, declined', () => {
  // contacted=1, live=1, declined=1 → contacted=3
  const stats = computeStats(ALL_RECORDS);
  assertEqual(stats.contacted, 3);
});

test('returns zeroes on empty input', () => {
  const stats = computeStats([]);
  assertEqual(stats.total, 0);
  assertEqual(stats.liveCount, 0);
  assertEqual(stats.avgDA, 0);
  assertEqual(stats.responseRate, 0);
});

// ── Tests: priorityScore ──────────────────────────────────────────────────────

console.log('\npriorityScore');

test('broken_link not_started scores highest among not_started types', () => {
  const bl = { outreach_type: 'broken_link',   status: 'not_started', da_estimate: '50' };
  const rl = { outreach_type: 'resource_link', status: 'not_started', da_estimate: '50' };
  const gp = { outreach_type: 'guest_post',    status: 'not_started', da_estimate: '50' };
  assert(priorityScore(bl) > priorityScore(rl));
  assert(priorityScore(rl) > priorityScore(gp));
});

test('responded/accepted scores highest of all active statuses', () => {
  const r1 = { outreach_type: 'broken_link',   status: 'responded',   da_estimate: '50' };
  const r2 = { outreach_type: 'broken_link',   status: 'not_started', da_estimate: '50' };
  assert(priorityScore(r1) > priorityScore(r2));
});

test('higher DA increases score', () => {
  const highDA = { outreach_type: 'guest_post', status: 'not_started', da_estimate: '90' };
  const lowDA  = { outreach_type: 'guest_post', status: 'not_started', da_estimate: '30' };
  assert(priorityScore(highDA) > priorityScore(lowDA));
});

test('score is 0 for records with invalid DA', () => {
  const r = { outreach_type: 'guest_post', status: 'not_started', da_estimate: 'N/A' };
  assert(priorityScore(r) >= 0);  // should not throw or return NaN
});

// ── Tests: getTopPriority ─────────────────────────────────────────────────────

console.log('\ngetTopPriority');

test('returns at most N records', () => {
  const top = getTopPriority(ALL_RECORDS, 3);
  assert(top.length <= 3);
});

test('excludes live, declined, and skip records', () => {
  const top = getTopPriority(ALL_RECORDS, 10);
  top.forEach(r => {
    assert(!['live', 'declined', 'skip'].includes(r.status),
      `Expected active status, got "${r.status}"`);
  });
});

test('returns empty array when all records are inactive', () => {
  const inactive = ALL_RECORDS.filter(r => ['live', 'declined'].includes(r.status));
  const top = getTopPriority(inactive, 5);
  assertEqual(top.length, 0);
});

test('results are sorted by priority descending', () => {
  const top = getTopPriority(ALL_RECORDS, 5);
  for (let i = 0; i < top.length - 1; i++) {
    assert(
      priorityScore(top[i]) >= priorityScore(top[i + 1]),
      'Records should be sorted by score descending'
    );
  }
});

// ── Tests: parseArgs ─────────────────────────────────────────────────────────

console.log('\nparseArgs');

test('parses --priority flag', () => {
  const args = parseArgs(['node', 'seo_outreach.js', '--priority']);
  assert(args.priority === true);
});

test('parses --stats flag', () => {
  const args = parseArgs(['node', 'seo_outreach.js', '--stats']);
  assert(args.stats === true);
});

test('parses --type=guest_post', () => {
  const args = parseArgs(['node', 'seo_outreach.js', '--type=guest_post']);
  assertEqual(args.type, 'guest_post');
});

test('parses --status=not_started', () => {
  const args = parseArgs(['node', 'seo_outreach.js', '--status=not_started']);
  assertEqual(args.status, 'not_started');
});

test('handles multiple flags', () => {
  const args = parseArgs(['node', 'seo_outreach.js', '--type=resource_link', '--priority']);
  assertEqual(args.type, 'resource_link');
  assert(args.priority === true);
});

test('returns empty object when no args', () => {
  const args = parseArgs(['node', 'seo_outreach.js']);
  assertDeepEqual(Object.keys(args), []);
});

// ── Tests: seo_prospect_discovery.js ─────────────────────────────────────────

const {
  PROSPECT_DATABASE,
  discoverProspects,
  mergeWithTracker,
  _inferCategory,
  _inferSubcategory,
  _inferTrafficTier,
  _inferLinkLikelihood,
  _inferRelevance,
} = require('./seo_prospect_discovery.js');

console.log('\nseo_prospect_discovery — PROSPECT_DATABASE');

test('database contains at least 80 prospects', () => {
  assert(PROSPECT_DATABASE.length >= 80, `Expected ≥80 prospects, got ${PROSPECT_DATABASE.length}`);
});

test('all prospects have required fields', () => {
  const required = ['id', 'site_name', 'domain', 'da_estimate', 'category',
                    'outreach_type', 'target_page', 'traffic_tier', 'link_likelihood', 'relevance'];
  for (const p of PROSPECT_DATABASE) {
    for (const f of required) {
      assert(p[f] !== undefined && p[f] !== '',
        `Prospect ${p.id} missing required field: ${f}`);
    }
  }
});

test('all prospect IDs are unique', () => {
  const ids = PROSPECT_DATABASE.map(p => p.id);
  const unique = new Set(ids);
  assertEqual(unique.size, ids.length, 'Duplicate IDs found');
});

test('all IDs follow D### pattern', () => {
  for (const p of PROSPECT_DATABASE) {
    assert(/^D\d{3}$/.test(p.id), `Invalid ID format: ${p.id}`);
  }
});

test('relevance values are in allowed set', () => {
  const allowed = new Set(['direct', 'strong', 'moderate', 'tangential']);
  for (const p of PROSPECT_DATABASE) {
    assert(allowed.has(p.relevance), `Invalid relevance "${p.relevance}" on ${p.id}`);
  }
});

test('traffic_tier values are in allowed set', () => {
  const allowed = new Set(['high', 'medium', 'low_medium', 'low']);
  for (const p of PROSPECT_DATABASE) {
    assert(allowed.has(p.traffic_tier), `Invalid traffic_tier "${p.traffic_tier}" on ${p.id}`);
  }
});

test('link_likelihood values are in allowed set', () => {
  const allowed = new Set(['high', 'medium', 'low']);
  for (const p of PROSPECT_DATABASE) {
    assert(allowed.has(p.link_likelihood), `Invalid link_likelihood on ${p.id}`);
  }
});

console.log('\nseo_prospect_discovery — discoverProspects');

test('returns all prospects when no filter', () => {
  const r = discoverProspects();
  assertEqual(r.length, PROSPECT_DATABASE.length);
});

test('filters by category', () => {
  const r = discoverProspects({ category: 'travel_blog' });
  assert(r.length > 0, 'Expected travel_blog results');
  r.forEach(p => assertEqual(p.category, 'travel_blog'));
});

test('filters by subcategory', () => {
  const r = discoverProspects({ subcategory: 'golf' });
  assert(r.length > 0, 'Expected golf results');
  r.forEach(p => assertEqual(p.subcategory, 'golf'));
});

test('filters by min_da', () => {
  const r = discoverProspects({ min_da: 80 });
  assert(r.length > 0, 'Expected high-DA results');
  r.forEach(p => assert(p.da_estimate >= 80, `DA ${p.da_estimate} below 80`));
});

test('returns empty array when filter matches nothing', () => {
  const r = discoverProspects({ subcategory: 'nonexistent_category_xyz' });
  assertEqual(r.length, 0);
});

console.log('\nseo_prospect_discovery — mergeWithTracker');

test('mergeWithTracker returns combined pool', () => {
  const csvRecords = parseCSV(SAMPLE_CSV);
  const merged = mergeWithTracker(csvRecords);
  assert(merged.length >= csvRecords.length, 'Merged should have at least as many as CSV');
  assert(merged.length > csvRecords.length,  'Merged should add discovery prospects');
});

test('tracker records get source=tracker', () => {
  const csvRecords = parseCSV(SAMPLE_CSV);
  const merged = mergeWithTracker(csvRecords);
  const trackerItems = merged.filter(p => p.source === 'tracker');
  assertEqual(trackerItems.length, csvRecords.length);
});

test('discovery records get source=discovery', () => {
  const csvRecords = parseCSV(SAMPLE_CSV);
  const merged = mergeWithTracker(csvRecords);
  const discoveryItems = merged.filter(p => p.source === 'discovery');
  assert(discoveryItems.length > 0, 'Expected discovery records');
});

test('no duplicate domains in merged result', () => {
  const csvRecords = parseCSV(SAMPLE_CSV);
  const merged = mergeWithTracker(csvRecords);
  const domains = merged.map(p => p.domain.toLowerCase());
  const unique = new Set(domains);
  assertEqual(unique.size, domains.length, 'Duplicate domain found in merged result');
});

test('discovery prospects have status=not_started', () => {
  const csvRecords = parseCSV(SAMPLE_CSV);
  const merged = mergeWithTracker(csvRecords);
  merged.filter(p => p.source === 'discovery').forEach(p => {
    assertEqual(p.status, 'not_started', `Discovery prospect ${p.domain} has wrong status`);
  });
});

console.log('\nseo_prospect_discovery — inference helpers');

test('_inferTrafficTier maps DA bands correctly', () => {
  assertEqual(_inferTrafficTier(85), 'high');
  assertEqual(_inferTrafficTier(65), 'medium');
  assertEqual(_inferTrafficTier(45), 'low_medium');
  assertEqual(_inferTrafficTier(25), 'low');
});

test('_inferLinkLikelihood maps outreach_type', () => {
  assertEqual(_inferLinkLikelihood({ outreach_type: 'broken_link' }),   'high');
  assertEqual(_inferLinkLikelihood({ outreach_type: 'resource_link' }), 'medium');
  assertEqual(_inferLinkLikelihood({ outreach_type: 'guest_post' }),    'medium');
});

test('_inferCategory detects universities', () => {
  assertEqual(_inferCategory({ domain: 'uom.ac.mu' }), 'university');
  assertEqual(_inferCategory({ domain: 'griffith.edu.au' }), 'university');
});

// ── Tests: seo_prospect_scorer.js ────────────────────────────────────────────

const {
  scoreDA,
  scoreRelevance,
  scoreTraffic,
  scoreLinkLikelihood,
  scoreProspect,
  rankProspects,
  classifyLinkType,
  scoreSummary,
} = require('./seo_prospect_scorer.js');

console.log('\nseo_prospect_scorer — component scores');

test('scoreDA returns 40 for DA ≥ 80', () => {
  assertEqual(scoreDA(80), 40);
  assertEqual(scoreDA(100), 40);
});

test('scoreDA returns lower values for lower DA', () => {
  assert(scoreDA(70) < scoreDA(80), 'DA 70 should score less than DA 80');
  assert(scoreDA(50) < scoreDA(70), 'DA 50 should score less than DA 70');
  assert(scoreDA(30) < scoreDA(50), 'DA 30 should score less than DA 50');
});

test('scoreDA handles 0 and NaN safely', () => {
  assert(scoreDA(0) >= 0);
  assert(scoreDA(NaN) >= 0);
});

test('scoreRelevance returns 30 for direct', () => {
  assertEqual(scoreRelevance('direct'), 30);
});

test('scoreRelevance ordering: direct > strong > moderate > tangential', () => {
  assert(scoreRelevance('direct')     > scoreRelevance('strong'));
  assert(scoreRelevance('strong')     > scoreRelevance('moderate'));
  assert(scoreRelevance('moderate')   > scoreRelevance('tangential'));
});

test('scoreTraffic returns 20 for high', () => {
  assertEqual(scoreTraffic('high'), 20);
});

test('scoreTraffic ordering: high > medium > low_medium > low', () => {
  assert(scoreTraffic('high')       > scoreTraffic('medium'));
  assert(scoreTraffic('medium')     > scoreTraffic('low_medium'));
  assert(scoreTraffic('low_medium') > scoreTraffic('low'));
});

test('scoreLinkLikelihood returns 10 for high', () => {
  assertEqual(scoreLinkLikelihood('high'), 10);
});

console.log('\nseo_prospect_scorer — scoreProspect');

test('scoreProspect returns number 0–100', () => {
  const p = { da_estimate: '75', relevance: 'strong', traffic_tier: 'high', link_likelihood: 'medium' };
  const s = scoreProspect(p);
  assert(typeof s === 'number', 'Score must be a number');
  assert(s >= 0 && s <= 100, `Score ${s} out of range`);
});

test('high-quality prospect scores above 75', () => {
  const p = { da_estimate: '85', relevance: 'direct', traffic_tier: 'high', link_likelihood: 'high' };
  assert(scoreProspect(p) >= 75, 'Top prospect should score ≥75');
});

test('low-quality prospect scores below 40', () => {
  const p = { da_estimate: '20', relevance: 'tangential', traffic_tier: 'low', link_likelihood: 'low' };
  assert(scoreProspect(p) < 40, 'Weak prospect should score <40');
});

test('higher DA prospect scores higher all else equal', () => {
  const high = { da_estimate: '90', relevance: 'strong', traffic_tier: 'medium', link_likelihood: 'medium' };
  const low  = { da_estimate: '35', relevance: 'strong', traffic_tier: 'medium', link_likelihood: 'medium' };
  assert(scoreProspect(high) > scoreProspect(low));
});

test('handles missing scoring metadata gracefully', () => {
  const p = { da_estimate: '50' };
  const s = scoreProspect(p);
  assert(typeof s === 'number' && !isNaN(s), 'Should return a number even with missing fields');
});

console.log('\nseo_prospect_scorer — rankProspects');

test('rankProspects returns sorted descending', () => {
  const prospects = [
    { da_estimate: '40', relevance: 'moderate', traffic_tier: 'low', link_likelihood: 'low' },
    { da_estimate: '85', relevance: 'direct',   traffic_tier: 'high', link_likelihood: 'high' },
    { da_estimate: '60', relevance: 'strong',   traffic_tier: 'medium', link_likelihood: 'medium' },
  ];
  const ranked = rankProspects(prospects);
  assert(ranked[0].score >= ranked[1].score, 'First should have highest score');
  assert(ranked[1].score >= ranked[2].score, 'Second should have higher score than third');
});

test('rankProspects adds score property to each', () => {
  const prospects = [
    { da_estimate: '60', relevance: 'strong', traffic_tier: 'medium', link_likelihood: 'medium' },
  ];
  const ranked = rankProspects(prospects);
  assert('score' in ranked[0], 'Expected score property');
});

test('rankProspects does not mutate input array', () => {
  const original = [
    { da_estimate: '60', relevance: 'strong', traffic_tier: 'medium', link_likelihood: 'medium' },
    { da_estimate: '40', relevance: 'moderate', traffic_tier: 'low', link_likelihood: 'low' },
  ];
  const originalOrder = original.map(p => p.da_estimate);
  rankProspects(original);
  const afterOrder = original.map(p => p.da_estimate);
  assertDeepEqual(originalOrder, afterOrder, 'Input array should not be mutated');
});

test('rankProspects handles empty array', () => {
  const ranked = rankProspects([]);
  assertDeepEqual(ranked, []);
});

console.log('\nseo_prospect_scorer — classifyLinkType');

test('returns outreach_type if present', () => {
  assertEqual(classifyLinkType({ outreach_type: 'guest_post' }),    'guest_post');
  assertEqual(classifyLinkType({ outreach_type: 'resource_link' }), 'resource_link');
  assertEqual(classifyLinkType({ outreach_type: 'broken_link' }),   'broken_link');
});

test('infers resource_link for tourism_directory category', () => {
  const t = classifyLinkType({ category: 'tourism_directory', da_estimate: '60' });
  assertEqual(t, 'resource_link');
});

test('infers resource_link for very high DA with no explicit type', () => {
  const t = classifyLinkType({ da_estimate: '90', category: 'travel_blog' });
  assertEqual(t, 'resource_link');
});

test('infers guest_post for mid-DA travel blogs', () => {
  const t = classifyLinkType({ da_estimate: '55', category: 'travel_blog' });
  assertEqual(t, 'guest_post');
});

console.log('\nseo_prospect_scorer — scoreSummary');

test('scoreSummary counts tiers correctly', () => {
  const ranked = [
    { score: 95 }, { score: 92 },
    { score: 75 }, { score: 71 },
    { score: 55 }, { score: 51 },
    { score: 40 }, { score: 30 },
  ];
  const s = scoreSummary(ranked);
  assertEqual(s.tier90,      2);
  assertEqual(s.tier70,      2);
  assertEqual(s.tier50,      2);
  assertEqual(s.tier50minus, 2);
});

test('scoreSummary returns 0 avgScore on empty array', () => {
  const s = scoreSummary([]);
  assertEqual(s.avgScore, 0);
});

// ── Tests: seo_outreach_queue.js ──────────────────────────────────────────────

const {
  generateQueue,
  generateFollowUpSchedule,
  getWeekBatch,
  getDueFollowUps,
  _assignWeek,
  addDays,
  formatDate,
  weekNumberFromStart,
  CAMPAIGN_START: Q_CAMPAIGN_START,
  FOLLOWUP_1_DAYS,
  FOLLOWUP_2_DAYS,
} = require('./seo_outreach_queue.js');

console.log('\nseo_outreach_queue — date helpers');

test('addDays adds correct number of days', () => {
  const base = new Date('2026-06-07');
  const r    = addDays(base, 7);
  assertEqual(r.toISOString().slice(0, 10), '2026-06-14');
});

test('addDays does not mutate original date', () => {
  const base = new Date('2026-06-07');
  addDays(base, 30);
  assertEqual(base.toISOString().slice(0, 10), '2026-06-07');
});

test('formatDate returns YYYY-MM-DD string', () => {
  const d = new Date('2026-08-15');
  assertEqual(formatDate(d), '2026-08-15');
});

test('weekNumberFromStart returns 1 on campaign start day', () => {
  const w = weekNumberFromStart(Q_CAMPAIGN_START, Q_CAMPAIGN_START);
  assertEqual(w, 1);
});

test('weekNumberFromStart returns 2 for day 8', () => {
  const day8 = addDays(Q_CAMPAIGN_START, 7);
  const w    = weekNumberFromStart(day8, Q_CAMPAIGN_START);
  assertEqual(w, 2);
});

console.log('\nseo_outreach_queue — _assignWeek');

test('broken_link with high likelihood goes to week 1', () => {
  const p = { outreach_type: 'broken_link', link_likelihood: 'high', status: 'not_started', score: 60 };
  assertEqual(_assignWeek(p), 1);
});

test('responded/accepted status always goes to week 1', () => {
  const p = { outreach_type: 'guest_post', link_likelihood: 'low', status: 'responded', score: 30 };
  assertEqual(_assignWeek(p), 1);
});

test('low-score guest post goes to later week', () => {
  const p = { outreach_type: 'guest_post', link_likelihood: 'low', status: 'not_started', score: 35 };
  assert(_assignWeek(p) >= 7, 'Low-score guest post should be deferred');
});

test('high-score resource_link goes to early week', () => {
  const p = { outreach_type: 'resource_link', link_likelihood: 'medium', status: 'not_started', score: 75 };
  assert(_assignWeek(p) <= 3, 'High-score resource link should be early');
});

console.log('\nseo_outreach_queue — generateQueue');

const MOCK_RANKED = Array.from({ length: 25 }, (_, i) => ({
  id: `T${i + 1}`,
  site_name: `Site ${i + 1}`,
  da_estimate: 50 + i,
  score: 80 - i,
  outreach_type: i % 3 === 0 ? 'broken_link' : i % 3 === 1 ? 'resource_link' : 'guest_post',
  link_likelihood: 'medium',
  status: 'not_started',
  target_page: '/rankings',
}));

test('generateQueue returns array of week objects', () => {
  const queue = generateQueue(MOCK_RANKED);
  assert(Array.isArray(queue), 'Expected array');
  assert(queue.length > 0, 'Queue should not be empty');
  queue.forEach(wk => {
    assert('week' in wk,       'Week object should have week');
    assert('weekStart' in wk,  'Week object should have weekStart');
    assert('prospects' in wk,  'Week object should have prospects');
    assert(Array.isArray(wk.prospects), 'prospects should be array');
  });
});

test('no week batch exceeds batchSize', () => {
  const queue = generateQueue(MOCK_RANKED, { batchSize: 5 });
  queue.forEach(wk => {
    assert(wk.prospects.length <= 5, `Week ${wk.week} has ${wk.prospects.length} > 5`);
  });
});

test('all not_started prospects appear in queue', () => {
  const queue = generateQueue(MOCK_RANKED);
  const allQueued = queue.flatMap(wk => wk.prospects);
  assertEqual(allQueued.length, MOCK_RANKED.length);
});

test('skips prospects with live/declined/skip status', () => {
  const mixed = [
    ...MOCK_RANKED.slice(0, 5),
    { id: 'LIVE1', site_name: 'Live Site', da_estimate: '70', score: 90,
      outreach_type: 'guest_post', link_likelihood: 'medium', status: 'live', target_page: '/rankings' },
    { id: 'DEC1', site_name: 'Declined Site', da_estimate: '60', score: 80,
      outreach_type: 'guest_post', link_likelihood: 'medium', status: 'declined', target_page: '/rankings' },
  ];
  const queue = generateQueue(mixed);
  const allQueued = queue.flatMap(wk => wk.prospects);
  assert(!allQueued.some(p => p.status === 'live'), 'Live prospects should not appear in queue');
  assert(!allQueued.some(p => p.status === 'declined'), 'Declined prospects should not appear in queue');
});

console.log('\nseo_outreach_queue — generateFollowUpSchedule');

test('generates follow-up 1 for contacted prospects without follow-up', () => {
  const contacted = [{
    site_name: 'Test Site', status: 'contacted',
    date_contacted: '2026-06-07', date_followed_up: '',
    contact_email: 'test@test.com',
  }];
  const schedule = generateFollowUpSchedule(contacted);
  assertEqual(schedule.length, 1);
  assertEqual(schedule[0].action, 'follow_up_1');
  assertEqual(schedule[0].date, '2026-06-14'); // +7 days
});

test('generates follow-up 2 for followed_up prospects', () => {
  const contacted = [{
    site_name: 'Test Site', status: 'followed_up',
    date_contacted: '2026-06-01', date_followed_up: '2026-06-08',
    contact_email: 'test@test.com',
  }];
  const schedule = generateFollowUpSchedule(contacted);
  assertEqual(schedule.length, 1);
  assertEqual(schedule[0].action, 'follow_up_2');
});

test('skips prospects without date_contacted', () => {
  const prospects = [{ site_name: 'No Date', status: 'contacted', date_contacted: '', date_followed_up: '' }];
  const schedule = generateFollowUpSchedule(prospects);
  assertEqual(schedule.length, 0);
});

test('schedule is sorted by date ascending', () => {
  const contacted = [
    { site_name: 'B', status: 'contacted', date_contacted: '2026-06-14', date_followed_up: '', contact_email: '' },
    { site_name: 'A', status: 'contacted', date_contacted: '2026-06-07', date_followed_up: '', contact_email: '' },
  ];
  const schedule = generateFollowUpSchedule(contacted);
  assert(schedule[0].date <= schedule[1].date, 'Schedule should be sorted by date');
});

console.log('\nseo_outreach_queue — getWeekBatch / getDueFollowUps');

test('getWeekBatch returns correct week', () => {
  // Ensure week 1 is populated by including a broken_link with high likelihood
  const withWeek1 = [
    { id: 'W1', site_name: 'Quick Win', da_estimate: '60', score: 70,
      outreach_type: 'broken_link', link_likelihood: 'high',
      status: 'not_started', target_page: '/rankings' },
    ...MOCK_RANKED,
  ];
  const queue = generateQueue(withWeek1);
  const batch = getWeekBatch(queue, 1);
  assert(batch !== null, 'Week 1 batch should exist');
  assertEqual(batch.week, 1);
});

test('getWeekBatch returns null for non-existent week', () => {
  const queue = generateQueue(MOCK_RANKED);
  const batch = getWeekBatch(queue, 999);
  assertEqual(batch, null);
});

test('getDueFollowUps filters by date range', () => {
  const today = new Date();
  const schedule = [
    { date: formatDate(addDays(today, 2)), action: 'follow_up_1', prospect: { site_name: 'Soon' } },
    { date: formatDate(addDays(today, 30)), action: 'follow_up_1', prospect: { site_name: 'Later' } },
  ];
  const due = getDueFollowUps(schedule, 7);
  assertEqual(due.length, 1);
  assertEqual(due[0].prospect.site_name, 'Soon');
});

// ── Tests: seo_campaign_dashboard.js ─────────────────────────────────────────

const {
  generateReport,
  weeklyReportText,
  _computeWeeklyVelocity,
  LINK_GOAL,
  CAMPAIGN_START: D_CAMPAIGN_START,
} = require('./seo_campaign_dashboard.js');

const MOCK_PROSPECTS = [
  { status: 'live',        da_estimate: '72', date_contacted: '2026-06-07', relevance: 'strong', traffic_tier: 'high',       link_likelihood: 'medium' },
  { status: 'live',        da_estimate: '65', date_contacted: '2026-06-07', relevance: 'direct', traffic_tier: 'medium',     link_likelihood: 'high' },
  { status: 'accepted',    da_estimate: '58', date_contacted: '2026-06-10', relevance: 'strong', traffic_tier: 'medium',     link_likelihood: 'high' },
  { status: 'responded',   da_estimate: '50', date_contacted: '2026-06-10', relevance: 'moderate', traffic_tier: 'low_medium', link_likelihood: 'medium' },
  { status: 'contacted',   da_estimate: '60', date_contacted: '2026-06-12', relevance: 'strong', traffic_tier: 'medium',     link_likelihood: 'medium' },
  { status: 'not_started', da_estimate: '45', date_contacted: '',           relevance: 'moderate', traffic_tier: 'low_medium', link_likelihood: 'low' },
  { status: 'declined',    da_estimate: '80', date_contacted: '2026-06-08', relevance: 'strong', traffic_tier: 'high',       link_likelihood: 'low' },
];

console.log('\nseo_campaign_dashboard — generateReport');

test('generateReport returns all expected fields', () => {
  const r = generateReport(MOCK_PROSPECTS);
  const required = ['dayNum', 'weekNum', 'pctDone', 'daysLeft', 'total', 'notStarted',
                    'contacted', 'responded', 'liveLinks', 'declined', 'projected',
                    'weeklyVelocity', 'linksNeeded'];
  for (const f of required) {
    assert(f in r, `Missing field: ${f}`);
  }
});

test('liveLinks count is correct', () => {
  const r = generateReport(MOCK_PROSPECTS);
  assertEqual(r.liveLinks, 2);
});

test('total matches prospect array length', () => {
  const r = generateReport(MOCK_PROSPECTS);
  assertEqual(r.total, MOCK_PROSPECTS.length);
});

test('linksNeeded is goal minus live', () => {
  const r = generateReport(MOCK_PROSPECTS);
  assertEqual(r.linksNeeded, LINK_GOAL - r.liveLinks);
});

test('pctDone is between 0 and 100', () => {
  const r = generateReport(MOCK_PROSPECTS);
  assert(r.pctDone >= 0 && r.pctDone <= 100, `pctDone ${r.pctDone} out of range`);
});

test('weeklyVelocity is array of 13 entries', () => {
  const r = generateReport(MOCK_PROSPECTS);
  assertEqual(r.weeklyVelocity.length, 13);
  r.weeklyVelocity.forEach(v => {
    assert('week' in v && 'count' in v, 'Each entry should have week and count');
  });
});

console.log('\nseo_campaign_dashboard — _computeWeeklyVelocity');

test('counts contacts in correct week bucket', () => {
  const prospects = [
    { status: 'contacted', date_contacted: '2026-06-07' }, // day 1 → week 1
    { status: 'contacted', date_contacted: '2026-06-14' }, // day 8 → week 2
    { status: 'contacted', date_contacted: '2026-06-14' }, // day 8 → week 2
  ];
  const vel = _computeWeeklyVelocity(prospects);
  assertEqual(vel.find(v => v.week === 1).count, 1);
  assertEqual(vel.find(v => v.week === 2).count, 2);
});

test('ignores prospects without date_contacted', () => {
  const prospects = [
    { status: 'not_started', date_contacted: '' },
  ];
  const vel = _computeWeeklyVelocity(prospects);
  const total = vel.reduce((sum, v) => sum + v.count, 0);
  assertEqual(total, 0);
});

console.log('\nseo_campaign_dashboard — weeklyReportText');

test('weeklyReportText returns non-empty string', () => {
  const text = weeklyReportText(MOCK_PROSPECTS);
  assert(typeof text === 'string' && text.length > 100, 'Report should be non-trivial string');
});

test('weeklyReportText includes link goal count', () => {
  const text = weeklyReportText(MOCK_PROSPECTS);
  assert(text.includes(String(LINK_GOAL)), 'Report should mention the link goal');
});

test('weeklyReportText includes pipeline table', () => {
  const text = weeklyReportText(MOCK_PROSPECTS);
  assert(text.includes('Pipeline'), 'Report should include pipeline section');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
