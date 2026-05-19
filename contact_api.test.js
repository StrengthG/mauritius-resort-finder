/**
 * contact_api.test.js
 * Mauritius Resort Finder — Contact API Test Suite
 *
 * Tests the validation, honeypot, and rate-limiting logic extracted from
 * functions/api/contact.js. Uses no test framework — plain Node.js asserts.
 *
 * Run: node contact_api.test.js
 */

'use strict';

// ─── Inline the logic under test ─────────────────────────────────────────────
// Matches functions/api/contact.js — kept in sync manually.

const NAME_RE  = /^[\p{L}\s'\-]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateContact({ name, email, message, website }) {
  if (typeof website === 'string' && website.length > 0) {
    return { ok: false, honeypot: true };
  }
  const errors = [];
  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('Full name is required.');
  } else {
    const n = name.trim();
    if (n.length < 2)     errors.push('Name must be at least 2 characters.');
    if (n.length > 100)   errors.push('Name must be 100 characters or fewer.');
    if (!NAME_RE.test(n)) errors.push('Name may only contain letters, spaces, hyphens, and apostrophes.');
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    errors.push('Email address is required.');
  } else {
    const e = email.trim();
    if (e.length > 254)      errors.push('Email address is too long.');
    if (!EMAIL_RE.test(e))   errors.push('Please enter a valid email address.');
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    errors.push('Message is required.');
  } else {
    const m = message.trim();
    if (m.length < 10)   errors.push('Message must be at least 10 characters.');
    if (m.length > 5000) errors.push('Message must be 5,000 characters or fewer.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, name: name.trim(), email: email.trim(), message: message.trim() };
}

// Rate limiter logic (matching functions/api/contact.js)
function makeRateLimiter(limit, windowMs) {
  const store = new Map();
  return function check(ip) {
    const now = Date.now();
    const ts  = (store.get(ip) || []).filter(t => now - t < windowMs);
    if (ts.length >= limit) { store.set(ip, ts); return false; }
    ts.push(now);
    store.set(ip, ts);
    return true;
  };
}

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write(`  ✓ ${message}\n`);
  } else {
    failed++;
    failures.push(message);
    process.stdout.write(`  ✗ FAIL: ${message}\n`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    failures.push(message);
    process.stdout.write(`  ✗ FAIL (no throw): ${message}\n`);
  } catch {
    passed++;
    process.stdout.write(`  ✓ ${message}\n`);
  }
}

