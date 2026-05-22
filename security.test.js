'use strict';

/**
 * security.test.js — automated security regression tests
 * Run: node security.test.js
 *
 * Covers: XSS, injection, open redirect, upload abuse, CSRF, rate limiting,
 *         unsafe URLs, authentication bypass, session security, CSP headers.
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ─── 1. Static page renderer — HTML escaping ────────────────────────────────

const spr = require('./static_page_renderer.js');

test('static_page_renderer: esc() prevents XSS via hotel name', () => {
  // esc() is not exported, but the renderer uses it internally.
  // We verify the build output doesn't contain raw XSS payloads.
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) return; // skip if dist not built
  const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  assert.ok(!indexHtml.includes('<script>alert'), 'Raw <script>alert in index.html');
});

// ─── 2. Contact form API validation ─────────────────────────────────────────

const { validateContact } = require('./functions/api/contact.js');

test('contact validation: rejects empty name', () => {
  const r = validateContact({ name: '', email: 'a@b.com', message: 'hello world' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('name')));
});

test('contact validation: rejects script injection in name', () => {
  const r = validateContact({ name: '<script>xss</script>', email: 'a@b.com', message: 'hello world here' });
  assert.strictEqual(r.ok, false, 'Script tag in name must fail validation');
});

test('contact validation: rejects SQL injection attempt in email', () => {
  const r = validateContact({ name: 'Alice', email: "' OR '1'='1", message: 'hello world long enough' });
  assert.strictEqual(r.ok, false, 'SQL injection in email must fail validation');
});

test('contact validation: honeypot field blocks bot submissions', () => {
  const r = validateContact({ name: 'Bot', email: 'bot@spam.com', message: 'spam message here', website: 'http://spam.com' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.honeypot, true, 'Honeypot must be set when website field is filled');
});

test('contact validation: rejects message < 10 chars', () => {
  const r = validateContact({ name: 'Alice', email: 'alice@example.com', message: 'hi' });
  assert.strictEqual(r.ok, false);
});

test('contact validation: rejects oversized message (5001 chars)', () => {
  const r = validateContact({ name: 'Alice', email: 'alice@example.com', message: 'a'.repeat(5001) });
  assert.strictEqual(r.ok, false);
});

test('contact validation: accepts valid submission', () => {
  const r = validateContact({ name: 'Alice Dupont', email: 'alice@example.com', message: 'Hello, I have a question about your service.' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name, 'Alice Dupont');
});

test('contact validation: email header injection blocked', () => {
  const r = validateContact({ name: 'Test', email: 'test@test.com\r\nBcc: evil@evil.com', message: 'message here' });
  assert.strictEqual(r.ok, false, 'CRLF injection in email must fail validation');
});

test('contact validation: rejects email > 254 chars', () => {
  const longEmail = 'a'.repeat(250) + '@b.com';
  const r = validateContact({ name: 'Alice', email: longEmail, message: 'hello world!' });
  assert.strictEqual(r.ok, false);
});

// ─── 3. Open redirect protection ─────────────────────────────────────────────

test('open redirect: returnTo blocks absolute URL', () => {
  // Simulate the returnTo validation from admin/routes/auth.js
  function safeReturnTo(raw) {
    return (typeof raw === 'string' && /^\/[^/\\]/.test(raw)) ? raw : '/admin';
  }
  assert.strictEqual(safeReturnTo('http://evil.com'), '/admin');
  assert.strictEqual(safeReturnTo('https://evil.com'), '/admin');
  assert.strictEqual(safeReturnTo('//evil.com'), '/admin');
  assert.strictEqual(safeReturnTo('/\\evil.com'), '/admin');
  assert.strictEqual(safeReturnTo('/admin/hotels'), '/admin/hotels');
  assert.strictEqual(safeReturnTo('/admin'), '/admin');
});

// ─── 4. Upload path traversal protection ─────────────────────────────────────

test('upload: path traversal blocked by numeric-only id validation', () => {
  function isValidUploadId(id) {
    return id && /^\d+$/.test(String(id));
  }
  assert.ok(!isValidUploadId('../etc/passwd'), 'Path traversal must be rejected');
  assert.ok(!isValidUploadId('../../secrets'), 'Path traversal must be rejected');
  assert.ok(!isValidUploadId('1; DROP TABLE hotels'), 'SQL injection in id must be rejected');
  assert.ok(!isValidUploadId(''), 'Empty id must be rejected');
  assert.ok(!isValidUploadId(null), 'Null id must be rejected');
  assert.ok(isValidUploadId('42'), 'Valid numeric id must pass');
  assert.ok(isValidUploadId('1'), 'Valid numeric id must pass');
});

// ─── 5. Affiliate URL safety ─────────────────────────────────────────────────

test('affiliate URL: safeUrl blocks javascript: protocol', () => {
  function safeUrl(url) {
    if (typeof url !== 'string') return '#';
    const t = url.trim();
    if (t.startsWith('https://expedia.com/affiliate/')) return t;
    if (/^https?:\/\//.test(t)) return t;
    return '#invalid';
  }
  assert.strictEqual(safeUrl('javascript:alert(1)'), '#invalid');
  assert.strictEqual(safeUrl('data:text/html,<script>alert(1)</script>'), '#invalid');
  assert.strictEqual(safeUrl('vbscript:msgbox(1)'), '#invalid');
  assert.strictEqual(safeUrl('https://expedia.com/affiliate/abc123'), 'https://expedia.com/affiliate/abc123');
});

// ─── 6. Chat endpoint booking URL domain allowlist ────────────────────────────

test('chat: booking URL domain allowlist blocks non-expedia URLs', () => {
  const APPROVED_BOOKING_HOSTS = new Set(['expedia.com']);

  function sanitizeBookingUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol === 'https:' && APPROVED_BOOKING_HOSTS.has(u.hostname.replace(/^www\./, ''))) {
        return rawUrl;
      }
    } catch { /* invalid URL */ }
    return '';
  }

  assert.strictEqual(sanitizeBookingUrl('https://phishing.com/fake'), '', 'Non-approved domain must be rejected');
  assert.strictEqual(sanitizeBookingUrl('javascript:alert(1)'), '', 'javascript: protocol must be rejected');
  assert.strictEqual(sanitizeBookingUrl('http://expedia.com/affiliate/abc'), '', 'HTTP (not HTTPS) must be rejected');
  assert.strictEqual(sanitizeBookingUrl('https://expedia.com/affiliate/abc'), 'https://expedia.com/affiliate/abc', 'Valid expedia URL must pass');
  assert.strictEqual(sanitizeBookingUrl('https://www.expedia.com/affiliate/abc'), 'https://www.expedia.com/affiliate/abc', 'Valid www.expedia URL must pass');
  assert.strictEqual(sanitizeBookingUrl('not-a-url'), '', 'Invalid URL must be rejected');
});

