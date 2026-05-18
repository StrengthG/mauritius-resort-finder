'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { getDb }                      = require('../db');
const { requireAuth, requireRole, validateCsrf, audit } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('super_admin'));

/* ── GET /admin/users ────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const db    = await getDb();
  const users = await db.all('SELECT id, username, role, created_at FROM users ORDER BY id');
  res.render('users/index', { users, activePage: 'users' });
});

/* ── GET /admin/users/new ────────────────────────────────────────────────────── */
router.get('/new', (req, res) => {
  res.render('users/new', { activePage: 'users', error: null });
});

/* ── POST /admin/users ───────────────────────────────────────────────────────── */
router.post('/', validateCsrf, async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !['super_admin', 'editor'].includes(role)) {
    return res.render('users/new', {
      activePage: 'users',
      error: 'Username, password, and a valid role are required.',
    });
  }

  if (password.length < 12) {
    return res.render('users/new', {
      activePage: 'users',
      error: 'Password must be at least 12 characters.',
    });
  }

  try {
    const db   = await getDb();
    const hash = await bcrypt.hash(password, 12);
    const { lastID } = await db.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username.trim(), hash, role]
    );
    await audit(db, req, 'USER_CREATED', 'user', lastID, `username: ${username}, role: ${role}`);
    req.session.flash = { type: 'success', message: `User "${username}" created.` };
    res.redirect('/admin/users');
  } catch (err) {
    const error = err.message.includes('UNIQUE') ? 'Username already exists.' : err.message;
    res.render('users/new', { activePage: 'users', error });
  }
});

/* ── POST /admin/users/:id/delete ────────────────────────────────────────────── */
router.post('/:id/delete', validateCsrf, async (req, res) => {
  const id = Number(req.params.id);

  if (id === req.session.userId) {
    req.session.flash = { type: 'error', message: 'You cannot delete your own account.' };
    return res.redirect('/admin/users');
  }

  const db   = await getDb();
  const user = await db.get('SELECT username FROM users WHERE id = ?', [id]);
  if (!user) {
    req.session.flash = { type: 'error', message: 'User not found.' };
    return res.redirect('/admin/users');
  }

  await db.run('DELETE FROM users WHERE id = ?', [id]);
  await audit(db, req, 'USER_DELETED', 'user', id, `username: ${user.username}`);
  req.session.flash = { type: 'success', message: `User "${user.username}" deleted.` };
  res.redirect('/admin/users');
});

module.exports = router;
