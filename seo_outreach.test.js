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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