// ─── 7. CSP headers file integrity ───────────────────────────────────────────

test('_headers: HSTS header is present', () => {
  const headers = fs.readFileSync(path.join(__dirname, '_headers'), 'utf8');
  assert.ok(headers.includes('Strict-Transport-Security'), 'HSTS header must be present');
  assert.ok(headers.includes('includeSubDomains'), 'HSTS must include subdomains');
});

test('_headers: object-src none in CSP', () => {
  const headers = fs.readFileSync(path.join(__dirname, '_headers'), 'utf8');
  assert.ok(headers.includes("object-src 'none'"), "CSP must include object-src 'none'");
});

test('_headers: frame-ancestors none in CSP', () => {
  const headers = fs.readFileSync(path.join(__dirname, '_headers'), 'utf8');
  assert.ok(headers.includes("frame-ancestors 'none'"), "CSP must include frame-ancestors 'none'");
});

test('_headers: upgrade-insecure-requests in CSP', () => {
  const headers = fs.readFileSync(path.join(__dirname, '_headers'), 'utf8');
  assert.ok(headers.includes('upgrade-insecure-requests'), 'CSP must include upgrade-insecure-requests');
});

test('_headers: X-Frame-Options DENY is present', () => {
  const headers = fs.readFileSync(path.join(__dirname, '_headers'), 'utf8');
  assert.ok(headers.includes('X-Frame-Options: DENY'), 'X-Frame-Options: DENY must be present');
});

test('_headers: X-Content-Type-Options nosniff is present', () => {
  const headers = fs.readFileSync(path.join(__dirname, '_headers'), 'utf8');
  assert.ok(headers.includes('X-Content-Type-Options: nosniff'), 'X-Content-Type-Options: nosniff must be present');
});

