'use strict';

const express = require('express');
const { spawn } = require('child_process');
const path    = require('path');
const fs      = require('fs');
const { getDb }                      = require('../db');
const { requireAuth, validateCsrf, audit } = require('../middleware/auth');
const { mergeAndWrite }              = require('../adapter');

const router = express.Router();
router.use(requireAuth);

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const IS_PROD      = process.env.NODE_ENV === 'production';

/* ── GET /admin/build ────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const db  = await getDb();
  const last = await db.get('SELECT * FROM build_log ORDER BY id DESC LIMIT 1');
  res.render('build', { last, flash: req.session.flash, csrfToken: res.locals.csrfToken });
  delete req.session.flash;
});

/* ── POST /admin/build (trigger build, returns build log ID for SSE) ─────────── */
router.post('/', validateCsrf, async (req, res) => {
  const db = await getDb();

  try {
    const adminHotels = await db.all('SELECT * FROM hotels ORDER BY id');
    mergeAndWrite(adminHotels);
  } catch (err) {
    return res.json({ error: `Failed to prepare hotel data: ${err.message}` });
  }

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
  const db   = await getDb();

  if (IS_PROD) {
    await _runProductionBuild(buildId, send, db, req);
  } else {
    await _runLocalBuild(buildId, send, db, req, res);
  }
});

/* ── Local build: spawn site_builder.js ─────────────────────────────────────── */
async function _runLocalBuild(buildId, send, db, req, res) {
  const output = [];

  const child = spawn('node', ['site_builder.js', '--verbose'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
  });

  child.stdout.on('data', chunk => {
    chunk.toString().split('\n').filter(Boolean).forEach(l => { send(l); output.push(l); });
  });

  child.stderr.on('data', chunk => {
    chunk.toString().split('\n').filter(Boolean).forEach(l => { send(`⚠ ${l}`); output.push(`⚠ ${l}`); });
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
}

/* ── Production build: commit data/hotels.json to GitHub via API ─────────────── */
async function _runProductionBuild(buildId, send, db) {
  const output = [];
  const log    = line => { send(line); output.push(line); };

  const finish = async (code, status) => {
    send(`__done__:${code}`);
    await db.run(
      `UPDATE build_log SET status=?, output=?, exit_code=?, finished_at=CURRENT_TIMESTAMP,
       duration_ms = ROUND((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400000)
       WHERE id=?`,
      [status, output.join('\n'), code, buildId]
    );
  };

  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;   // e.g. "StrengthG/mauritius-resort-finder"
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !repo) {
    log('⚠ GITHUB_TOKEN or GITHUB_REPO not configured. Cannot publish automatically.');
    log('⚠ hotel data was merged locally but the site was not rebuilt.');
    await finish(1, 'failed');
    return;
  }

  try {
    const filePath    = 'data/hotels.json';
    const fileContent = fs.readFileSync(path.join(PROJECT_ROOT, filePath), 'utf8');
    const encoded     = Buffer.from(fileContent).toString('base64');

    log('→ Fetching current file SHA from GitHub…');
    const apiBase = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const headers = {
      'Authorization':       `Bearer ${token}`,
      'Accept':              'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':          'mauritius-resort-finder-admin',
      'Content-Type':        'application/json',
    };

    const getRes  = await fetch(apiBase + `?ref=${branch}`, { headers });
    const getCurrent = await getRes.json();

    if (!getCurrent.sha) {
      log(`⚠ Could not retrieve file SHA: ${JSON.stringify(getCurrent.message || getCurrent)}`);
      await finish(1, 'failed');
      return;
    }

    log('→ Committing updated data/hotels.json to GitHub…');
    const putBody = JSON.stringify({
      message: `data: admin sync — update hotels.json`,
      content: encoded,
      sha:     getCurrent.sha,
      branch,
    });

    const putRes  = await fetch(apiBase, { method: 'PUT', headers, body: putBody });
    const putData = await putRes.json();

    if (!putData.commit) {
      log(`⚠ GitHub API error: ${JSON.stringify(putData.message || putData)}`);
      await finish(1, 'failed');
      return;
    }

    const commitUrl = putData.commit.html_url;
    log(`✓ Committed: ${commitUrl}`);
    log('→ Cloudflare Pages will now auto-build from the commit (usually 60–90 seconds).');

    // Optional: trigger Cloudflare Pages deploy hook
    const hookUrl = process.env.CLOUDFLARE_DEPLOY_HOOK_URL;
    if (hookUrl) {
      log('→ Triggering Cloudflare Pages deploy hook…');
      const hookRes = await fetch(hookUrl, { method: 'POST' });
      if (hookRes.ok) {
        log('✓ Deploy hook triggered.');
      } else {
        log(`⚠ Deploy hook responded with ${hookRes.status} — Cloudflare may still build from the commit.`);
      }
    }

    log('✓ Upload & Rank complete. Site will update within ~90 seconds.');
    await finish(0, 'success');
  } catch (err) {
    log(`⚠ Unexpected error: ${err.message}`);
    await finish(1, 'failed');
  }
}

module.exports = router;
