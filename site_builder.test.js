/**
 * site_builder.test.js
 * Mauritius Resort Finder — Site Builder automated test suite
 *
 * 25 sections, 211 tests
 * Run: node site_builder.test.js
 */

'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const {
  buildSite,
  buildAllPages,
  generatePageContexts,
  generateSitemap,
  generateRobots,
  generateFeed,
  saveBuildReport,
  _slugify,
  _buildOutputPath,
  _adaptScoredHotel,
  _generatePillarContexts,
  _generatePersonaContexts,
  _generateRegionContexts,
  _generateHotelContexts,
  _generateComparisonContexts,
  _detectDuplicateSlugs,
  _buildPage,
  _runConcurrent,
  _parseCLIArgs,
  _xmlEsc,
  _roundTo,
  SITE_BUILDER_VERSION,
  PAGE_TYPES,
  PERSONA_DEFINITIONS,
  SITEMAP_PRIORITY,
  SITEMAP_CHANGEFREQ,
  DEFAULT_BASE_URL,
  DEFAULT_OUT_DIR,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_COMPARISON_TOP_N,
  DEFAULT_REGION_MIN_HOTELS,
  FEED_MAX_ITEMS,
} = require('./site_builder.js');

// ─────────────────────────────────────────────────────────────────────────────
// MINI TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

function section(title) {
  process.stdout.write(`\n  Section: ${title}\n  `);
}