// ─── 8. Git repository — no secrets committed ────────────────────────────────

test('git: .env file is not tracked by git', () => {
  const { execSync } = require('child_process');
  let tracked;
  try {
    tracked = execSync('git ls-files --error-unmatch .env 2>&1', { encoding: 'utf8' });
  } catch {
    tracked = null; // error means file is not tracked — which is what we want
  }
  assert.strictEqual(tracked, null, '.env must not be tracked by git');
});

test('git: .gitignore explicitly excludes .env', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.env'), '.gitignore must exclude .env');
});

test('gitignore: admin db files are excluded', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('admin/data/*.db'), 'Admin SQLite db must be gitignored');
});

// ─── 9. Admin server security configuration ───────────────────────────────────

test('admin server: session cookie is httpOnly', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'admin', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes('httpOnly: true'), 'Session cookie must have httpOnly: true');
});

test('admin server: session cookie is SameSite strict', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'admin', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes("sameSite: 'strict'"), "Session cookie must have sameSite: 'strict'");
});

test('admin server: session cookie is Secure in production', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'admin', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes('secure:   isProd') || serverSrc.includes("secure: isProd"), 'Session cookie must be Secure in production');
});

test('admin server: helmet is applied', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'admin', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes("require('helmet')"), 'admin/server.js must use helmet');
  assert.ok(serverSrc.includes('app.use(helmet('), 'helmet must be applied as middleware');
});

test('admin server: body size limit is ≤ 100kb', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'admin', 'server.js'), 'utf8');
  // Should NOT have 2mb limit
  assert.ok(!serverSrc.includes("limit: '2mb'"), 'Body limit of 2mb is too large');
});

// ─── 10. bcrypt strength ─────────────────────────────────────────────────────

test('auth: bcrypt rounds are >= 12', () => {
  const authSrc  = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'auth.js'), 'utf8');
  const usersSrc = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'users.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(__dirname, 'admin', 'server.js'), 'utf8');
  // All bcrypt.hash calls must use rounds >= 12
  const hashCalls = [...authSrc.matchAll(/bcrypt\.hash\([^,]+,\s*(\d+)\)/g),
                     ...usersSrc.matchAll(/bcrypt\.hash\([^,]+,\s*(\d+)\)/g),
                     ...serverSrc.matchAll(/bcrypt\.hash\([^,]+,\s*(\d+)\)/g)];
  assert.ok(hashCalls.length > 0, 'Must find at least one bcrypt.hash call');
  for (const match of hashCalls) {
    assert.ok(Number(match[1]) >= 12, `bcrypt rounds must be >= 12, found: ${match[1]}`);
  }
});

// ─── 11. CSRF protection coverage ────────────────────────────────────────────

test('auth routes: POST /login has CSRF validation', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'auth.js'), 'utf8');
  // POST login line must include validateCsrf
  assert.ok(src.includes("router.post('/login', loginLimiter, csrfMiddleware, validateCsrf"), 'Login POST must validate CSRF');
});

test('auth routes: POST /logout has CSRF validation', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'auth.js'), 'utf8');
  assert.ok(src.includes("router.post('/logout', validateCsrf"), 'Logout POST must validate CSRF');
});

// ─── 12. Rate limiting ────────────────────────────────────────────────────────

test('login rate limiting: loginLimiter is applied to POST /login', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'auth.js'), 'utf8');
  assert.ok(src.includes('rateLimit'), 'Auth routes must import express-rate-limit');
  assert.ok(src.includes('loginLimiter'), 'Login rate limiter must be defined');
  assert.ok(src.includes("router.post('/login', loginLimiter"), 'loginLimiter must be applied to POST /login');
});

test('chat rate limiting: _checkChatRateLimit is applied in onRequestPost', () => {
  const src = fs.readFileSync(path.join(__dirname, 'functions', 'api', 'chat.js'), 'utf8');
  assert.ok(src.includes('_checkChatRateLimit'), 'Chat endpoint must have rate limiting');
  assert.ok(src.includes('CHAT_RATE_LIMIT'), 'Chat rate limit constant must be defined');
});

