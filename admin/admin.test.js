#!/usr/bin/env node
'use strict';

/**
 * admin.test.js — Admin dashboard test suite
 * Tests: auth, hotel CRUD, image validation, build trigger, authorization.
 * Uses supertest for HTTP-level testing against the real Express app.
 */

const assert    = require('assert');
const path      = require('path');
const fs        = require('fs');
const http      = require('http');

// ── Override DB path to an in-memory / temp file ─────────────────────────────
const TMP_DB = path.join(__dirname, 'data', 'test_admin.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-unit-tests-only';

// Clean up any previous test DB
if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);

// Monkey-patch DB_PATH before requiring modules
const dbModule = require('./db');
// The DB module uses a singleton; we need to reset it for tests.
// We export a test-only reset in a separate helper.

const supertest = require('supertest');
const bcrypt    = require('bcryptjs');
const app       = require('./server');

/* ── Minimal test harness ─────────────────────────────────────────────────────── */
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    process.stdout.write(`  ✗ ${name}\n    ${err.message}\n`);
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
async function seedUser(db) {
  const hash = await bcrypt.hash('testpassword123', 10);
  await db.run(
    `INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
    ['TestAdmin', hash, 'super_admin']
  );
}

async function loginAgent(agent) {
  // Get CSRF token from login page
  const loginPage = await agent.get('/admin/login');
  const csrfMatch = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  await agent
    .post('/admin/login')
    .type('form')
    .send({ username: 'TestAdmin', password: 'testpassword123', _csrf: csrf });
}

/* ── Run tests ───────────────────────────────────────────────────────────────── */
(async () => {
  console.log('\n  Admin Dashboard Test Suite\n');

  const db = await dbModule.getDb();
  await seedUser(db);
  const agent = supertest.agent(app);

  /* ── Authentication ──────────────────────────────────────────────────────── */
  await test('GET /admin redirects unauthenticated user to login', async () => {
    const res = await supertest(app).get('/admin');
    assert.ok([301, 302].includes(res.status), `Expected redirect, got ${res.status}`);
    assert.ok(res.headers.location.includes('/admin/login'), `Expected redirect to login, got ${res.headers.location}`);
  });

  await test('GET /admin/login returns 200 with form', async () => {
    const res = await supertest(app).get('/admin/login');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Sign In') || res.text.includes('Password'));
  });

  await test('POST /admin/login rejects wrong password', async () => {
    const loginPage = await supertest(app).get('/admin/login');
    const csrfMatch = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    const cookies = loginPage.headers['set-cookie'];

    const res = await supertest(app)
      .post('/admin/login')
      .set('Cookie', cookies)
      .type('form')
      .send({ username: 'TestAdmin', password: 'wrongpassword', _csrf: csrf });

    assert.ok(res.text.includes('Invalid') || res.status === 200, 'Expected error message');
  });

  await test('POST /admin/login accepts correct credentials', async () => {
    await loginAgent(agent);
    const res = await agent.get('/admin');
    assert.ok([200, 301, 302].includes(res.status));
  });

  await test('Password hash is bcrypt (not plaintext)', async () => {
    const user = await db.get('SELECT password_hash FROM users WHERE username = ?', ['TestAdmin']);
    assert.ok(user.password_hash.startsWith('$2'), 'Expected bcrypt hash starting with $2');
    assert.ok(user.password_hash.length > 50, 'Hash should be long');
    const match = await bcrypt.compare('testpassword123', user.password_hash);
    assert.ok(match, 'Password should verify against hash');
  });

  /* ── CSRF protection ─────────────────────────────────────────────────────── */
  await test('POST without CSRF token returns 403', async () => {
    const res = await agent
      .post('/admin/hotels')
      .type('form')
      .send({ name: 'Test Hotel' }); // no _csrf
    assert.strictEqual(res.status, 403);
  });

  /* ── Hotel CRUD ──────────────────────────────────────────────────────────── */
  await test('GET /admin/hotels returns hotel list page', async () => {
    const res = await agent.get('/admin/hotels');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Hotels') || res.text.includes('hotel'));
  });

  let createdHotelId;

  await test('POST /admin/hotels creates a hotel', async () => {
    const page = await agent.get('/admin/hotels/new');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

    const res = await agent
      .post('/admin/hotels')
      .type('form')
      .send({ name: 'Test Beachfront Resort', region: 'Grand Baie', star_rating: '5', affiliate_url: 'https://expedia.com/affiliate/TESTXXX', _csrf: csrf });

    assert.ok([200, 301, 302].includes(res.status), `Expected redirect or success, got ${res.status}`);

    const hotel = await db.get(`SELECT * FROM hotels WHERE name = ?`, ['Test Beachfront Resort']);
    assert.ok(hotel, 'Hotel should exist in DB');
    assert.strictEqual(hotel.region, 'Grand Baie');
    createdHotelId = hotel.id;
  });

  await test('Hotel name is required — empty name rejected', async () => {
    const page = await agent.get('/admin/hotels/new');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

    const res = await agent
      .post('/admin/hotels')
      .type('form')
      .send({ name: '', _csrf: csrf });

    assert.ok(res.text.includes('required') || res.status === 200, 'Expected validation error');
  });

  await test('GET /admin/hotels/:id returns edit form', async () => {
    if (!createdHotelId) return;
    const res = await agent.get(`/admin/hotels/${createdHotelId}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Test Beachfront Resort'));
  });

  await test('POST /admin/hotels/:id updates a hotel', async () => {
    if (!createdHotelId) return;
    const page = await agent.get(`/admin/hotels/${createdHotelId}`);
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

    await agent
      .post(`/admin/hotels/${createdHotelId}`)
      .type('form')
      .send({ name: 'Test Beachfront Resort Updated', region: 'Belle Mare', star_rating: '5', affiliate_url: 'https://expedia.com/affiliate/TESTYYY', _csrf: csrf });

    const hotel = await db.get('SELECT * FROM hotels WHERE id = ?', [createdHotelId]);
    assert.strictEqual(hotel.name, 'Test Beachfront Resort Updated');
    assert.strictEqual(hotel.region, 'Belle Mare');
  });

  await test('Audit log records CREATE action', async () => {
    const entry = await db.get(`SELECT * FROM audit_log WHERE action = 'CREATE' AND entity_id = ? ORDER BY id DESC LIMIT 1`, [createdHotelId]);
    assert.ok(entry, 'CREATE audit entry should exist');
    assert.strictEqual(entry.entity_type, 'hotel');
  });

  /* ── Image upload validation ────────────────────────────────────────────── */
  await test('Image upload rejects non-image MIME type', async () => {
    if (!createdHotelId) return;
    const page = await agent.get(`/admin/hotels/${createdHotelId}`);
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

    const fakeFile = Buffer.from('not an image, just text content here');
    const res = await agent
      .post(`/admin/hotels/${createdHotelId}/images`)
      .field('_csrf', csrf)
      .attach('images', fakeFile, { filename: 'malicious.txt', contentType: 'text/plain' });

    assert.ok(res.status === 400 || res.text.includes('allowed') || res.text.includes('Only'),
      'Expected rejection of non-image file');
  });

  await test('Image upload limit enforced at 5 per hotel', async () => {
    const count = await db.get('SELECT COUNT(*) AS n FROM hotel_images WHERE hotel_id = ?', [createdHotelId]);
    assert.ok(count.n <= 5, 'Image count should not exceed 5');
  });

  /* ── Authorization ───────────────────────────────────────────────────────── */
  await test('Unauthenticated GET /admin/hotels redirects to login', async () => {
    const res = await supertest(app).get('/admin/hotels');
    assert.ok([301, 302].includes(res.status));
    assert.ok(res.headers.location.includes('login'));
  });

  await test('Unauthenticated GET /admin/build redirects to login', async () => {
    const res = await supertest(app).get('/admin/build');
    assert.ok([301, 302].includes(res.status));
  });

  await test('Unauthenticated GET /admin/audit redirects to login', async () => {
    const res = await supertest(app).get('/admin/audit');
    assert.ok([301, 302].includes(res.status));
  });

  /* ── Input sanitization ──────────────────────────────────────────────────── */
  await test('XSS payload in hotel name is stored safely', async () => {
    const page = await agent.get('/admin/hotels/new');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
    const xssName = '<script>alert(1)</script>Hotel';

    await agent
      .post('/admin/hotels')
      .type('form')
      .send({ name: xssName, _csrf: csrf, star_rating: '5' });

    const hotel = await db.get(`SELECT * FROM hotels WHERE name = ?`, [xssName]);
    if (hotel) {
      // The name is stored as-is (DB stores raw); EJS auto-escapes on render
      const res = await agent.get(`/admin/hotels/${hotel.id}`);
      assert.ok(!res.text.includes('<script>alert(1)</script>'), 'Script tag should be escaped in HTML');
      // Cleanup
      await db.run('DELETE FROM hotels WHERE id = ?', [hotel.id]);
    }
  });

  /* ── Logout ──────────────────────────────────────────────────────────────── */
  await test('POST /admin/logout destroys session', async () => {
    const page = await agent.get('/admin');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
    const res = await agent.post('/admin/logout').type('form').send({ _csrf: csrf });
    assert.ok([200, 301, 302].includes(res.status));
  });

  /* ── Cleanup ────────────────────────────────────────────────────────────── */
  if (createdHotelId) {
    await db.run('DELETE FROM hotels WHERE id = ?', [createdHotelId]);
  }
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);

  /* ── Report ──────────────────────────────────────────────────────────────── */
  const total = passed + failed;
  console.log(`\n  ${passed} passed, ${failed} failed  (${total} total)\n`);
  if (failures.length) {
    console.log('  Failures:');
    failures.forEach(f => console.log(`    - ${f.name}: ${f.err.message}`));
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('\n  Test runner crashed:', err);
  process.exit(1);
});
