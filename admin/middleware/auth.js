'use strict';

const crypto = require('crypto');

/* ── Require authenticated session ──────────────────────────────────────────── */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

/* ── CSRF token generation + validation ─────────────────────────────────────── */
function csrfMiddleware(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function validateCsrf(req, res, next) {
  const token = req.body && req.body._csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).render('error', {
      title:   'Forbidden',
      message: 'Invalid security token. Please go back and try again.',
    });
  }
  next();
}

/* ── Audit logger helper ─────────────────────────────────────────────────────── */
async function audit(db, req, action, entityType, entityId, detail) {
  try {
    await db.run(
      `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, detail, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.session.userId || null,
        req.session.username || 'system',
        action,
        entityType || null,
        entityId   || null,
        detail     || null,
        req.ip     || null,
      ]
    );
  } catch (_) { /* non-critical */ }
}

/* ── Role-based access control ───────────────────────────────────────────────── */
function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.role === role) return next();
    res.status(403).render('error', {
      title:   'Forbidden',
      message: 'You do not have permission to access this page.',
    });
  };
}

module.exports = { requireAuth, requireRole, csrfMiddleware, validateCsrf, audit };