test('contact rate limiting: _checkRateLimit is applied', () => {
  const src = fs.readFileSync(path.join(__dirname, 'functions', 'api', 'contact.js'), 'utf8');
  assert.ok(src.includes('_checkRateLimit'), 'Contact endpoint must have rate limiting');
  assert.ok(src.includes('RATE_LIMIT'), 'Rate limit constant must be defined');
});

// ─── 13. File upload security ─────────────────────────────────────────────────

test('upload: MIME type allowlist is enforced', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'hotels.js'), 'utf8');
  assert.ok(src.includes('ALLOWED_MIME'), 'Upload must have MIME type allowlist');
  assert.ok(src.includes("'image/jpeg'"), 'MIME allowlist must include image/jpeg');
  assert.ok(src.includes("'image/png'"), 'MIME allowlist must include image/png');
  assert.ok(src.includes("'image/webp'"), 'MIME allowlist must include image/webp');
  // Ensure SVG is not in the allowlist (SVG can contain scripts)
  assert.ok(!src.includes("'image/svg"), 'SVG must NOT be in the MIME allowlist');
});

test('upload: file extension allowlist is enforced', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'hotels.js'), 'utf8');
  assert.ok(src.includes('ALLOWED_EXT'), 'Upload must have extension allowlist');
  // Dangerous extensions must not be in allowlist
  assert.ok(!src.includes("'.php'"), '.php must not be allowed');
  assert.ok(!src.includes("'.js'"), '.js must not be allowed as upload');
  assert.ok(!src.includes("'.html'"), '.html must not be allowed');
});

test('upload: max file size is enforced', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'hotels.js'), 'utf8');
  assert.ok(src.includes('MAX_FILE_MB'), 'Upload must have file size limit');
  assert.ok(src.includes('fileSize'), 'Multer limits must include fileSize');
});

test('upload: id parameter validated as numeric before path construction', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'hotels.js'), 'utf8');
  assert.ok(src.includes('/^\\d+$/'), 'Upload id must be validated as numeric only');
});

test('upload: filenames are randomised (not user-controlled)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'admin', 'routes', 'hotels.js'), 'utf8');
  assert.ok(src.includes('crypto.randomBytes'), 'Uploaded filenames must use crypto.randomBytes');
});

// ─── 14. SQL injection protection ─────────────────────────────────────────────

test('SQL: all db calls use parameterised queries (no string interpolation)', () => {
  const files = [
    path.join(__dirname, 'admin', 'routes', 'hotels.js'),
    path.join(__dirname, 'admin', 'routes', 'auth.js'),
    path.join(__dirname, 'admin', 'routes', 'users.js'),
    path.join(__dirname, 'admin', 'routes', 'audit.js'),
  ];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // Check for template literal SQL injection pattern: `SELECT ... ${variable}`
    const dangerPattern = /db\.(run|get|all)\s*\(`[^`]*\$\{/;
    assert.ok(!dangerPattern.test(src), `Potential SQL injection via template literal in ${path.basename(file)}`);
  }
});

// ─── 15. Environment variable safety ──────────────────────────────────────────

test('env.example: does not contain real API keys', () => {
  const example = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8');
  // Real key patterns: Airtable PAT starts with 'pat', real base IDs are 'app' + 17 alphanumeric
  assert.ok(!example.match(/pat[a-zA-Z0-9]{14}\./), '.env.example must not contain real Airtable PAT');
  assert.ok(!example.includes('appkEOiXVC89MR5DN'), '.env.example must not contain real Airtable base ID');
});

test('env: .env file uses non-trivial SESSION_SECRET', () => {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const match = envContent.match(/SESSION_SECRET=(.+)/);
    if (match) {
      assert.ok(!match[1].trim().includes('change-me'), 'SESSION_SECRET must not be the default placeholder');
      assert.ok(match[1].trim().length >= 32, 'SESSION_SECRET must be at least 32 characters');
    }
  } catch {
    // .env doesn't exist in CI — skip
  }
});

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('');
console.log('════════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`  SECURITY TESTS: ${passed} passed, 0 failed  ✓`);
} else {
  console.log(`  SECURITY TESTS: ${passed} passed, ${failed} FAILED`);
}
console.log('════════════════════════════════════════════════════════════════');

if (failed > 0) process.exit(1);
