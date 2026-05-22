'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { getDb }                              = require('../db');
const { requireAuth, validateCsrf, audit }  = require('../middleware/auth');
const { slugify }                            = require('../adapter');

const router = express.Router();
router.use(requireAuth);

const UPLOAD_BASE  = path.join(__dirname, '..', 'uploads', 'hotels');
const MAX_IMAGES   = 5;
const MAX_FILE_MB  = 10;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/* ── Multer storage ─────────────────────────────────────────────────────────── */
const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const id = req.params.id;
    // Validate id is a positive integer before using in path to prevent traversal
    if (!id || !/^\d+$/.test(String(id))) {
      return cb(new Error('Invalid hotel ID.'));
    }
    const dir = path.join(UPLOAD_BASE, id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(12).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error('Only JPG, JPEG, PNG, and WebP images are allowed.'));
  },
});

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function safeSlug(name) {
  const s = slugify(name);
  if (!s) throw new Error('Hotel name produces an empty slug.');
  return s;
}

function sanitize(str, max = 500) {
  return String(str || '').trim().slice(0, max);
}

/* ── GET /admin/hotels ─────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const db   = await getDb();
  const q    = sanitize(req.query.q || '', 100);
  const hotels = q
    ? await db.all(`SELECT h.*, COUNT(i.id) AS image_count
        FROM hotels h LEFT JOIN hotel_images i ON i.hotel_id = h.id
        WHERE h.name LIKE ? GROUP BY h.id ORDER BY h.name`, [`%${q}%`])
    : await db.all(`SELECT h.*, COUNT(i.id) AS image_count
        FROM hotels h LEFT JOIN hotel_images i ON i.hotel_id = h.id
        GROUP BY h.id ORDER BY h.name`);
  res.render('hotels/index', { hotels, q, flash: req.session.flash, csrfToken: res.locals.csrfToken });
  delete req.session.flash;
});

/* ── GET /admin/hotels/new ─────────────────────────────────────────────────── */
router.get('/new', (req, res) => {
  res.render('hotels/edit', { hotel: null, images: [], errors: [], csrfToken: res.locals.csrfToken });
});