function section(title) {
  process.stdout.write(`\nSection: ${title}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Valid submissions
// ─────────────────────────────────────────────────────────────────────────────

section('1: Valid submissions');

const valid = {
  name:    'Marie Dupont',
  email:   'marie@example.com',
  message: 'Hello, I have a question about the Royal Palm hotel. Is it suitable for a honeymoon?',
};

const r1 = validateContact(valid);
assert(r1.ok === true,                       'valid: ok is true');
assert(r1.name    === 'Marie Dupont',        'valid: name trimmed correctly');
assert(r1.email   === 'marie@example.com',   'valid: email preserved');
assert(r1.message.startsWith('Hello'),       'valid: message preserved');

const r2 = validateContact({ ...valid, name: '  João  ' });
assert(r2.ok === true,        'valid: leading/trailing whitespace trimmed from name');
assert(r2.name === 'João',    'valid: Unicode letter name accepted');

const r3 = validateContact({ ...valid, name: "Mary-Jane O'Brien" });
assert(r3.ok === true, "valid: hyphen and apostrophe in name accepted");

const r4 = validateContact({ ...valid, email: 'user+tag@subdomain.example.co.uk' });
assert(r4.ok === true, 'valid: complex email format accepted');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Missing required fields
// ─────────────────────────────────────────────────────────────────────────────

section('2: Missing required fields');

const noName = validateContact({ ...valid, name: '' });
assert(!noName.ok,                           'missing name: rejected');
assert(noName.errors.some(e => e.toLowerCase().includes('name')), 'missing name: error mentions name');

const noEmail = validateContact({ ...valid, email: '' });
assert(!noEmail.ok,                          'missing email: rejected');
assert(noEmail.errors.some(e => e.toLowerCase().includes('email')), 'missing email: error mentions email');

const noMsg = validateContact({ ...valid, message: '' });
assert(!noMsg.ok,                            'missing message: rejected');
assert(noMsg.errors.some(e => e.toLowerCase().includes('message')), 'missing message: error mentions message');

const allMissing = validateContact({ name: '', email: '', message: '' });
assert(!allMissing.ok,                       'all fields missing: rejected');
assert(allMissing.errors.length === 3,       'all fields missing: 3 errors returned');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Invalid email formats
// ─────────────────────────────────────────────────────────────────────────────

section('3: Invalid email formats');

const badEmails = [
  'notanemail',
  'missing@tld',
  '@nodomain.com',
  'spaces in@email.com',
  'double@@sign.com',
];
badEmails.forEach(function (e) {
  const r = validateContact({ ...valid, email: e });
  assert(!r.ok, `invalid email rejected: "${e}"`);
});

const longEmail = 'a'.repeat(245) + '@example.com'; // > 254 chars
const rLong = validateContact({ ...valid, email: longEmail });
assert(!rLong.ok, 'email > 254 chars rejected');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Name validation rules
// ─────────────────────────────────────────────────────────────────────────────

section('4: Name validation');

const shortName = validateContact({ ...valid, name: 'A' });
assert(!shortName.ok, 'name < 2 chars rejected');
assert(shortName.errors.some(e => e.includes('2 characters')), 'name: correct min-length error');

const longName = validateContact({ ...valid, name: 'A'.repeat(101) });
assert(!longName.ok, 'name > 100 chars rejected');

const badCharsName = validateContact({ ...valid, name: 'John<script>' });
assert(!badCharsName.ok, 'name with angle brackets rejected');

const numericName = validateContact({ ...valid, name: 'User123' });
assert(!numericName.ok, 'name with digits rejected');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Message length validation
// ─────────────────────────────────────────────────────────────────────────────

section('5: Message length');

const shortMsg = validateContact({ ...valid, message: 'Too short' }); // 9 chars
assert(!shortMsg.ok, 'message < 10 chars rejected');

const exactMin = validateContact({ ...valid, message: 'ABCDEFGHIJ' }); // 10 chars
assert(exactMin.ok, 'message exactly 10 chars accepted');

const longMsg = validateContact({ ...valid, message: 'M'.repeat(5001) });
assert(!longMsg.ok, 'message > 5000 chars rejected');

const exactMax = validateContact({ ...valid, message: 'M'.repeat(5000) });
assert(exactMax.ok, 'message exactly 5000 chars accepted');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Honeypot detection
// ─────────────────────────────────────────────────────────────────────────────

section('6: Honeypot rejection');

const honeypotFilled = validateContact({ ...valid, website: 'https://spam.example.com' });
assert(!honeypotFilled.ok,       'honeypot filled: submission rejected');
assert(honeypotFilled.honeypot,  'honeypot filled: honeypot flag set');
assert(!honeypotFilled.errors,   'honeypot filled: no error array (silent rejection)');

const honeypotEmpty = validateContact({ ...valid, website: '' });
assert(honeypotEmpty.ok,         'honeypot empty string: submission accepted');

const honeypotWhitespace = validateContact({ ...valid, website: '   ' });
assert(!honeypotWhitespace.ok,   'honeypot whitespace: submission rejected');
assert(honeypotWhitespace.honeypot, 'honeypot whitespace: honeypot flag set');

const honeypotUndefined = validateContact({ ...valid, website: undefined });
assert(honeypotUndefined.ok,     'honeypot undefined: submission accepted');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Rate limiting
// ─────────────────────────────────────────────────────────────────────────────

section('7: Rate limiting');

const rl = makeRateLimiter(5, 60 * 60 * 1000);

for (let i = 1; i <= 5; i++) {
  assert(rl('1.2.3.4') === true,  `rate limit: request ${i}/5 allowed`);
}
assert(rl('1.2.3.4') === false,   'rate limit: 6th request from same IP blocked');
assert(rl('5.5.5.5') === true,    'rate limit: different IP unaffected');
assert(rl('1.2.3.4') === false,   'rate limit: still blocked after another attempt');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Type coercion / injection safety
// ─────────────────────────────────────────────────────────────────────────────

section('8: Type safety');

const nullFields = validateContact({ name: null, email: null, message: null });
assert(!nullFields.ok, 'null fields: all rejected');
assert(nullFields.errors.length === 3, 'null fields: 3 errors');

const numericFields = validateContact({ name: 123, email: 456, message: 789 });
assert(!numericFields.ok, 'numeric fields: all rejected');

// name is a non-string object
const objName = validateContact({ ...valid, name: { toString: () => 'bob' } });
assert(!objName.ok, 'object as name: rejected');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Trimming behaviour
// ─────────────────────────────────────────────────────────────────────────────

section('9: Trimming');

const padded = validateContact({
  name:    '  Alice  ',
  email:   '  alice@example.com  ',
  message: '  This is a properly long test message for trimming behaviour checks.  ',
});
assert(padded.ok,                      'padded input: accepted after trim');
assert(padded.name    === 'Alice',     'padded name: trimmed');
assert(padded.email   === 'alice@example.com', 'padded email: trimmed');
assert(padded.message.startsWith('This'), 'padded message: trimmed');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Email send success / failure paths (mock)
// ─────────────────────────────────────────────────────────────────────────────

section('10: Email send paths (mock)');

// Simulate the onRequestPost logic with mocked fetch
async function simulateRequest({ body, ip = '9.9.9.9', apiKey = 'test-key', mockEmailOk = true }) {
  const v = validateContact(body);
  if (!v.ok) {
    if (v.honeypot) return { status: 200, json: { success: true, message: 'Your message has been sent successfully.' } };
    return { status: 400, json: { success: false, errors: v.errors } };
  }
  if (!apiKey) return { status: 500, json: { success: false, message: 'Server configuration error.' } };

  // Mock Resend call
  if (!mockEmailOk) return { status: 500, json: { success: false, message: 'Failed to send message. Please try again later.' } };

  return { status: 200, json: { success: true, message: 'Your message has been sent successfully.' } };
}

(async function () {
  const success = await simulateRequest({ body: valid });
  assert(success.status === 200,          'email send success: HTTP 200');
  assert(success.json.success === true,   'email send success: json.success true');

  const noKey = await simulateRequest({ body: valid, apiKey: '' });
  assert(noKey.status === 500,            'missing API key: HTTP 500');
  assert(noKey.json.success === false,    'missing API key: json.success false');

  const emailFail = await simulateRequest({ body: valid, mockEmailOk: false });
  assert(emailFail.status === 500,        'email send failure: HTTP 500');
  assert(emailFail.json.success === false,'email send failure: json.success false');

  const badBody = await simulateRequest({ body: { name: '', email: 'x', message: '' } });
  assert(badBody.status === 400,          'invalid body: HTTP 400');
  assert(Array.isArray(badBody.json.errors), 'invalid body: errors array returned');

  const honeypotReq = await simulateRequest({ body: { ...valid, website: 'spam' } });
  assert(honeypotReq.status === 200,      'honeypot request: silent 200');
  assert(honeypotReq.json.success === true, 'honeypot request: json.success true');

  // ─── Results ───────────────────────────────────────────────────────────────

  const divider = '─'.repeat(64);
  process.stdout.write('\n' + divider + '\n');
  process.stdout.write(`  Results: ${passed} passed, ${failed} failed\n`);
  process.stdout.write(divider + '\n');

  if (failures.length > 0) {
    process.stdout.write('\nFailures:\n');
    failures.forEach(f => process.stdout.write(`  ${failures.indexOf(f) + 1}. ${f}\n`));
    process.stdout.write('\n');
    process.exit(1);
  } else {
    process.stdout.write(`\n  ✓ All ${passed} tests passed.\n\n`);
    process.exit(0);
  }
}());
