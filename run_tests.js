#!/usr/bin/env node
/**
 * run_tests.js
 * Mauritius Resort Finder — Master Test Runner
 *
 * Runs all 8 test suites sequentially and reports a combined result.
 * Exit code 0 = all suites passed. Exit code 1 = one or more failures.
 *
 * Usage:  node run_tests.js
 *         npm test
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const SUITES = [
  'scoring_engine.test.js',
  'hallucination_guard.test.js',
  'confidence_enforcer.test.js',
  'explanation_engine.test.js',
  'block_assembler.test.js',
  'static_page_renderer.test.js',
  'airtable_sync.test.js',
  'site_builder.test.js',
  'hotel_content_engine.test.js',
  'seo_outreach.test.js',
  'contact_api.test.js',
  'security.test.js',
  'search.test.js',
  'hotel_image_engine.test.js',
  'social_card_engine.test.js',
];

const WIDTH = 64;
const LINE  = '─'.repeat(WIDTH);

console.log('\n' + '═'.repeat(WIDTH));
console.log('  Mauritius Resort Finder — Full Test Suite');
console.log('═'.repeat(WIDTH));

let totalPassed = 0;
let totalFailed = 0;
const failedSuites = [];

for (const suite of SUITES) {
  const suitePath = path.join(__dirname, suite);
  process.stdout.write(`\n  Running ${suite} ...\n`);

  try {
    const output = execSync(`node "${suitePath}"`, {
      encoding: 'utf8',
      timeout:  60_000,
      cwd: __dirname,
    });

    // Extract pass/fail counts — each suite uses a slightly different format
    const passMatch = output.match(/(\d+)\s+passed/i) || output.match(/ALL (\d+) TESTS PASSED/i);
    const failMatch = output.match(/(\d+)\s+failed/i);

    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;

    totalPassed += passed;
    totalFailed += failed;

    if (failed > 0) {
      failedSuites.push({ suite, passed, failed });
      process.stdout.write(`  ✗  ${suite}: ${passed} passed, ${failed} FAILED\n`);
    } else {
      process.stdout.write(`  ✓  ${suite}: ${passed} passed\n`);
    }
  } catch (err) {
    totalFailed++;
    failedSuites.push({ suite, error: err.message.split('\n')[0] });
    process.stdout.write(`  ✗  ${suite}: SUITE CRASHED — ${err.message.split('\n')[0]}\n`);
  }
}

console.log('\n' + '═'.repeat(WIDTH));
console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
console.log('═'.repeat(WIDTH));

if (failedSuites.length > 0) {
  console.log('\n  Failed suites:');
  failedSuites.forEach(s => {
    if (s.error) {
      console.log(`    ✗  ${s.suite}: ${s.error}`);
    } else {
      console.log(`    ✗  ${s.suite}: ${s.passed} passed, ${s.failed} failed`);
    }
  });
  console.log('');
  process.exit(1);
} else {
  console.log(`\n  ✓  All ${SUITES.length} suites passed.\n`);
  // SUITES count: 11 engine suites + 1 security suite + 1 search suite + 1 image engine suite + 1 social card suite = 15 total
  process.exit(0);
}