/* ── POST /admin/hotels ────────────────────────────────────────────────────── */
router.post('/', validateCsrf, async (req, res) => {
  const { name, affiliate_url, location, region, star_rating, price_per_night_usd, description_override } = req.body;
  const errors = [];

  if (!name || !name.trim()) errors.push('Hotel name is required.');
  if (affiliate_url && !/^https?:\/\//i.test(affiliate_url)) errors.push('Affiliate URL must start with http:// or https://.');
  if (star_rating && (Number(star_rating) < 1 || Number(star_rating) > 5)) errors.push('Star rating must be between 1 and 5.');

  if (errors.length) {
    return res.render('hotels/edit', { hotel: { name, affiliate_url, location, region, star_rating, price_per_night_usd, description_override }, images: [], errors, csrfToken: res.locals.csrfToken });
  }

  try {
    const db   = await getDb();
    const slug = safeSlug(name);
    const existing = await db.get('SELECT id FROM hotels WHERE slug = ?', [slug]);
    if (existing) {
      return res.render('hotels/edit', { hotel: req.body, images: [], errors: ['A hotel with this name already exists.'], csrfToken: res.locals.csrfToken });
    }

    const { lastID } = await db.run(
      `INSERT INTO hotels (slug, name, affiliate_url, location, region, star_rating, price_per_night_usd, description_override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [slug, sanitize(name), sanitize(affiliate_url, 2000), sanitize(location), sanitize(region), Number(star_rating) || 5, Number(price_per_night_usd) || null, sanitize(description_override, 5000)]
    );
    await audit(db, req, 'CREATE', 'hotel', lastID, name);
    req.session.flash = { type: 'success', message: `Hotel "${name}" created.` };
    res.redirect(`/admin/hotels/${lastID}`);
  } catch (err) {
    console.error('[hotels] create error:', err);
    res.render('hotels/edit', { hotel: req.body, images: [], errors: [err.message], csrfToken: res.locals.csrfToken });
  }
});

/* ── GET /admin/hotels/:id ─────────────────────────────────────────────────── */
router.get('/:id', async (req, res) => {
  const db    = await getDb();
  const hotel = await db.get('SELECT * FROM hotels WHERE id = ?', [req.params.id]);
  if (!hotel) return res.status(404).render('error', { title: 'Not Found', message: 'Hotel not found.' });

  const images = await db.all('SELECT * FROM hotel_images WHERE hotel_id = ? ORDER BY display_order, id', [hotel.id]);
  res.render('hotels/edit', { hotel, images, errors: [], flash: req.session.flash, csrfToken: res.locals.csrfToken });
  delete req.session.flash;
});

/* ── POST /admin/hotels/:id (update) ─────────────────────────────────────────── */
router.post('/:id', validateCsrf, async (req, res) => {
  const { name, affiliate_url, location, region, star_rating, price_per_night_usd, description_override } = req.body;
  const errors = [];

  if (!name || !name.trim()) errors.push('Hotel name is required.');
  if (affiliate_url && !/^https?:\/\//i.test(affiliate_url)) errors.push('Affiliate URL must start with http:// or https://.');

  const db    = await getDb();
  const hotel = await db.get('SELECT * FROM hotels WHERE id = ?', [req.params.id]);
  if (!hotel) return res.status(404).render('error', { title: 'Not Found', message: 'Hotel not found.' });

  if (errors.length) {
    const images = await db.all('SELECT * FROM hotel_images WHERE hotel_id = ? ORDER BY display_order, id', [hotel.id]);
    return res.render('hotels/edit', { hotel: { ...hotel, ...req.body }, images, errors, csrfToken: res.locals.csrfToken });
  }

  try {
    const newSlug = safeSlug(name);
    await db.run(
      `UPDATE hotels SET slug=?, name=?, affiliate_url=?, location=?, region=?, star_rating=?,
       price_per_night_usd=?, description_override=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [newSlug, sanitize(name), sanitize(affiliate_url, 2000), sanitize(location), sanitize(region),
       Number(star_rating) || 5, Number(price_per_night_usd) || null, sanitize(description_override, 5000), hotel.id]
    );
    await audit(db, req, 'UPDATE', 'hotel', hotel.id, name);
    req.session.flash = { type: 'success', message: 'Hotel updated.' };
    res.redirect(`/admin/hotels/${hotel.id}`);
  } catch (err) {
    console.error('[hotels] update error:', err);
    const images = await db.all('SELECT * FROM hotel_images WHERE hotel_id = ? ORDER BY display_order, id', [hotel.id]);
    res.render('hotels/edit', { hotel: { ...hotel, ...req.body }, images, errors: [err.message], csrfToken: res.locals.csrfToken });
  }
});

/* ── POST /admin/hotels/:id/delete ───────────────────────────────────────────── */
router.post('/:id/delete', validateCsrf, async (req, res) => {
  const db    = await getDb();
  const hotel = await db.get('SELECT * FROM hotels WHERE id = ?', [req.params.id]);
  if (!hotel) return res.redirect('/admin/hotels');

  // Remove uploaded images from disk (hotel.id is from DB — always a safe integer)
  const safeId = String(Number(hotel.id));
  const dir = path.join(UPLOAD_BASE, safeId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

  await db.run('DELETE FROM hotels WHERE id = ?', [hotel.id]);
  await audit(db, req, 'DELETE', 'hotel', hotel.id, hotel.name);
  req.session.flash = { type: 'success', message: `Hotel "${hotel.name}" deleted.` };
  res.redirect('/admin/hotels');
});

/* ── POST /admin/hotels/:id/images ──────────────────────────────────────────── */
// Note: validateCsrf runs AFTER multer so the multipart body is parsed first.
router.post('/:id/images', async (req, res) => {
  const db    = await getDb();
  const hotel = await db.get('SELECT * FROM hotels WHERE id = ?', [req.params.id]);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found.' });

  const existing = await db.all('SELECT id FROM hotel_images WHERE hotel_id = ?', [hotel.id]);
  const slots    = MAX_IMAGES - existing.length;

  if (slots <= 0) {
    return res.status(400).json({ error: `Maximum ${MAX_IMAGES} images per hotel.` });
  }

  upload.array('images', slots)(req, res, async err => {
    // CSRF check after multer has parsed the multipart form fields
    const token = req.body && req.body._csrf;
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid security token.' });
    }

    if (err) return res.status(400).json({ error: err.message });

    const files = req.files || [];
    let inserted = 0;
    for (const file of files) {
      const altText = sanitize((req.body.alt_text || ''), 200);
      const order   = existing.length + inserted;
      await db.run(
        'INSERT INTO hotel_images (hotel_id, filename, alt_text, display_order) VALUES (?, ?, ?, ?)',
        [hotel.id, file.filename, altText, order]
      );
      inserted++;
    }

    await audit(db, req, 'IMAGE_UPLOAD', 'hotel', hotel.id, `${inserted} image(s)`);
    req.session.flash = { type: 'success', message: `${inserted} image(s) uploaded.` };
    res.redirect(`/admin/hotels/${hotel.id}`);
  });
});

/* ── POST /admin/hotels/:id/images/:imageId/delete ──────────────────────────── */
router.post('/:id/images/:imageId/delete', validateCsrf, async (req, res) => {
  const db  = await getDb();
  const img = await db.get('SELECT * FROM hotel_images WHERE id = ? AND hotel_id = ?', [req.params.imageId, req.params.id]);
  if (!img) return res.redirect(`/admin/hotels/${req.params.id}`);

  const filePath = path.join(UPLOAD_BASE, String(req.params.id), img.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await db.run('DELETE FROM hotel_images WHERE id = ?', [img.id]);
  await audit(db, req, 'IMAGE_DELETE', 'hotel', req.params.id, img.filename);
  req.session.flash = { type: 'success', message: 'Image deleted.' };
  res.redirect(`/admin/hotels/${req.params.id}`);
});

/* ── POST /admin/hotels/:id/images/reorder ──────────────────────────────────── */
router.post('/:id/images/reorder', validateCsrf, async (req, res) => {
  const db    = await getDb();
  const order = req.body.order; // array of image IDs in new order
  if (!Array.isArray(order)) return res.redirect(`/admin/hotels/${req.params.id}`);

  for (let i = 0; i < order.length; i++) {
    await db.run(
      'UPDATE hotel_images SET display_order = ? WHERE id = ? AND hotel_id = ?',
      [i, Number(order[i]), req.params.id]
    );
  }
  res.json({ ok: true });
});

module.exports = router;
