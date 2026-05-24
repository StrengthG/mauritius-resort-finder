'use strict';

/**
 * adapter.js
 * Transforms admin SQLite hotel records into the hotels.json schema
 * expected by scoring_engine.js / site_builder.js.
 *
 * Strategy: load the committed data/hotels.json baseline, then overlay
 * admin records (admin takes precedence for overlapping slugs).
 */

const fs   = require('fs');
const path = require('path');

const BASE_HOTELS_PATH = path.join(__dirname, '..', 'data', 'hotels.json');

/* ── Slugify (mirrors site_builder._slugify) ────────────────────────────────── */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ── Map an admin hotel row → hotels.json entry ─────────────────────────────── */
function adminHotelToEntry(row, index) {
  const id = `ADM${String(index + 1).padStart(3, '0')}`;
  return {
    hotel_id:            id,
    hotel_name:          row.name,
    overall_rating:      null,   // scored by engine at build time
    location_score:      null,
    amenity_score:       null,
    brand_score:         null,
    value_score:         null,
    review_count:        0,
    avg_rating:          null,
    price_per_night_usd: row.price_per_night_usd || null,
    star_rating:         row.star_rating || 5,
    property_type:       'resort',
    region:              row.region || row.location || 'Mauritius',
    _status:             'active',
    _brand_name:         null,
    _brand_tier:         5,
    _affiliate_links:    row.affiliate_url ? [{
      booking_url:      row.affiliate_url,
      provider:         'expedia',
      commission_rate:  0.05,
      commission_tier:  'standard',
    }] : [],
    amenities: {
      spa:                  false,
      private_beach:        false,
      fine_dining:          false,
      pool:                 true,
      golf:                 false,
      kids_club:            false,
      gym:                  true,
      water_sports:         false,
      wellness_programmes:  false,
    },
    _admin_managed:      true,
    _description_override: row.description_override || null,
  };
}

/**
 * Merge admin hotel rows into the base hotels.json array and write the result.
 * Returns the merged array.
 *
 * @param {Object[]} adminHotels - rows from the SQLite hotels table
 * @returns {Object[]} merged hotel array
 */
function mergeAndWrite(adminHotels) {
  let base = [];
  if (fs.existsSync(BASE_HOTELS_PATH)) {
    try { base = JSON.parse(fs.readFileSync(BASE_HOTELS_PATH, 'utf8')); }
    catch (_) { base = []; }
  }

  // Build a lookup of base hotels by slug
  const baseBySlug = {};
  for (const h of base) {
    const s = slugify(h.hotel_name);
    baseBySlug[s] = h;
  }

  // Build a set of slugs currently in the admin DB
  const adminSlugs = new Set(adminHotels.map(r => r.slug || slugify(r.name)));

  const merged = [...base];

  adminHotels.forEach((row, i) => {
    const s = row.slug || slugify(row.name);
    if (baseBySlug[s]) {
      // Update affiliate link if admin provided one
      if (row.affiliate_url) {
        baseBySlug[s]._affiliate_links = [{
          booking_url:     row.affiliate_url,
          provider:        'expedia',
          commission_rate: 0.05,
          commission_tier: 'standard',
        }];
      }
      if (row.price_per_night_usd) baseBySlug[s].price_per_night_usd = row.price_per_night_usd;
      if (row.description_override) baseBySlug[s]._description_override = row.description_override;
      baseBySlug[s]._admin_managed = true;
    } else {
      // New hotel — add to merged array
      merged.push(adminHotelToEntry(row, base.length + i));
    }
  });

  // Prune admin-added hotels (null score data) that were deleted from the admin DB.
  // Original scored hotels (overall_rating is a number) are never pruned.
  const pruned = merged.filter(h => {
    if (typeof h.overall_rating === 'number') return true; // original scored hotel — keep
    const s = slugify(h.hotel_name);
    return adminSlugs.has(s); // admin-added — keep only if still in admin DB
  });

  fs.writeFileSync(BASE_HOTELS_PATH, JSON.stringify(pruned, null, 2));
  return pruned;
}

module.exports = { mergeAndWrite, slugify };
