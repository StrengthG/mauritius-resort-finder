#!/usr/bin/env node
/**
 * organize-hotel-images.js
 *
 * Scans all raw source image folders, fuzzy-matches each subfolder to a hotel,
 * and copies images into assets/images/hotels/{hotel_id}/photo_01.png ... photo_05.png.
 *
 * Safe to re-run: never overwrites existing destination images.
 *
 * Usage:
 *   node scripts/organize-hotel-images.js          # dry run (preview only)
 *   node scripts/organize-hotel-images.js --write  # actually copy files
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const ASSETS  = path.join(ROOT, 'assets', 'images', 'hotels');
const WRITE   = process.argv.includes('--write');

// ── Source folder definitions ────────────────────────────────────────────────
// Each entry describes a source folder and how to map its file names to the
// canonical photo_01.png … photo_05.png naming convention.

const SOURCES = [
  {
    dir: path.join(ROOT, 'full_review_hotel_photo_folders'),
    // Files named photo_01.png … photo_05.png already — identity map
    map: (files) => files
      .filter(f => /^photo_\d+\.png$/i.test(f))
      .sort()
      .slice(0, 5),
    toTarget: (f) => f, // keep original name
  },
  {
    dir: path.join(ROOT, 'mauritius_50'),
    // Files: cover.png, review_01.png … review_05.png
    // cover.png → photo_01.png, review_01 → photo_02.png, …
    map: (files) => {
      const cover   = files.find(f => /^cover\.png$/i.test(f));
      const reviews = files.filter(f => /^review_\d+\.png$/i.test(f)).sort();
      return [cover, ...reviews].filter(Boolean).slice(0, 5);
    },
    toTarget: (f, idx) => `photo_${String(idx + 1).padStart(2, '0')}.png`,
  },
  {
    dir: path.join(ROOT, '8 new hotels'),
    // Same convention as mauritius_50
    map: (files) => {
      const cover   = files.find(f => /^cover\.png$/i.test(f));
      const reviews = files.filter(f => /^review_\d+\.png$/i.test(f)).sort();
      return [cover, ...reviews].filter(Boolean).slice(0, 5);
    },
    toTarget: (f, idx) => `photo_${String(idx + 1).padStart(2, '0')}.png`,
  },
  {
    dir: path.join(ROOT, 'missing_mauritius_hotel_photos_png'),
    // Contains hotel_name.png files (single images, not subfolders)
    // Handled separately below
    singleFileMode: true,
  },
  {
    dir: path.join(ROOT, 'actual_mauritius_hotel_photos_png', 'actual_mauritius_hotel_photos_png'),
    // Same single-file mode
    singleFileMode: true,
  },
];

// ── Hotel lookup ─────────────────────────────────────────────────────────────

const hotels = require(path.join(ROOT, 'data', 'hotels.json'))
  .filter(h => h._status !== 'inactive');

function normalise(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, 'and')
    .replace(/[_*\-–—]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build lookup: normalised name → hotel_id
const lookup = new Map();
for (const h of hotels) {
  lookup.set(normalise(h.hotel_name), h.hotel_id);
}

// Special-case mappings for folders whose names diverged significantly
const OVERRIDES = {
  'anahita golf and spa resort':         null, // separate from Four Seasons; skip
  'le m ridien ile maurice':             lookup.get('le meridien ile maurice'),
  'oneandonlyle saint geran':            null, // covered by assets already
  'oneandonly le saint geran':           null,
  'tamassa resort':                      null, // no longer in active hotels
};

function matchHotel(folderName) {
  const norm = normalise(folderName);

  // 1. Direct
  if (lookup.has(norm)) return lookup.get(norm);

  // 2. Override
  if (Object.prototype.hasOwnProperty.call(OVERRIDES, norm)) return OVERRIDES[norm];

  // 3. Longest substring match (hotel name contains folder or vice versa)
  let best = null;
  let bestLen = 0;
  for (const [key, id] of lookup) {
    if (key.includes(norm) || norm.includes(key)) {
      const len = Math.min(key.length, norm.length);
      if (len > bestLen) { bestLen = len; best = id; }
    }
  }
  if (best) return best;

  // 4. Token overlap (≥3 tokens in common)
  const tokens = new Set(norm.split(' ').filter(t => t.length > 2));
  let bestScore = 0;
  for (const [key, id] of lookup) {
    const score = key.split(' ').filter(t => tokens.has(t) && t.length > 2).length;
    if (score > bestScore && score >= 2) { bestScore = score; best = id; }
  }
  return best;
}

// ── Ensure destination directory ─────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Copy helper ──────────────────────────────────────────────────────────────

let copied = 0;
let skipped = 0;
const unmatched = [];

function copyImage(src, dest, dryRun) {
  if (fs.existsSync(dest)) { skipped++; return; }
  if (dryRun) {
    console.log(`  [DRY RUN] ${src} → ${dest}`);
    copied++;
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  copied++;
}

// ── Process sources ──────────────────────────────────────────────────────────

for (const source of SOURCES) {
  if (!fs.existsSync(source.dir)) continue;

  if (source.singleFileMode) {
    // e.g. "Royal Palm Beachcomber Luxury.png" → match by name
    const files = fs.readdirSync(source.dir);
    for (const file of files) {
      if (!/\.png$/i.test(file)) continue;
      const hotelName = path.basename(file, path.extname(file));
      const hotelId = matchHotel(hotelName);
      if (!hotelId) { unmatched.push(`${source.dir}/${file}`); continue; }

      const dest = path.join(ASSETS, hotelId, 'photo_01.png');
      copyImage(path.join(source.dir, file), dest, !WRITE);
    }
    continue;
  }

  // Subfolder mode
  const entries = fs.readdirSync(source.dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(source.dir, entry.name);
    const hotelId = matchHotel(entry.name);

    if (!hotelId) {
      unmatched.push(`${source.dir}/${entry.name}`);
      continue;
    }

    const files = fs.readdirSync(folderPath);
    const mapped = source.map(files);

    mapped.forEach((file, idx) => {
      if (!file) return;
      const src  = path.join(folderPath, file);
      const dest = path.join(ASSETS, hotelId, source.toTarget(file, idx));
      copyImage(src, dest, !WRITE);
    });
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n── Image Organizer ─────────────────────────────────────────────`);
console.log(`Mode:     ${WRITE ? 'WRITE (files copied)' : 'DRY RUN (no changes)'}`);
console.log(`Copied:   ${copied}`);
console.log(`Skipped:  ${skipped} (already exist)`);
console.log(`Unmatched folders: ${unmatched.length}`);
if (unmatched.length) {
  unmatched.forEach(u => console.log(`  ✗ ${path.relative(ROOT, u)}`));
}
console.log(`────────────────────────────────────────────────────────────────\n`);
if (!WRITE) console.log('Run with --write to copy files.');