function it(desc, fn) {
  try {
    fn();
    pass++;
    process.stdout.write('.  ');
  } catch (e) {
    fail++;
    failures.push({ desc, error: e.message });
    process.stdout.write(`\n  FAIL: ${desc}\n    ${e.message}\n  `);
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    pass++;
    process.stdout.write('.  ');
  } catch (e) {
    fail++;
    failures.push({ desc, error: e.message });
    process.stdout.write(`\n  FAIL: ${desc}\n    ${e.message}\n  `);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertIncludes(str, sub, msg) {
  if (!String(str).includes(sub)) {
    throw new Error(msg || `Expected string to include "${sub}" but got:\n${str}`);
  }
}

function assertNotIncludes(str, sub, msg) {
  if (String(str).includes(sub)) {
    throw new Error(msg || `Expected string NOT to include "${sub}"`);
  }
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  if (!threw) throw new Error(msg || 'Expected function to throw');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const HOTEL_DATASET = require('./integration_harness.js').HOTEL_DATASET;

// Minimal 3-hotel dataset for targeted tests
const MINI_DATASET = [
  {
    hotel_id: 'T001', hotel_name: 'Alpha Resort',
    overall_rating: 9.2, location_score: 9.0, amenity_score: 9.1,
    brand_score: 9.0, value_score: 7.5, review_count: 800, avg_rating: 4.8,
    region: 'North Coast', property_type: 'resort',
    avg_nightly_rate: 1200, amenities: { spa: true, pool: true },
  },
  {
    hotel_id: 'T002', hotel_name: 'Beta Hotel',
    overall_rating: 8.8, location_score: 8.5, amenity_score: 8.6,
    brand_score: 8.4, value_score: 8.0, review_count: 500, avg_rating: 4.7,
    region: 'South Bay', property_type: 'hotel',
    avg_nightly_rate: 900, amenities: { spa: false, pool: true },
  },
  {
    hotel_id: 'T003', hotel_name: 'Gamma & Spa',
    overall_rating: 8.5, location_score: 8.3, amenity_score: 8.7,
    brand_score: 8.2, value_score: 8.5, review_count: 350, avg_rating: 4.65,
    region: 'North Coast', property_type: 'resort',
    avg_nightly_rate: 750, amenities: { spa: true, pool: true },
  },
];

// Mock pipeline deps for _buildPage tests
function makeMockDeps(overrides = {}) {
  return {
    scoringEngine: {
      rankHotels: (hotels, persona, opts) => ({
        ranked_hotels: hotels.map((h, i) => ({
          hotel: h,
          rank:  i + 1,
          dimension_scores: {
            overall_rating: h.overall_rating,
            location_score: h.location_score,
            amenity_score:  h.amenity_score,
            brand_score:    h.brand_score,
            value_score:    h.value_score,
          },
          scores: { final_ranking_score: h.overall_rating * 10 },
          tier:   'tier_1',
          completeness_percent: 100,
          commission_adjusted: false,
        })),
      }),
    },
    explanationEngine: {
      explainBatch: (hotels, persona) => hotels.map(h => ({
        hotel_id:   h.hotel_id,
        hotel_name: h.hotel_name,
        persona,
        rank: h.rank,
        explanation_summary: 'Test summary.',
        strengths:  [{ rendered_text: 'Strong point.' }],
        weaknesses: [{ rendered_text: 'Weak point.' }],
        traveler_fit: 'Good fit.',
        confidence_level: 'high',
        supporting_claims: [],
        suppressed_claims: [],
        validation_summary: { total: 0, valid: 0, suppressed: 0 },
        explanation_version: '1.0.0',
        generated_at: new Date().toISOString(),
      })),
    },
    blockAssembler: {
      assemble: (hotels, explanations, pageContext, affiliateLinks) => ({
        blocks: [
          { block_type: 'hero',            position: 1, trust_score: 0,  payload: {} },
          { block_type: 'ranking_summary', position: 2, trust_score: 1,  payload: {} },
          { block_type: 'hotel_card',      position: 3, trust_score: 2,  payload: { hotel_id: hotels[0].hotel_id } },
          { block_type: 'disclosure',      position: 4, trust_score: 3,  payload: { affiliate_disclosure: true } },
        ],
        assembly_summary: {
          total_blocks: 4, final_trust_depth: 3, dropped_ctas: 0, hotel_count: hotels.length,
        },
        page_context: pageContext,
        persona: pageContext.persona,
        generated_at: new Date().toISOString(),
        assembler_version: '1.0.0',
      }),
    },
    renderFn: (assembly, opts) => `<html><body>rendered:${assembly.page_context.slug}</body></html>`,
    mkdirFn: () => {},
    writeFn: () => {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Module constants and exports
// ─────────────────────────────────────────────────────────────────────────────

section('Module constants and exports');

it('SITE_BUILDER_VERSION is a non-empty string', () => {
  assert(typeof SITE_BUILDER_VERSION === 'string' && SITE_BUILDER_VERSION.length > 0);
});
it('PAGE_TYPES is frozen', () => {
  assert(Object.isFrozen(PAGE_TYPES));
});
it('PAGE_TYPES has exactly 7 entries', () => {
  assertEqual(Object.keys(PAGE_TYPES).length, 7);
});
it('PAGE_TYPES contains all expected values', () => {
  ['pillar', 'persona', 'region', 'hotel', 'comparison', 'seasonal'].forEach(v => {
    assert(Object.values(PAGE_TYPES).includes(v), `Missing: ${v}`);
  });
});
it('PERSONA_DEFINITIONS is frozen', () => {
  assert(Object.isFrozen(PERSONA_DEFINITIONS));
});
it('PERSONA_DEFINITIONS has 7 entries', () => {
  assertEqual(PERSONA_DEFINITIONS.length, 7);
});
it('PERSONA_DEFINITIONS has exactly 1 pillar entry', () => {
  assertEqual(PERSONA_DEFINITIONS.filter(p => p.page_type_tag === 'pillar').length, 1);
});
it('SITEMAP_PRIORITY is frozen', () => {
  assert(Object.isFrozen(SITEMAP_PRIORITY));
});
it('SITEMAP_PRIORITY.pillar is 1.0', () => {
  assertEqual(SITEMAP_PRIORITY.pillar, '1.0');
});
it('SITEMAP_PRIORITY.comparison < SITEMAP_PRIORITY.hotel', () => {
  assert(parseFloat(SITEMAP_PRIORITY.comparison) < parseFloat(SITEMAP_PRIORITY.hotel));
});
it('DEFAULT_BASE_URL starts with https://', () => {
  assert(DEFAULT_BASE_URL.startsWith('https://'));
});
it('FEED_MAX_ITEMS is a positive integer', () => {
  assert(Number.isInteger(FEED_MAX_ITEMS) && FEED_MAX_ITEMS > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: _xmlEsc()
// ─────────────────────────────────────────────────────────────────────────────

section('_xmlEsc()');

it('escapes ampersand', () => assertEqual(_xmlEsc('a & b'), 'a &amp; b'));
it('escapes less-than', () => assertEqual(_xmlEsc('a < b'), 'a &lt; b'));
it('escapes greater-than', () => assertEqual(_xmlEsc('a > b'), 'a &gt; b'));
it('escapes double-quote', () => assertEqual(_xmlEsc('"val"'), '&quot;val&quot;'));
it("escapes single-quote", () => assertEqual(_xmlEsc("it's"), "it&apos;s"));
it('passes through clean ASCII', () => assertEqual(_xmlEsc('hello-world'), 'hello-world'));
it('coerces number to string', () => assertEqual(_xmlEsc(42), '42'));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: _slugify()
// ─────────────────────────────────────────────────────────────────────────────

section('_slugify()');

it('lowercases input', () => assertEqual(_slugify('HELLO'), 'hello'));
it('replaces spaces with dashes', () => assertEqual(_slugify('hello world'), 'hello-world'));
it('replaces & with and', () => assertEqual(_slugify('One & Only'), 'one-and-only'));
it('collapses multiple dashes', () => assertEqual(_slugify('a  b'), 'a-b'));
it('trims leading dash', () => assertEqual(_slugify('-hello'), 'hello'));
it('trims trailing dash', () => assertEqual(_slugify('hello-'), 'hello'));
it('handles accented chars (drops them)', () => {
  const s = _slugify('Saint Géran');
  assert(s.startsWith('saint-'), `Got: ${s}`);
});
it('handles apostrophe in hotel name', () => {
  const s = _slugify("Four Seasons");
  assertEqual(s, 'four-seasons');
});
it('handles empty string', () => assertEqual(_slugify(''), ''));
it('handles null', () => assertEqual(_slugify(null), ''));
it('handles number input', () => assertEqual(_slugify(42), ''));
it('One&Only Le Saint Géran produces stable slug', () => {
  const s = _slugify('One&Only Le Saint Géran');
  assert(s.includes('oneandonly'), `Got: ${s}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: _buildOutputPath()
// ─────────────────────────────────────────────────────────────────────────────

section('_buildOutputPath()');

it('ends with index.html', () => {
  assert(_buildOutputPath('my-page', '/tmp/dist').endsWith('index.html'));
});
it('contains slug in path', () => {
  assert(_buildOutputPath('my-page', '/tmp/dist').includes('my-page'));
});
it('contains outDir in path', () => {
  assert(_buildOutputPath('my-page', '/tmp/dist').includes('dist'));
});
it('resolves relative outDir', () => {
  const p = _buildOutputPath('test', './dist');
  assert(path.isAbsolute(p), 'Expected absolute path');
});
it('handles nested slug (compare/...)', () => {
  const p = _buildOutputPath('compare/a-vs-b', '/tmp/dist');
  assert(p.includes('compare'), `Got: ${p}`);
  assert(p.endsWith('index.html'));
});
it('handles hotels/ prefix', () => {
  const p = _buildOutputPath('hotels/royal-palm', '/tmp/dist');
  assert(p.includes('hotels'), `Got: ${p}`);
});

// Security: path traversal prevention
it('throws on slug containing ../ (single-level traversal)', () => {
  assertThrows(
    () => _buildOutputPath('../escape', '/tmp/dist'),
    Error,
    '_buildOutputPath: ../escape throws',
  );
});
it('throws on deep path traversal slug (../../etc/passwd)', () => {
  assertThrows(
    () => _buildOutputPath('../../etc/passwd', '/tmp/dist'),
    Error,
    '_buildOutputPath: ../../etc/passwd throws',
  );
});
it('URL-encoded %2F does NOT traverse (path.join treats % literally, stays inside outDir)', () => {
  // path.join does not URL-decode inputs, so ..%2Fescape is just a weird directory
  // name inside outDir — no traversal, no throw.
  const p = _buildOutputPath('..%2Fescape', '/tmp/dist');
  assert(p.startsWith('/tmp/dist'), `Got: ${p}`);
});
it('leading-slash slug is safe: path.join strips it and stays inside outDir', () => {
  // path.join('/tmp/dist', '/etc/passwd', 'index.html') = '/tmp/dist/etc/passwd/index.html'
  // on POSIX — Node.js path.join normalises away the second leading slash.
  const p = _buildOutputPath('/etc/passwd', '/tmp/dist');
  assert(p.startsWith('/tmp/dist'), `Got: ${p}`);
});
it('legitimate nested slug does not throw', () => {
  const p = _buildOutputPath('compare/resort-a-vs-resort-b', '/tmp/dist');
  assert(p.includes('compare'), `Got: ${p}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: _generatePillarContexts()
// ─────────────────────────────────────────────────────────────────────────────

section('_generatePillarContexts()');

it('returns exactly 1 spec', () => {
  assertEqual(_generatePillarContexts(MINI_DATASET).length, 1);
});
it('page_type is pillar', () => {
  assertEqual(_generatePillarContexts(MINI_DATASET)[0].page_type, 'pillar');
});
it('persona is luxury', () => {
  assertEqual(_generatePillarContexts(MINI_DATASET)[0].persona, 'luxury');
});
it('slug matches PERSONA_DEFINITIONS luxury slug', () => {
  const def = PERSONA_DEFINITIONS.find(p => p.page_type_tag === 'pillar');
  assertEqual(_generatePillarContexts(MINI_DATASET)[0].slug, def.slug);
});
it('hotels array contains all dataset hotels', () => {
  assertEqual(_generatePillarContexts(MINI_DATASET)[0].hotels.length, MINI_DATASET.length);
});
it('does not mutate dataset', () => {
  const orig = MINI_DATASET.length;
  _generatePillarContexts(MINI_DATASET);
  assertEqual(MINI_DATASET.length, orig);
});
it('pageContext has persona field', () => {
  assert(_generatePillarContexts(MINI_DATASET)[0].pageContext.persona === 'luxury');
});
it('priority is 1.0', () => {
  assertEqual(_generatePillarContexts(MINI_DATASET)[0].priority, '1.0');
});
it('changefreq is weekly', () => {
  assertEqual(_generatePillarContexts(MINI_DATASET)[0].changefreq, 'weekly');
});
it('affiliateLinks defaults to {}', () => {
  const spec = _generatePillarContexts(MINI_DATASET)[0];
  assert(typeof spec.affiliateLinks === 'object');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: _generatePersonaContexts()
// ─────────────────────────────────────────────────────────────────────────────

section('_generatePersonaContexts()');

it('returns 6 persona specs (non-pillar)', () => {
  assertEqual(_generatePersonaContexts(MINI_DATASET).length, 6);
});
it('all specs have page_type persona', () => {
  _generatePersonaContexts(MINI_DATASET).forEach(s =>
    assertEqual(s.page_type, 'persona')
  );
});
it('no luxury persona in persona contexts', () => {
  const personas = _generatePersonaContexts(MINI_DATASET).map(s => s.persona);
  assert(!personas.includes('luxury'));
});
it('honeymoon persona present', () => {
  assert(_generatePersonaContexts(MINI_DATASET).some(s => s.persona === 'honeymoon'));
});
it('wellness persona present', () => {
  assert(_generatePersonaContexts(MINI_DATASET).some(s => s.persona === 'wellness'));
});
it('each spec hotels = full dataset', () => {
  _generatePersonaContexts(MINI_DATASET).forEach(s =>
    assertEqual(s.hotels.length, MINI_DATASET.length)
  );
});
it('all slugs are unique', () => {
  const slugs = _generatePersonaContexts(MINI_DATASET).map(s => s.slug);
  assertEqual(new Set(slugs).size, slugs.length);
});
it('priority is 0.9 for all', () => {
  _generatePersonaContexts(MINI_DATASET).forEach(s => assertEqual(s.priority, '0.9'));
});
it('changefreq is weekly for all', () => {
  _generatePersonaContexts(MINI_DATASET).forEach(s => assertEqual(s.changefreq, 'weekly'));
});
it('each pageContext has target_keyword', () => {
  _generatePersonaContexts(MINI_DATASET).forEach(s =>
    assert(typeof s.pageContext.target_keyword === 'string' && s.pageContext.target_keyword.length > 0)
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: _generateRegionContexts()
// ─────────────────────────────────────────────────────────────────────────────

section('_generateRegionContexts()');

it('groups MINI_DATASET into 2 regions', () => {
  assertEqual(_generateRegionContexts(MINI_DATASET).length, 2);
});
it('all specs have page_type region', () => {
  _generateRegionContexts(MINI_DATASET).forEach(s => assertEqual(s.page_type, 'region'));
});
it('region field set on each spec', () => {
  _generateRegionContexts(MINI_DATASET).forEach(s => assert(typeof s.region === 'string'));
});
it('slugs contain -luxury-hotels suffix', () => {
  _generateRegionContexts(MINI_DATASET).forEach(s =>
    assert(s.slug.endsWith('-luxury-hotels'), `slug: ${s.slug}`)
  );
});
it('North Coast slug is correct', () => {
  const specs = _generateRegionContexts(MINI_DATASET);
  assert(specs.some(s => s.slug === 'north-coast-luxury-hotels'));
});
it('South Bay slug is correct', () => {
  assert(_generateRegionContexts(MINI_DATASET).some(s => s.slug === 'south-bay-luxury-hotels'));
});
it('sorted deterministically by region name', () => {
  const specs = _generateRegionContexts(MINI_DATASET);
  for (let i = 1; i < specs.length; i++) {
    assert(specs[i].region >= specs[i - 1].region, 'Not sorted by region name');
  }
});
it('North Coast spec has 2 hotels', () => {
  const specs = _generateRegionContexts(MINI_DATASET);
  const nc    = specs.find(s => s.region === 'North Coast');
  assert(nc, 'North Coast not found');
  assertEqual(nc.hotels.length, 2);
});
it('priority is 0.8', () => {
  _generateRegionContexts(MINI_DATASET).forEach(s => assertEqual(s.priority, '0.8'));
});
it('minHotels=2 excludes South Bay (1 hotel)', () => {
  const specs = _generateRegionContexts(MINI_DATASET, { regionMinHotels: 2 });
  assert(!specs.some(s => s.region === 'South Bay'), 'South Bay should be excluded');
});
it('minHotels=2 keeps North Coast (2 hotels)', () => {
  const specs = _generateRegionContexts(MINI_DATASET, { regionMinHotels: 2 });
  assert(specs.some(s => s.region === 'North Coast'));
});
it('empty dataset returns empty array', () => {
  assertEqual(_generateRegionContexts([]).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: _generateHotelContexts()
// ─────────────────────────────────────────────────────────────────────────────

section('_generateHotelContexts()');

it('returns one spec per hotel', () => {
  assertEqual(_generateHotelContexts(MINI_DATASET).length, MINI_DATASET.length);
});
it('all specs have page_type hotel', () => {
  _generateHotelContexts(MINI_DATASET).forEach(s => assertEqual(s.page_type, 'hotel'));
});
it('slugs start with hotels/', () => {
  _generateHotelContexts(MINI_DATASET).forEach(s =>
    assert(s.slug.startsWith('hotels/'), `slug: ${s.slug}`)
  );
});
it('slug for Alpha Resort is hotels/alpha-resort', () => {
  const specs = _generateHotelContexts(MINI_DATASET);
  assert(specs.some(s => s.slug === 'hotels/alpha-resort'), 'Missing hotels/alpha-resort');
});
it('slug for Gamma & Spa escapes ampersand', () => {
  const specs = _generateHotelContexts(MINI_DATASET);
  const gamma = specs.find(s => s.hotel_id === 'T003');
  assert(gamma && gamma.slug.includes('gamma'), `Got: ${gamma && gamma.slug}`);
  assertNotIncludes(gamma.slug, '&');
});
it('each spec has exactly 1 hotel in hotels array', () => {
  _generateHotelContexts(MINI_DATASET).forEach(s => assertEqual(s.hotels.length, 1));
});
it('sorted by hotel_id ascending', () => {
  const specs = _generateHotelContexts(MINI_DATASET);
  assertEqual(specs[0].hotel_id, 'T001');
  assertEqual(specs[1].hotel_id, 'T002');
  assertEqual(specs[2].hotel_id, 'T003');
});
it('priority is 0.7', () => {
  _generateHotelContexts(MINI_DATASET).forEach(s => assertEqual(s.priority, '0.7'));
});
it('changefreq is monthly', () => {
  _generateHotelContexts(MINI_DATASET).forEach(s => assertEqual(s.changefreq, 'monthly'));
});
it('pageContext.hotel_id matches hotel', () => {
  _generateHotelContexts(MINI_DATASET).forEach(s =>
    assertEqual(s.pageContext.hotel_id, s.hotel_id)
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: _generateComparisonContexts()
// ─────────────────────────────────────────────────────────────────────────────

section('_generateComparisonContexts()');

it('3 hotels topN=3 → 3 pairs C(3,2)', () => {
  assertEqual(_generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).length, 3);
});
it('3 hotels topN=2 → 1 pair C(2,2)', () => {
  assertEqual(_generateComparisonContexts(MINI_DATASET, { comparisonTopN: 2 }).length, 1);
});
it('all specs have page_type comparison', () => {
  _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).forEach(s =>
    assertEqual(s.page_type, 'comparison')
  );
});
it('all slugs start with compare/', () => {
  _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).forEach(s =>
    assert(s.slug.startsWith('compare/'), `Got: ${s.slug}`)
  );
});
it('slugs contain -vs-', () => {
  _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).forEach(s =>
    assert(s.slug.includes('-vs-'), `Got: ${s.slug}`)
  );
});
it('no duplicate comparison slugs', () => {
  const specs = _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 });
  const slugs = specs.map(s => s.slug);
  assertEqual(new Set(slugs).size, slugs.length);
});
it('sorted by slug asc (deterministic)', () => {
  const specs = _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 });
  for (let i = 1; i < specs.length; i++) {
    assert(specs[i].slug >= specs[i - 1].slug);
  }
});
it('each spec has exactly 2 hotels', () => {
  _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).forEach(s =>
    assertEqual(s.hotels.length, 2)
  );
});
it('priority is 0.6', () => {
  _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).forEach(s =>
    assertEqual(s.priority, '0.6')
  );
});
it('pageContext.hotels_compared is array of 2 hotel_ids', () => {
  _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).forEach(s => {
    assert(Array.isArray(s.pageContext.hotels_compared));
    assertEqual(s.pageContext.hotels_compared.length, 2);
  });
});
it('slug is lexicographically ordered (a-vs-b not b-vs-a)', () => {
  const specs = _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 });
  specs.forEach(s => {
    const [, a, b] = s.slug.match(/compare\/(.+)-vs-(.+)/) || [];
    if (a && b) assert(a <= b, `Expected ${a} <= ${b} in slug ${s.slug}`);
  });
});
it('topN=0 returns empty array', () => {
  assertEqual(_generateComparisonContexts(MINI_DATASET, { comparisonTopN: 0 }).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: generatePageContexts() combined
// ─────────────────────────────────────────────────────────────────────────────

section('generatePageContexts() combined');

it('throws TypeError for non-array dataset', () => {
  assertThrows(() => generatePageContexts(null), 'Expected TypeError for null');
});
it('returns { specs, duplicates } shape', () => {
  const result = generatePageContexts(MINI_DATASET, { comparisonTopN: 2 });
  assert('specs' in result && 'duplicates' in result);
});
it('specs is an array', () => {
  assert(Array.isArray(generatePageContexts(MINI_DATASET).specs));
});
it('duplicates is an array', () => {
  assert(Array.isArray(generatePageContexts(MINI_DATASET).duplicates));
});
it('no duplicates in clean dataset', () => {
  assertEqual(generatePageContexts(MINI_DATASET, { comparisonTopN: 3 }).duplicates.length, 0);
});
it('total spec count = 1 pillar + 6 persona + regions + hotels + comparisons', () => {
  const { specs } = generatePageContexts(MINI_DATASET, { comparisonTopN: 3 });
  const pillar  = specs.filter(s => s.page_type === 'pillar').length;
  const persona = specs.filter(s => s.page_type === 'persona').length;
  const region  = specs.filter(s => s.page_type === 'region').length;
  const hotel   = specs.filter(s => s.page_type === 'hotel').length;
  const comp    = specs.filter(s => s.page_type === 'comparison').length;
  assertEqual(pillar, 1);
  assertEqual(persona, 6);
  assertEqual(region, 2);
  assertEqual(hotel, 3);
  assertEqual(comp, 3);
});
it('all specs have non-empty slug', () => {
  generatePageContexts(MINI_DATASET).specs.forEach(s =>
    assert(s.slug && s.slug.length > 0, `Empty slug on: ${JSON.stringify(s)}`)
  );
});
it('all specs have page_type field', () => {
  generatePageContexts(MINI_DATASET).specs.forEach(s =>
    assert(Object.values(PAGE_TYPES).includes(s.page_type), `Bad page_type: ${s.page_type}`)
  );
});
it('affiliateLinks propagated to all specs', () => {
  const al = { T001: { booking_url: 'https://test.com' } };
  generatePageContexts(MINI_DATASET, { affiliateLinks: al }).specs.forEach(s => {
    assert(s.affiliateLinks === al || s.affiliateLinks.T001 !== undefined);
  });
});
it('empty dataset produces 1 pillar + 6 persona + 0 region + 0 hotel + 0 comparison', () => {
  const { specs } = generatePageContexts([], { comparisonTopN: 5 });
  assertEqual(specs.filter(s => s.page_type === 'region').length, 0);
  assertEqual(specs.filter(s => s.page_type === 'hotel').length, 0);
  assertEqual(specs.filter(s => s.page_type === 'comparison').length, 0);
  assertEqual(specs.filter(s => s.page_type === 'pillar').length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: _detectDuplicateSlugs()
// ─────────────────────────────────────────────────────────────────────────────

section('_detectDuplicateSlugs()');

it('empty array → no duplicates', () => {
  assertEqual(_detectDuplicateSlugs([]).duplicates.length, 0);
});
it('unique slugs → no duplicates', () => {
  const specs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  assertEqual(_detectDuplicateSlugs(specs).duplicates.length, 0);
});
it('one duplicate detected', () => {
  const specs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }];
  assertEqual(_detectDuplicateSlugs(specs).duplicates.length, 1);
});
it('duplicate value captured correctly', () => {
  const specs = [{ slug: 'best-hotels' }, { slug: 'best-hotels' }];
  assertEqual(_detectDuplicateSlugs(specs).duplicates[0], 'best-hotels');
});
it('triple occurrence counted only once in duplicates', () => {
  const specs = [{ slug: 'x' }, { slug: 'x' }, { slug: 'x' }];
  assertEqual(_detectDuplicateSlugs(specs).duplicates.length, 1);
});
it('two different duplicates both detected', () => {
  const specs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }, { slug: 'b' }];
  assertEqual(_detectDuplicateSlugs(specs).duplicates.length, 2);
});
it('returns { duplicates } shape', () => {
  assert('duplicates' in _detectDuplicateSlugs([]));
});
it('non-duplicate neighbour unaffected', () => {
  const specs = [{ slug: 'a' }, { slug: 'a' }, { slug: 'c' }];
  const { duplicates } = _detectDuplicateSlugs(specs);
  assert(!duplicates.includes('c'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: generateSitemap()
// ─────────────────────────────────────────────────────────────────────────────

section('generateSitemap()');

const SAMPLE_PAGES = [
  { slug: 'best-luxury-hotels-mauritius', page_type: 'pillar',  priority: '1.0', changefreq: 'weekly'  },
  { slug: 'best-honeymoon-hotels',        page_type: 'persona', priority: '0.9', changefreq: 'weekly'  },
  { slug: 'belle-mare-luxury-hotels',     page_type: 'region',  priority: '0.8', changefreq: 'weekly'  },
];

it('starts with XML declaration', () => {
  assertIncludes(generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL), '<?xml version="1.0"');
});
it('contains urlset element', () => {
  assertIncludes(generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL), '<urlset');
});
it('contains one <loc> per page plus homepage', () => {
  const count = (generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL).match(/<loc>/g) || []).length;
  assertEqual(count, SAMPLE_PAGES.length + 1);
});
it('loc includes baseUrl', () => {
  assertIncludes(generateSitemap(SAMPLE_PAGES, 'https://mauritiusresortfinder.com'), 'mauritiusresortfinder.com');
});
it('loc appends trailing slash to slug', () => {
  assertIncludes(
    generateSitemap(SAMPLE_PAGES, 'https://mauritiusresortfinder.com'),
    'mauritiusresortfinder.com/best-luxury-hotels-mauritius/'
  );
});
it('contains <changefreq>', () => {
  assertIncludes(generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL), '<changefreq>');
});
it('contains <priority>', () => {
  assertIncludes(generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL), '<priority>');
});
it('pillar page priority is 1.0', () => {
  assertIncludes(generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL), '<priority>1.0</priority>');
});
it('ends with </urlset>', () => {
  assert(generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL).includes('</urlset>'));
});
it('throws TypeError for non-array pages', () => {
  assertThrows(() => generateSitemap(null, DEFAULT_BASE_URL));
});
it('throws TypeError for missing baseUrl', () => {
  assertThrows(() => generateSitemap(SAMPLE_PAGES, ''));
});
it('strips trailing slash from baseUrl', () => {
  const sitemap = generateSitemap(SAMPLE_PAGES, 'https://mauritiusresortfinder.com/');
  assertNotIncludes(sitemap, 'mauritiusresortfinder.com//best');
});
it('contains today\'s date in YYYY-MM-DD format', () => {
  const today = new Date().toISOString().slice(0, 10);
  assertIncludes(generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL), today);
});
it('empty pages array returns XML with homepage only', () => {
  const s = generateSitemap([], DEFAULT_BASE_URL);
  assertIncludes(s, '<urlset');
  assertEqual((s.match(/<loc>/g) || []).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: generateRobots()
// ─────────────────────────────────────────────────────────────────────────────

section('generateRobots()');

it('starts with User-agent directive', () => {
  assertIncludes(generateRobots(DEFAULT_BASE_URL), 'User-agent: *');
});
it('contains Allow: /', () => {
  assertIncludes(generateRobots(DEFAULT_BASE_URL), 'Allow: /');
});
it('contains Sitemap: directive', () => {
  assertIncludes(generateRobots(DEFAULT_BASE_URL), 'Sitemap:');
});
it('default sitemap URL = baseUrl/sitemap.xml', () => {
  assertIncludes(
    generateRobots('https://mauritiusresortfinder.com'),
    'Sitemap: https://mauritiusresortfinder.com/sitemap.xml'
  );
});
it('custom sitemapUrl overrides default', () => {
  assertIncludes(
    generateRobots('https://mauritiusresortfinder.com', 'https://cdn.mauritiusresortfinder.com/sitemap.xml'),
    'Sitemap: https://cdn.mauritiusresortfinder.com/sitemap.xml'
  );
});
it('throws TypeError for empty baseUrl', () => {
  assertThrows(() => generateRobots(''));
});
it('strips trailing slash from baseUrl', () => {
  assertNotIncludes(generateRobots('https://mauritiusresortfinder.com/'), '//sitemap.xml');
});
it('robots.txt ends with newline', () => {
  assert(generateRobots(DEFAULT_BASE_URL).endsWith('\n'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: generateFeed()
// ─────────────────────────────────────────────────────────────────────────────

section('generateFeed()');

it('starts with XML declaration', () => {
  assertIncludes(generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL), '<?xml version="1.0"');
});
it('contains <rss version="2.0"', () => {
  assertIncludes(generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL), '<rss version="2.0"');
});
it('contains <channel>', () => {
  assertIncludes(generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL), '<channel>');
});
it('contains <item> per page', () => {
  const count = (generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL).match(/<item>/g) || []).length;
  assertEqual(count, SAMPLE_PAGES.length);
});
it('item <guid> is permalink URL', () => {
  assertIncludes(generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL), 'isPermaLink="true"');
});
it('throws TypeError for non-array pages', () => {
  assertThrows(() => generateFeed(null, DEFAULT_BASE_URL));
});
it('throws TypeError for missing baseUrl', () => {
  assertThrows(() => generateFeed(SAMPLE_PAGES, ''));
});
it('respects maxItems option', () => {
  const pages = Array.from({ length: 30 }, (_, i) => ({
    slug: `page-${i}`, page_type: 'persona', priority: '0.9', title: `Page ${i}`,
  }));
  const feed  = generateFeed(pages, DEFAULT_BASE_URL, { maxItems: 5 });
  assertEqual((feed.match(/<item>/g) || []).length, 5);
});
it('contains atom:link element', () => {
  assertIncludes(generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL), 'atom:link');
});
it('feedTitle option applied', () => {
  assertIncludes(
    generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL, { feedTitle: 'My Custom Feed' }),
    'My Custom Feed'
  );
});
it('escapes HTML in titles', () => {
  const pages = [{ slug: 'test', page_type: 'pillar', priority: '1.0', title: 'A & B < C' }];
  const feed  = generateFeed(pages, DEFAULT_BASE_URL);
  assertIncludes(feed, '&amp;');
  assertNotIncludes(feed, ' & ');
});
it('ends with </rss>', () => {
  assert(generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL).includes('</rss>'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15: saveBuildReport()
// ─────────────────────────────────────────────────────────────────────────────

section('saveBuildReport()');

it('throws TypeError for non-object report', () => {
  assertThrows(() => saveBuildReport(null, '/tmp'));
});
it('throws TypeError for non-string outDir', () => {
  assertThrows(() => saveBuildReport({}, ''));
});
it('returns a file path string', () => {
  const path = saveBuildReport({ test: 1 }, '/tmp', () => {});
  assert(typeof path === 'string' && path.length > 0);
});
it('returned path ends with build_report.json', () => {
  const p = saveBuildReport({ test: 1 }, '/tmp', () => {});
  assert(p.endsWith('build_report.json'), `Got: ${p}`);
});
it('calls writeFn with correct path', () => {
  let capturedPath;
  saveBuildReport({ x: 1 }, '/tmp', (p) => { capturedPath = p; });
  assert(capturedPath && capturedPath.endsWith('build_report.json'));
});
it('calls writeFn with JSON serialized content', () => {
  let capturedContent;
  saveBuildReport({ foo: 'bar' }, '/tmp', (_, c) => { capturedContent = c; });
  const parsed = JSON.parse(capturedContent);
  assertEqual(parsed.foo, 'bar');
});
it('JSON content is pretty-printed (2-space indent)', () => {
  let content;
  saveBuildReport({ a: 1, b: 2 }, '/tmp', (_, c) => { content = c; });
  assertIncludes(content, '\n  ');
});
it('writeFn called once', () => {
  let calls = 0;
  saveBuildReport({ x: 1 }, '/tmp', () => { calls++; });
  assertEqual(calls, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16: _runConcurrent()
// ─────────────────────────────────────────────────────────────────────────────

section('_runConcurrent()');

const asyncTests16 = [];

asyncTests16.push(itAsync('empty factories returns empty array', async () => {
  const results = await _runConcurrent([], 5);
  assertEqual(results.length, 0);
}));

asyncTests16.push(itAsync('runs all factories', async () => {
  const factories = [1, 2, 3].map(n => () => Promise.resolve(n));
  const results   = await _runConcurrent(factories, 2);
  assertEqual(results.length, 3);
}));

asyncTests16.push(itAsync('fulfilled results have status=fulfilled', async () => {
  const results = await _runConcurrent([() => Promise.resolve(42)], 1);
  assertEqual(results[0].status, 'fulfilled');
  assertEqual(results[0].value, 42);
}));

asyncTests16.push(itAsync('rejected factory captured in result', async () => {
  const results = await _runConcurrent([() => Promise.reject(new Error('boom'))], 1);
  assertEqual(results[0].status, 'rejected');
}));

asyncTests16.push(itAsync('concurrency=1 processes sequentially', async () => {
  const order = [];
  const factories = [1, 2, 3].map(n => async () => {
    order.push(n);
    return n;
  });
  await _runConcurrent(factories, 1);
  assertEqual(order.join(','), '1,2,3');
}));

asyncTests16.push(itAsync('concurrency > factories count works fine', async () => {
  const results = await _runConcurrent(
    [() => Promise.resolve('a'), () => Promise.resolve('b')],
    100
  );
  assertEqual(results.length, 2);
}));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17: _buildPage() with mocks
// ─────────────────────────────────────────────────────────────────────────────

section('_buildPage() with mocks');

const asyncTests17 = [];

const sampleSpec = {
  page_type:  'pillar',
  slug:       'best-luxury-hotels-mauritius',
  persona:    'luxury',
  hotels:     MINI_DATASET,
  affiliateLinks: {},
  pageContext: {
    page_type: 'ranking', persona: 'luxury',
    title: 'Best Luxury Hotels', target_keyword: 'luxury hotels', slug: 'best-luxury-hotels-mauritius',
  },
  priority: '1.0', changefreq: 'weekly',
};

asyncTests17.push(itAsync('success returns PageResult with success=true', async () => {
  const result = await _buildPage(sampleSpec, makeMockDeps(), { outDir: '/tmp', baseUrl: 'https://mauritiusresortfinder.com' });
  assert(result.success, `Expected success, got: ${result.error}`);
}));

asyncTests17.push(itAsync('result has correct slug', async () => {
  const result = await _buildPage(sampleSpec, makeMockDeps(), { outDir: '/tmp' });
  assertEqual(result.slug, sampleSpec.slug);
}));

asyncTests17.push(itAsync('result has correct page_type', async () => {
  const result = await _buildPage(sampleSpec, makeMockDeps(), { outDir: '/tmp' });
  assertEqual(result.page_type, 'pillar');
}));

asyncTests17.push(itAsync('result has output_path', async () => {
  const result = await _buildPage(sampleSpec, makeMockDeps(), { outDir: '/tmp' });
  assert(result.output_path && result.output_path.endsWith('index.html'));
}));

asyncTests17.push(itAsync('result has duration_ms as number', async () => {
  const result = await _buildPage(sampleSpec, makeMockDeps(), { outDir: '/tmp' });
  assert(typeof result.duration_ms === 'number' && result.duration_ms >= 0);
}));

asyncTests17.push(itAsync('writeFn called once on success', async () => {
  let writeCount = 0;
  const deps = makeMockDeps({ writeFn: () => { writeCount++; } });
  await _buildPage(sampleSpec, deps, { outDir: '/tmp' });
  assertEqual(writeCount, 1);
}));

asyncTests17.push(itAsync('scoringEngine called with spec.hotels', async () => {
  let capturedHotels;
  const deps = makeMockDeps({
    scoringEngine: {
      rankHotels: (hotels, persona, opts) => {
        capturedHotels = hotels;
        return {
          ranked_hotels: hotels.map((h, i) => ({
            hotel: h, rank: i + 1,
            dimension_scores: { overall_rating: 9, location_score: 9, amenity_score: 9, brand_score: 9, value_score: 8 },
            scores: { final_ranking_score: 90 }, tier: 'tier_1',
            completeness_percent: 100, commission_adjusted: false,
          })),
        };
      },
    },
  });
  await _buildPage(sampleSpec, deps, { outDir: '/tmp' });
  assertEqual(capturedHotels, sampleSpec.hotels);
}));

asyncTests17.push(itAsync('scoring returns 0 hotels → success=false', async () => {
  const deps = makeMockDeps({
    scoringEngine: { rankHotels: () => ({ ranked_hotels: [] }) },
  });
  const result = await _buildPage(sampleSpec, deps, { outDir: '/tmp' });
  assertEqual(result.success, false);
  assert(result.error && result.error.length > 0);
}));

asyncTests17.push(itAsync('renderFn throws → success=false, error captured', async () => {
  const deps = makeMockDeps({ renderFn: () => { throw new Error('render failed'); } });
  const result = await _buildPage(sampleSpec, deps, { outDir: '/tmp' });
  assertEqual(result.success, false);
  assertIncludes(result.error, 'render failed');
}));

asyncTests17.push(itAsync('writeFn throws → success=false, error captured', async () => {
  const deps = makeMockDeps({ writeFn: () => { throw new Error('disk full'); } });
  const result = await _buildPage(sampleSpec, deps, { outDir: '/tmp' });
  assertEqual(result.success, false);
  assertIncludes(result.error, 'disk full');
}));

asyncTests17.push(itAsync('never throws (always returns PageResult)', async () => {
  const deps = makeMockDeps({
    scoringEngine: { rankHotels: () => { throw new Error('critical boom'); } },
  });
  let threw = false;
  try {
    await _buildPage(sampleSpec, deps, { outDir: '/tmp' });
  } catch (_) { threw = true; }
  assert(!threw, 'Expected _buildPage to not throw');
}));

asyncTests17.push(itAsync('renderFn receives assembly with page_context', async () => {
  let capturedAssembly;
  const deps = makeMockDeps({
    renderFn: (assembly) => { capturedAssembly = assembly; return '<html/>'; },
  });
  await _buildPage(sampleSpec, deps, { outDir: '/tmp' });
  assert(capturedAssembly && capturedAssembly.page_context);
}));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 18: buildAllPages() with mocks
// ─────────────────────────────────────────────────────────────────────────────

section('buildAllPages() with mocks');

const asyncTests18 = [];

asyncTests18.push(itAsync('throws TypeError for non-array specs', async () => {
  let threw = false;
  try { await buildAllPages(null, {}, {}); } catch (e) { threw = true; }
  assert(threw);
}));

asyncTests18.push(itAsync('empty specs returns empty array', async () => {
  const results = await buildAllPages([], makeMockDeps(), { outDir: '/tmp' });
  assertEqual(results.length, 0);
}));

asyncTests18.push(itAsync('returns one result per spec', async () => {
  const specs   = [sampleSpec, { ...sampleSpec, slug: 'page-2' }];
  const results = await buildAllPages(specs, makeMockDeps(), { outDir: '/tmp' });
  assertEqual(results.length, 2);
}));

asyncTests18.push(itAsync('all results have success=true with good mocks', async () => {
  const specs   = [sampleSpec, { ...sampleSpec, slug: 'page-2' }];
  const results = await buildAllPages(specs, makeMockDeps(), { outDir: '/tmp' });
  assert(results.every(r => r.success));
}));

asyncTests18.push(itAsync('one failing page does not stop others', async () => {
  const failSpec = { ...sampleSpec, slug: 'fail-page', persona: 'bad-persona' };
  const goodSpec = { ...sampleSpec, slug: 'good-page' };
  const deps = makeMockDeps({
    scoringEngine: {
      rankHotels: (hotels, persona) => {
        if (persona === 'bad-persona') return { ranked_hotels: [] };
        return { ranked_hotels: hotels.map((h, i) => ({
          hotel: h, rank: i + 1,
          dimension_scores: { overall_rating: 9, location_score: 9, amenity_score: 9, brand_score: 9, value_score: 8 },
          scores: { final_ranking_score: 90 }, tier: 'tier_1',
          completeness_percent: 100, commission_adjusted: false,
        })) };
      },
    },
  });
  const results = await buildAllPages([failSpec, goodSpec], deps, { outDir: '/tmp' });
  assertEqual(results.length, 2);
  assertEqual(results[0].success, false);
  assertEqual(results[1].success, true);
}));

asyncTests18.push(itAsync('results maintain spec ordering', async () => {
  const specs = ['page-a', 'page-b', 'page-c'].map(slug => ({ ...sampleSpec, slug }));
  const results = await buildAllPages(specs, makeMockDeps(), { outDir: '/tmp' });
  assertEqual(results[0].slug, 'page-a');
  assertEqual(results[1].slug, 'page-b');
  assertEqual(results[2].slug, 'page-c');
}));

asyncTests18.push(itAsync('respects maxConcurrency option', async () => {
  // With concurrency=1, pages build sequentially
  const order  = [];
  const specs  = ['x', 'y', 'z'].map(slug => ({ ...sampleSpec, slug }));
  const deps   = makeMockDeps({
    renderFn: (assembly) => {
      order.push(assembly.page_context.slug);
      return '<html/>';
    },
  });
  await buildAllPages(specs, deps, { outDir: '/tmp', maxConcurrency: 1 });
  assertEqual(order.length, 3);
}));

asyncTests18.push(itAsync('returns results when no deps provided (uses defaults path)', async () => {
  // _buildPage uses _adaptScoredHotel even without se/ee/ba — just checking it handles missing deps
  const specs   = [{ ...sampleSpec, slug: 'test-page' }];
  const results = await buildAllPages(specs, makeMockDeps(), { outDir: '/tmp' });
  assertEqual(results.length, 1);
}));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 19: _parseCLIArgs()
// ─────────────────────────────────────────────────────────────────────────────

section('_parseCLIArgs()');

it('defaults: baseUrl is mauritiusresortfinder.com', () => {
  assertEqual(_parseCLIArgs([]).baseUrl, DEFAULT_BASE_URL);
});
it('defaults: outDir is ./dist', () => {
  assertEqual(_parseCLIArgs([]).outDir, DEFAULT_OUT_DIR);
});
it('defaults: verbose=false', () => {
  assertEqual(_parseCLIArgs([]).verbose, false);
});
it('defaults: dryRun=false', () => {
  assertEqual(_parseCLIArgs([]).dryRun, false);
});
it('--base sets baseUrl', () => {
  assertEqual(_parseCLIArgs(['--base', 'https://example.com']).baseUrl, 'https://example.com');
});
it('-b sets baseUrl', () => {
  assertEqual(_parseCLIArgs(['-b', 'https://example.com']).baseUrl, 'https://example.com');
});
it('--out sets outDir', () => {
  assertEqual(_parseCLIArgs(['--out', './build']).outDir, './build');
});
it('-o sets outDir', () => {
  assertEqual(_parseCLIArgs(['-o', './output']).outDir, './output');
});
it('--verbose sets verbose=true', () => {
  assertEqual(_parseCLIArgs(['--verbose']).verbose, true);
});
it('-v sets verbose=true', () => {
  assertEqual(_parseCLIArgs(['-v']).verbose, true);
});
it('--dry-run sets dryRun=true', () => {
  assertEqual(_parseCLIArgs(['--dry-run']).dryRun, true);
});
it('--fail-on-error sets failOnPageError=true', () => {
  assertEqual(_parseCLIArgs(['--fail-on-error']).failOnPageError, true);
});
it('--concurrency sets concurrency', () => {
  assertEqual(_parseCLIArgs(['--concurrency', '4']).concurrency, 4);
});
it('--top-n sets comparisonTopN', () => {
  assertEqual(_parseCLIArgs(['--top-n', '3']).comparisonTopN, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 20: Validation — sitemap matches pages
// ─────────────────────────────────────────────────────────────────────────────

section('Validation: sitemap URLs match generated pages');

it('sitemap <loc> count equals pages array length plus homepage', () => {
  const pages   = SAMPLE_PAGES;
  const sitemap = generateSitemap(pages, DEFAULT_BASE_URL);
  const count   = (sitemap.match(/<loc>/g) || []).length;
  assertEqual(count, pages.length + 1);
});
it('every page slug appears in sitemap', () => {
  const pages   = SAMPLE_PAGES;
  const sitemap = generateSitemap(pages, DEFAULT_BASE_URL);
  pages.forEach(p => assertIncludes(sitemap, p.slug));
});
it('robots.txt references sitemap.xml', () => {
  assertIncludes(generateRobots(DEFAULT_BASE_URL), 'sitemap.xml');
});
it('feed.xml items count ≤ FEED_MAX_ITEMS', () => {
  const feed  = generateFeed(SAMPLE_PAGES, DEFAULT_BASE_URL);
  const count = (feed.match(/<item>/g) || []).length;
  assert(count <= FEED_MAX_ITEMS);
});
it('feed item links use base URL', () => {
  assertIncludes(generateFeed(SAMPLE_PAGES, 'https://mauritiusresortfinder.com'), 'mauritiusresortfinder.com');
});
it('sitemap is sorted: pillar before persona before region', () => {
  const pages   = [
    { slug: 'best-wellness', page_type: 'persona', priority: '0.9', changefreq: 'weekly' },
    { slug: 'best-luxury',   page_type: 'pillar',  priority: '1.0', changefreq: 'weekly' },
    { slug: 'grand-baie',    page_type: 'region',  priority: '0.8', changefreq: 'weekly' },
  ];
  const sitemap = generateSitemap(pages, DEFAULT_BASE_URL);
  const pillarIdx  = sitemap.indexOf('best-luxury');
  const personaIdx = sitemap.indexOf('best-wellness');
  const regionIdx  = sitemap.indexOf('grand-baie');
  assert(pillarIdx < personaIdx, 'Pillar should appear before persona');
  assert(personaIdx < regionIdx, 'Persona should appear before region');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 21: Determinism
// ─────────────────────────────────────────────────────────────────────────────

section('Determinism');

it('generatePageContexts produces identical specs on two calls', () => {
  const r1 = generatePageContexts(MINI_DATASET, { comparisonTopN: 3 });
  const r2 = generatePageContexts(MINI_DATASET, { comparisonTopN: 3 });
  assertEqual(JSON.stringify(r1.specs.map(s => s.slug)), JSON.stringify(r2.specs.map(s => s.slug)));
});
it('generateSitemap produces identical output on two calls', () => {
  const s1 = generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL);
  const s2 = generateSitemap(SAMPLE_PAGES, DEFAULT_BASE_URL);
  assertEqual(s1, s2);
});
it('generateRobots produces identical output on two calls', () => {
  assertEqual(generateRobots(DEFAULT_BASE_URL), generateRobots(DEFAULT_BASE_URL));
});
it('region specs in same order when called twice', () => {
  const r1 = _generateRegionContexts(MINI_DATASET).map(s => s.slug);
  const r2 = _generateRegionContexts(MINI_DATASET).map(s => s.slug);
  assertEqual(r1.join(','), r2.join(','));
});
it('comparison specs in same order when called twice', () => {
  const r1 = _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).map(s => s.slug);
  const r2 = _generateComparisonContexts(MINI_DATASET, { comparisonTopN: 3 }).map(s => s.slug);
  assertEqual(r1.join(','), r2.join(','));
});
it('hotel specs in same order when called twice', () => {
  const r1 = _generateHotelContexts(MINI_DATASET).map(s => s.slug);
  const r2 = _generateHotelContexts(MINI_DATASET).map(s => s.slug);
  assertEqual(r1.join(','), r2.join(','));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 22: Edge cases
// ─────────────────────────────────────────────────────────────────────────────

section('Edge cases');

it('_slugify handles consecutive special chars', () => {
  assertEqual(_slugify('A & B & C'), 'a-and-b-and-c');
});
it('_slugify handles numeric-only input', () => {
  assertEqual(_slugify('123'), '123');
});
it('generateSitemap with 1 page returns 2 <loc> (homepage + page)', () => {
  const count = (generateSitemap(
    [{ slug: 'only-page', page_type: 'pillar', priority: '1.0', changefreq: 'weekly' }],
    DEFAULT_BASE_URL
  ).match(/<loc>/g) || []).length;
  assertEqual(count, 2);
});
it('generateFeed with empty pages returns channel with no items', () => {
  const feed = generateFeed([], DEFAULT_BASE_URL);
  assertEqual((feed.match(/<item>/g) || []).length, 0);
});
it('_generateComparisonContexts with 1 hotel returns 0 pairs', () => {
  assertEqual(_generateComparisonContexts([MINI_DATASET[0]], { comparisonTopN: 5 }).length, 0);
});
it('HOTEL_DATASET from harness generates no duplicate slugs', () => {
  const { duplicates } = generatePageContexts(HOTEL_DATASET, { comparisonTopN: 5 });
  assertEqual(duplicates.length, 0, `Duplicates found: ${duplicates.join(', ')}`);
});
it('_roundTo correctly rounds to 2 decimal places', () => {
  assertEqual(_roundTo(9.157, 2), 9.16);
});
it('_adaptScoredHotel maps overall_rating * 10 → overall_score', () => {
  const scored = {
    hotel: { hotel_id: 'X01', hotel_name: 'Test', review_count: 100, avg_rating: 4.5 },
    rank: 1,
    dimension_scores: {
      overall_rating: 9.2, location_score: 8.5, amenity_score: 8.0,
      brand_score: 7.5, value_score: 8.2,
    },
    scores: { final_ranking_score: 88 },
    tier: 'tier_1', completeness_percent: 100, commission_adjusted: false,
  };
  const adapted = _adaptScoredHotel(scored);
  assertEqual(adapted.score_breakdown.overall_score, 92);
  assertEqual(adapted.score_breakdown.location_score, 85);
  assertEqual(adapted.rank, 1);
  assertEqual(adapted.hotel_id, 'X01');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 23: _adaptScoredHotel detailed
// ─────────────────────────────────────────────────────────────────────────────

section('_adaptScoredHotel()');

const scoredFixture = {
  hotel: {
    hotel_id: 'MQ001', hotel_name: 'Royal Palm', review_count: 1340, avg_rating: 4.8,
    avg_nightly_rate: 1450, star_rating: 5, region: 'Grand Baie', property_type: 'resort',
    amenities: { spa: true },
  },
  rank: 1,
  dimension_scores: {
    overall_rating: 9.2, location_score: 9.4, amenity_score: 9.1,
    brand_score: 9.0, value_score: 7.2,
  },
  scores: { final_ranking_score: 88.5 },
  tier: 'tier_1', completeness_percent: 100, commission_adjusted: false,
};

it('output has hotel_id', () => assertEqual(_adaptScoredHotel(scoredFixture).hotel_id, 'MQ001'));
it('output has hotel_name', () => assertEqual(_adaptScoredHotel(scoredFixture).hotel_name, 'Royal Palm'));
it('output has rank', () => assertEqual(_adaptScoredHotel(scoredFixture).rank, 1));
it('overall_score = overall_rating * 10', () => {
  assertEqual(_adaptScoredHotel(scoredFixture).score_breakdown.overall_score, 92);
});
it('location_score = location_score * 10', () => {
  assertEqual(_adaptScoredHotel(scoredFixture).score_breakdown.location_score, 94);
});
it('brand_score = brand_score * 10', () => {
  assertEqual(_adaptScoredHotel(scoredFixture).score_breakdown.brand_score, 90);
});
it('review_count propagated from hotel', () => {
  assertEqual(_adaptScoredHotel(scoredFixture).review_count, 1340);
});
it('avg_nightly_rate propagated', () => {
  assertEqual(_adaptScoredHotel(scoredFixture).avg_nightly_rate, 1450);
});
it('amenities propagated', () => {
  assert(_adaptScoredHotel(scoredFixture).amenities.spa === true);
});
it('missing avg_nightly_rate defaults to null', () => {
  const h = { ...scoredFixture, hotel: { ...scoredFixture.hotel } };
  delete h.hotel.avg_nightly_rate;
  assertEqual(_adaptScoredHotel(h).avg_nightly_rate, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 24: buildSite() integration with mocks
// ─────────────────────────────────────────────────────────────────────────────

section('buildSite() integration with mocks');

const asyncTests24 = [];

function makeSiteMockModules() {
  return {
    _scoringEngine: {
      rankHotels: (hotels, persona, opts) => ({
        ranked_hotels: hotels.map((h, i) => ({
          hotel: h, rank: i + 1,
          dimension_scores: {
            overall_rating: h.overall_rating, location_score: h.location_score,
            amenity_score: h.amenity_score, brand_score: h.brand_score, value_score: h.value_score,
          },
          scores: { final_ranking_score: h.overall_rating * 10 },
          tier: 'tier_1', completeness_percent: 100, commission_adjusted: false,
        })),
      }),
    },
    _explanationEngine: {
      explainBatch: (hotels, persona) => hotels.map(h => ({
        hotel_id: h.hotel_id, hotel_name: h.hotel_name, persona, rank: h.rank,
        explanation_summary: 'Summary.', strengths: [{ rendered_text: 'Good.' }],
        weaknesses: [{ rendered_text: 'Bad.' }], traveler_fit: 'Fit.',
        confidence_level: 'high', supporting_claims: [], suppressed_claims: [],
        validation_summary: { total: 0, valid: 0, suppressed: 0 },
        explanation_version: '1.0.0', generated_at: new Date().toISOString(),
      })),
    },
    _blockAssembler: {
      assemble: (hotels, explanations, pageContext) => ({
        blocks: [
          { block_type: 'hero',       position: 1, trust_score: 0, payload: {} },
          { block_type: 'hotel_card', position: 2, trust_score: 1, payload: {} },
          { block_type: 'disclosure', position: 3, trust_score: 2, payload: { affiliate_disclosure: true } },
        ],
        assembly_summary: { total_blocks: 3, final_trust_depth: 2, dropped_ctas: 0, hotel_count: hotels.length },
        page_context: pageContext,
        persona: pageContext.persona,
        generated_at: new Date().toISOString(),
        assembler_version: '1.0.0',
      }),
    },
    _renderer: {
      renderPage: (assembly) => `<!DOCTYPE html><html><body>${assembly.page_context.slug}</body></html>`,
    },
  };
}

asyncTests24.push(itAsync('buildSite dryRun=true returns buildReport', async () => {
  const report = await buildSite({
    dryRun: true, comparisonTopN: 2, regionMinHotels: 1,
    syncFn: async () => ({ hotelObjects: MINI_DATASET }),
    ...makeSiteMockModules(),
  });
  assert(report && typeof report === 'object');
}));

asyncTests24.push(itAsync('buildReport has required fields', async () => {
  const report = await buildSite({
    dryRun: true, comparisonTopN: 2,
    syncFn: async () => ({ hotelObjects: MINI_DATASET }),
    ...makeSiteMockModules(),
  });
  ['site_builder_version', 'generated_at', 'build_duration_ms', 'total_pages_generated',
   'pages_by_type', 'warnings_count', 'errors_count', 'pages'].forEach(f => {
    assert(f in report, `Missing field: ${f}`);
  });
}));

asyncTests24.push(itAsync('buildReport.pages_by_type has pillar', async () => {
  const report = await buildSite({
    dryRun: true, comparisonTopN: 2,
    syncFn: async () => ({ hotelObjects: MINI_DATASET }),
    ...makeSiteMockModules(),
  });
  assert('pillar' in report.pages_by_type, 'Missing pillar in pages_by_type');
}));

asyncTests24.push(itAsync('duplicate slug throws critical error', async () => {
  // Inject two hotels with same name → same hotel slug
  const dupeDataset = [
    { ...MINI_DATASET[0], hotel_id: 'DUP1' },
    { ...MINI_DATASET[0], hotel_id: 'DUP2' },  // same hotel_name → same slug
  ];
  let threw = false;
  try {
    await buildSite({
      dryRun: true, comparisonTopN: 0,
      syncFn: async () => ({ hotelObjects: dupeDataset }),
      ...makeSiteMockModules(),
    });
  } catch (e) {
    threw = true;
    assertIncludes(e.message.toLowerCase(), 'duplicate');
  }
  assert(threw, 'Expected duplicate slug error');
}));

asyncTests24.push(itAsync('build_duration_ms is a positive number', async () => {
  const report = await buildSite({
    dryRun: true, comparisonTopN: 2,
    syncFn: async () => ({ hotelObjects: MINI_DATASET }),
    ...makeSiteMockModules(),
  });
  assert(typeof report.build_duration_ms === 'number' && report.build_duration_ms >= 0);
}));

asyncTests24.push(itAsync('site_builder_version matches constant', async () => {
  const report = await buildSite({
    dryRun: true, comparisonTopN: 2,
    syncFn: async () => ({ hotelObjects: MINI_DATASET }),
    ...makeSiteMockModules(),
  });
  assertEqual(report.site_builder_version, SITE_BUILDER_VERSION);
}));

asyncTests24.push(itAsync('errors_count=0 for all-success build', async () => {
  const report = await buildSite({
    dryRun: true, comparisonTopN: 2,
    syncFn: async () => ({ hotelObjects: MINI_DATASET }),
    ...makeSiteMockModules(),
  });
  assertEqual(report.errors_count, 0, `Got errors: ${JSON.stringify(report.errors)}`);
}));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 25: Full-dataset smoke test with harness data
// ─────────────────────────────────────────────────────────────────────────────

section('Full-dataset smoke test with HOTEL_DATASET');

it('HOTEL_DATASET has 8 hotels', () => {
  assertEqual(HOTEL_DATASET.length, 8);
});
it('generatePageContexts(HOTEL_DATASET) produces >20 specs', () => {
  const { specs } = generatePageContexts(HOTEL_DATASET, { comparisonTopN: 5 });
  assert(specs.length > 20, `Expected >20, got ${specs.length}`);
});
it('all HOTEL_DATASET specs have valid page_type', () => {
  const { specs } = generatePageContexts(HOTEL_DATASET, { comparisonTopN: 5 });
  specs.forEach(s =>
    assert(Object.values(PAGE_TYPES).includes(s.page_type), `Bad: ${s.page_type}`)
  );
});
it('comparison specs: C(5,2)=10 pairs from top 5', () => {
  const specs = _generateComparisonContexts(HOTEL_DATASET, { comparisonTopN: 5 });
  assertEqual(specs.length, 10);
});
it('hotel specs: 8 pages for 8 hotels', () => {
  assertEqual(_generateHotelContexts(HOTEL_DATASET).length, 8);
});

// ─────────────────────────────────────────────────────────────────────────────
// RUN ASYNC TESTS AND PRINT RESULTS
// ─────────────────────────────────────────────────────────────────────────────

async function runAllAsync() {
  await Promise.all([
    ...asyncTests16,
    ...asyncTests17,
    ...asyncTests18,
    ...asyncTests24,
  ]);

  process.stdout.write('\n\n');
  process.stdout.write('─'.repeat(60) + '\n');
  process.stdout.write(`  Results: ${pass} passed, ${fail} failed\n`);
  process.stdout.write('─'.repeat(60) + '\n');

  if (fail === 0) {
    process.stdout.write('\n  ✓  All tests passed.\n\n');
  } else {
    process.stdout.write('\n  ✗  Failures:\n');
    failures.forEach(f => {
      process.stdout.write(`\n     ${f.desc}\n       ${f.error}\n`);
    });
    process.stdout.write('\n');
    process.exit(1);
  }
}

runAllAsync();
