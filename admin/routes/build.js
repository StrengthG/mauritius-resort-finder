'use strict';

const express = require('express');
const { spawn } = require('child_process');
const path    = require('path');
const { getDb }                      = require('../db');
const { requireAuth, validateCsrf, audit } = require('../middleware/auth');
const { mergeAndWrite }              = require('../adapter');

const router = express.Router();
router.use(requireAuth);

const PROJECT_ROOT = path.join(__dirname, '..', '..');

/* ── GET /admin/build ────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const db  = await getDb();
  const last = await db.get('SELECT * FROM build_log ORDER BY id DESC LIMIT 1');
  res.render('build', { last, flash: req.session.flash, csrfToken: res.locals.csrfToken });
  delete req.session.flash;
});

/* ── POST /admin/build (trigger build, returns build log ID for SSE) ────────── */
router.post('/', validateCsrf, async (req, res) => {
  const db = await getDb();

  // Step 1: merge admin hotels into data/hotels.json
  try {
    const adminHotels = await db.all('SELECT * FROM hotels ORDER BY id');
    mergeAndWrite(adminHotels);
  } catch (err) {
    return res.json({ error: `Failed to prepare hotel data: ${err.message}` });
  }

  // Step 2: insert a pending build log record
  const { lastID: buildId } = await db.run(
    `INSERT INTO build_log (status, started_at) VALUES ('running', CURRENT_TIMESTAMP)`
  );

  await audit(db, req, 'BUILD_TRIGGERED', 'build', buildId, null);
  res.json({ buildId });
});

/* ── GET /admin/build/stream?id=N (SSE log stream) ──────────────────────────── */
router.get('/stream', requireAuth, async (req, res) => {
  const buildId = Number(req.query.id);
  if (!buildId) return res.status(400).end();

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = line => res.write(`data: ${line}\n\n`);

  const db  = await getDb();
  const child = spawn('node', ['site_builder.js', '--verbose'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
  });

  const output = [];

  child.stdout.on('data', chunk => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(l => { send(l); output.push(l); });
  });

  child.stderr.on('data', chunk => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(l => { send(`⚠ ${l}`); output.push(`⚠ ${l}`); });
  });

  child.on('close', async code => {
    const status  = code === 0 ? 'success' : 'failed';
    const summary = code === 0 ? '✓ Build complete.' : `✗ Build failed (exit ${code}).`;
    send(summary);
    send(`__done__:${code}`);
    res.end();

    await db.run(
      `UPDATE build_log SET status=?, output=?, exit_code=?, finished_at=CURRENT_TIMESTAMP,
       duration_ms = ROUND((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400000)
       WHERE id=?`,
      [status, output.join('\n'), code, buildId]
    );
  });

  req.on('close', () => { if (child.exitCode === null) child.kill(); });
});

module.exports = router;
