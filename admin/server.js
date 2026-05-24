'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express        = require('express');
const helmet         = require('helmet');
const session        = require('express-session');
const ejsLayouts     = require('express-ejs-layouts');
const path           = require('path');
const fs             = require('fs');
const SQLiteStore    = require('connect-sqlite3')(session);
const { getDb }      = require('./db');
const { csrfMiddleware, requireAuth } = require('./middleware/auth');

/* ── Routes ─────────────────────────────────────────────────────────────────── */
const authRoutes   = require('./routes/auth');
const hotelRoutes  = require('./routes/hotels');
const buildRoutes  = require('./routes/build');
const auditRoutes  = require('./routes/audit');
const userRoutes   = require('./routes/users');

const app  = express();
const PORT = process.env.ADMIN_PORT || process.env.PORT || 3001;

/* ── Trust Railway / Cloudflare proxy ───────────────────────────────────────── */
app.set('trust proxy', 1);

/* ── Security headers (Helmet) ───────────────────────────────────────────────── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:        ["'self'", "https://fonts.gstatic.com"],
      imgSrc:         ["'self'", 'data:'],
      connectSrc:     ["'self'"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
    },
  },
  hsts: {
    maxAge:            31536000,
    includeSubDomains: true,
    preload:           true,
  },
  referrerPolicy:         { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
}));

/* ── Session store DB path ───────────────────────────────────────────────────── */
const SESSION_DB_DIR = path.join(__dirname, 'data');
fs.mkdirSync(SESSION_DB_DIR, { recursive: true });

/* ── View engine ─────────────────────────────────────────────────────────────── */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);

/* ── Static assets ───────────────────────────────────────────────────────────── */
app.use('/admin/uploads', requireAuth, express.static(path.join(__dirname, 'uploads')));

/* ── Body parsing ────────────────────────────────────────────────────────────── */
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));

/* ── Session ─────────────────────────────────────────────────────────────────── */
const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  store:  new SQLiteStore({ db: 'sessions.db', dir: SESSION_DB_DIR }),
  secret: process.env.SESSION_SECRET || 'change-me-in-production-use-a-long-random-string',
  resave: false,
  saveUninitialized: false,
  name:   'mrf_admin',
  cookie: {
    httpOnly: true,
    secure:   isProd,
    sameSite: 'strict',
    maxAge:   8 * 60 * 60 * 1000, // 8 hours default
  },
}));

/* ── CSRF token injected into all responses ──────────────────────────────────── */
app.use(csrfMiddleware);

/* ── Template locals ─────────────────────────────────────────────────────────── */
app.use((req, res, next) => {
  res.locals.username      = req.session.username || null;
  res.locals.sessionRole   = req.session.role     || null;
  res.locals.sessionUserId = req.session.userId   || null;
  res.locals.flash         = req.session.flash    || null;
  delete req.session.flash;
  next();
});

/* ── Routes ─────────────────────────────────────────────────────────────────── */
app.get('/admin', requireAuth, async (req, res) => {
  const db = await getDb();
  const [hotelCount, imageCount, lastBuild] = await Promise.all([
    db.get('SELECT COUNT(*) AS n FROM hotels'),
    db.get('SELECT COUNT(*) AS n FROM hotel_images'),
    db.get('SELECT * FROM build_log ORDER BY id DESC LIMIT 1'),
  ]);
  const recentAudit = await db.all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 8');
  res.render('dashboard', {
    hotelCount: hotelCount ? hotelCount.n : 0,
    imageCount: imageCount ? imageCount.n : 0,
    lastBuild,
    recentAudit,
  });
});

app.use('/admin', authRoutes);
app.use('/admin/hotels', hotelRoutes);
app.use('/admin/build',  buildRoutes);
app.use('/admin/audit',  auditRoutes);
app.use('/admin/users',  userRoutes);

/* ── Health check (Railway, load balancers) ──────────────────────────────────── */
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

/* ── Redirect root → admin ───────────────────────────────────────────────────── */
app.get('/', (_req, res) => res.redirect('/admin'));

/* ── 404 ─────────────────────────────────────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).render('error', { title: '404', message: 'Page not found.' });
});

/* ── Error handler ───────────────────────────────────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).render('error', { title: 'Server Error', message: 'An unexpected error occurred.' });
});

/* ── Auto-create initial admin on first boot (env-var triggered) ─────────────── */
async function _maybeBootstrapAdmin(db) {
  const setupUser = process.env.INITIAL_ADMIN_USERNAME;
  const setupPass = process.env.INITIAL_ADMIN_PASSWORD;
  if (!setupUser || !setupPass) return;
  const existing = await db.get('SELECT id FROM users LIMIT 1');
  if (existing) return;
  const bcrypt = require('bcryptjs');
  const hash   = await bcrypt.hash(setupPass, 12);
  await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [setupUser.trim(), hash, 'super_admin']);
  console.log(`  [setup] Created super_admin: ${setupUser}`);
  console.log(`  [setup] Remove INITIAL_ADMIN_USERNAME/PASSWORD env vars now.`);
}

/* ── Start ───────────────────────────────────────────────────────────────────── */
if (require.main === module) {
  getDb().then(async db => {
    await _maybeBootstrapAdmin(db);
    app.listen(PORT, () => {
      console.log(`\n  Admin dashboard → http://localhost:${PORT}/admin\n`);
    });
  }).catch(err => {
    console.error('Failed to open database:', err);
    process.exit(1);
  });
}

module.exports = app;
