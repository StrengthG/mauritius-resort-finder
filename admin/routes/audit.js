'use strict';

const express = require('express');
const { getDb }         = require('../db');
const { requireAuth }   = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* ── GET /admin/audit ────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const db      = await getDb();
  const page    = Math.max(1, Number(req.query.page) || 1);
  const perPage = 50;
  const offset  = (page - 1) * perPage;

  const [entries, countRow] = await Promise.all([
    db.all(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`, [perPage, offset]),
    db.get(`SELECT COUNT(*) AS n FROM audit_log`),
  ]);

  const total = countRow ? countRow.n : 0;
  res.render('audit', { entries, page, perPage, total, csrfToken: res.locals.csrfToken });
});

module.exports = router;
