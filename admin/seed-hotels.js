#!/usr/bin/env node
'use strict';

/**
 * seed-hotels.js — One-time import of data/hotels.json into the admin SQLite DB.
 *
 * Safe to re-run: uses INSERT OR IGNORE, so existing slugs are skipped.
 * Run from the project root:  node admin/seed-hotels.js
 */

const path    = require('path');
const fs      = require('fs');
const { getDb } = require('./db');
const { slugify } = require('./adapter');

const HOTELS_PATH = path.join(__dirname, '..', 'data', 'hotels.json');

async function main() {
  const hotels = JSON.parse(fs.readFileSync(HOTELS_PATH, 'utf8'));
  const active = hotels.filter(h => h._status === 'active');

  console.log(`\n  Seeding ${active.length} active hotels into admin DB…\n`);

  const db = await getDb();
  let inserted = 0;
  let skipped  = 0;

  for (const h of active) {
    const slug        = slugify(h.hotel_name);
    const affiliateUrl = h._affiliate_links?.[0]?.booking_url || null;

    const result = await db.run(
      `INSERT OR IGNORE INTO hotels
         (slug, name, affiliate_url, location, region, star_rating, price_per_night_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        slug,
        h.hotel_name,
        affiliateUrl,
        h.region,           // location = region (no separate location field in JSON)
        h.region,
        h.star_rating || 5,
        h.price_per_night_usd || null,
      ]
    );

    if (result.changes > 0) {
      console.log(`  ✓ Inserted: ${h.hotel_name}`);
      inserted++;
    } else {
      console.log(`  – Skipped (already exists): ${h.hotel_name}`);
      skipped++;
    }
  }

  console.log(`\n  Done. ${inserted} inserted, ${skipped} skipped.\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n  Seed failed:', err.message, '\n');
  process.exit(1);
});
