'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { getDb }                      = require('../db');
const { validateCsrf, csrfMiddleware, audit } = require('../middleware/auth');

const router = express.Router();

/* GET /admin/login ─────────────────────────────────────────────────────────── */
router.get('/login', csrfMiddleware, (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('login', { error: null, csrfToken: res.locals.csrfToken });
});

/* POST /admin/login ─────────────────────────────────────────────────────────── */
router.post('/login', csrfMiddleware, validateCsrf, async (req, res) => {
  const { username, password, remember } = req.body;

  if (!username || !password) {
    return res.render('login', { error: 'Username and password are required.', csrfToken: res.locals.csrfToken });
  }

  try {
    const db   = await getDb();
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await audit(db, req, 'LOGIN_FAILED', 'user', null, `username: ${username}`);
      return res.render('login', { error: 'Invalid username or password.', csrfToken: res.locals.csrfToken });
    }

    // Regenerate session on login to prevent fixation
    req.session.regenerate(err => {
      if (err) return res.render('login', { error: 'Session error. Please try again.', csrfToken: res.locals.csrfToken });

      req.session.userId   = user.id;
      req.session.username = user.username;
      req.session.role     = user.role;

      if (remember) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

      const returnTo = req.session.returnTo || '/admin';
      delete req.session.returnTo;
      audit(db, req, 'LOGIN', 'user', user.id, null);
      res.redirect(returnTo);
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.render('login', { error: 'An internal error occurred.', csrfToken: res.locals.csrfToken });
  }
});

/* POST /admin/logout ─────────────────────────────────────────────────────────── */
router.post('/logout', async (req, res) => {
  const db = await getDb();
  await audit(db, req, 'LOGOUT', 'user', req.session.userId, null);
  req.session.destroy(() => res.redirect('/admin/login'));
});

module.exports = router;
