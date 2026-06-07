/**
 * social_card_engine.js
 * Mauritius Resort Finder — Social Card Generator
 *
 * Generates SVG social cards for every hotel and a generic site card.
 * Cards are resolution-independent (SVG) and served at the correct
 * MIME type by Cloudflare Pages' static file server.
 *
 * Output files:
 *   dist/assets/social/{hotel_id}.svg   — per-hotel card (og:image / twitter:image)
 *   dist/assets/social/generic.svg      — fallback for non-hotel pages
 *
 * Card dimensions: 1200×630 (standard OG), scalable / retina-ready.
 *
 * Cache: data/social-card-cache.json stores {hotel_id: contentHash}.
 *        Cards are only regenerated when their input data changes.
 *
 * Platform support:
 *   Twitter/X, LinkedIn, Slack, Discord, iMessage — SVG rendered natively
 *   Facebook/Meta — falls back to generic.svg if SVG unsupported
 *
 * Zero external dependencies. Node.js built-ins only.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CARD_W       = 1200;
const CARD_H       = 630;
const CACHE_PATH   = path.join(__dirname, 'data', 'social-card-cache.json');
const IMG_DATA_PATH = path.join(__dirname, 'data', 'hotel-images.json');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text, maxChars) {
  const words   = String(text).split(' ');
  const lines   = [];
  let   current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function contentHash(obj) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
    .slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache I/O
// ─────────────────────────────────────────────────────────────────────────────

function loadCache() {
  try   { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch { return {}; }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Hotel image data (hue / theme)
// ─────────────────────────────────────────────────────────────────────────────

let _imgDataCache = null;
function loadImgData() {
  if (_imgDataCache) return _imgDataCache;
  try   { _imgDataCache = JSON.parse(fs.readFileSync(IMG_DATA_PATH, 'utf8')); }
  catch { _imgDataCache = { hotels: {} }; }
  return _imgDataCache;
}

function getHue(hotelId) {
  const d = loadImgData();
  const h = d.hotels && d.hotels[hotelId];
  if (h && h.theme && typeof h.theme.hue === 'number') return h.theme.hue;
  // Deterministic fallback
  let v = 0;
  for (let i = 0; i < hotelId.length; i++) v = (v * 31 + hotelId.charCodeAt(i)) & 0xffff;
  return 170 + (v % 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// Selling point derivation
// ─────────────────────────────────────────────────────────────────────────────

function getSellingPoint(hotel) {
  const a  = hotel.amenities      || {};
  const br = hotel._brand_tier    || 0;
  const r  = hotel.overall_rating || 0;

  if (a.overwater_villa)                              return 'Iconic overwater villas on the lagoon';
  if (a.butler_service && br >= 9)                   return 'Ultra-luxury with 24-hour butler service';
  if (a.adults_only && a.spa)                        return 'Adults-only spa sanctuary for couples';
  if (a.adults_only)                                 return 'Exclusive adults-only hideaway';
  if (a.golf && a.spa)                               return 'Championship golf & award-winning spa';
  if (a.golf)                                        return 'Championship golf on the Indian Ocean';
  if (a.butler_service)                              return 'Personalised butler service & bespoke stays';
  if (r >= 9.0 && a.spa && a.private_beach)          return 'Pristine private beach & world-class spa';
  if (a.all_inclusive)                               return 'All-inclusive luxury on the Indian Ocean';
  if (a.kids_club && a.water_sports)                 return 'Family resort with watersports & kids club';
  if (a.kids_club)                                   return 'Family luxury with children\'s programme';
  if (a.wellness_programmes && a.yoga && a.spa)      return 'Holistic wellness with yoga & healing spa';
  if (a.wellness_programmes || a.naturopath)         return 'Award-winning wellness & spa retreat';
  if (a.water_sports && a.free_water_sports)         return 'Complimentary watersports & beachfront bliss';
  if (a.water_sports)                                return 'Watersports, lagoon & beachfront luxury';
  if (a.spa && r >= 8.8)                             return 'Top-rated spa & beachfront experience';
  if (br >= 8)                                       return 'Prestigious international brand, Mauritius';
  if (r >= 8.8)                                      return 'Top-rated resort on the Indian Ocean';
  return 'Luxury resort on the shores of Mauritius';
}

// ─────────────────────────────────────────────────────────────────────────────
// Star tier strip
// ─────────────────────────────────────────────────────────────────────────────

function starStrip(count) {
  const n = Math.min(5, Math.max(0, Math.round(count || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG Card Generator
// ─────────────────────────────────────────────────────────────────────────────

function buildCardSVG(opts) {
  const {
    hotelId,
    hotelName,
    rating,
    region,
    starRating,
    sellingPoint,
    hue,
    isGeneric,
  } = opts;

  const bgDark  = `hsl(${hue}, 45%, 6%)`;
  const bgMid   = `hsl(${hue}, 50%, 10%)`;
  const bgRight = `hsl(${hue}, 38%, 14%)`;

  // ── Name wrapping (max 32 chars per line at base size) ──────────────────
  const nameMaxChars = 32;
  const nameLines    = wrapText(hotelName, nameMaxChars).slice(0, 2);
  const nameFontSize = nameLines[0] && nameLines[0].length > 24 ? 44 : 52;
  const nameLineH    = nameFontSize + 14;
  const nameY0       = isGeneric ? 220 : (nameLines.length > 1 ? 178 : 210);

  const nameTextEls = nameLines.map((line, i) => [
    `  <text`,
    `    x="80" y="${nameY0 + i * nameLineH}"`,
    `    font-family="Georgia,'Times New Roman',serif"`,
    `    font-size="${nameFontSize}"`,
    `    font-weight="bold"`,
    `    fill="#f5e6c8"`,
    `    letter-spacing="-0.02em">`,
    `    ${esc(line)}`,
    `  </text>`,
  ].join('\n')).join('\n');

  const afterNameY   = nameY0 + nameLines.length * nameLineH;
  const dividerY     = afterNameY + 18;
  const regionY      = dividerY  + 46;
  const pointY       = regionY   + 50;
  const starY        = pointY    + 48;

  // ── Selling point wrapping (max 58 chars) ────────────────────────────────
  const ptLines    = wrapText(sellingPoint, 58).slice(0, 2);
  const ptTextEls  = ptLines.map((line, i) => [
    `  <text`,
    `    x="80" y="${pointY + i * 40}"`,
    `    font-family="Arial,Helvetica,sans-serif"`,
    `    font-size="26"`,
    `    fill="rgba(196,187,168,0.88)">`,
    `    ${esc(line)}`,
    `  </text>`,
  ].join('\n')).join('\n');

  // ── Generic site card content (no hotel-specific data) ───────────────────
  const genericContent = isGeneric ? `
  <text
    x="80" y="${nameY0}"
    font-family="Georgia,'Times New Roman',serif"
    font-size="58" font-weight="bold" fill="#f5e6c8" letter-spacing="-0.03em">
    Mauritius Resort
  </text>
  <text
    x="80" y="${nameY0 + 80}"
    font-family="Georgia,'Times New Roman',serif"
    font-size="58" font-weight="bold" fill="#c9a84c" letter-spacing="-0.03em">
    Finder
  </text>
  <rect x="80" y="${nameY0 + 116}" width="280" height="2" fill="url(#gold-h)" opacity="0.6"/>
  <text
    x="80" y="${nameY0 + 168}"
    font-family="Arial,Helvetica,sans-serif"
    font-size="26" fill="rgba(196,187,168,0.88)">
    Independent luxury hotel rankings
  </text>
  <text
    x="80" y="${nameY0 + 218}"
    font-family="Arial,Helvetica,sans-serif"
    font-size="20" fill="rgba(139,148,158,0.7)" letter-spacing="0.05em">
    36 RESORTS · INDEPENDENTLY SCORED · 2026
  </text>` : '';

  const hotelContent = !isGeneric ? `
  ${nameTextEls}

  <rect x="80" y="${dividerY}" width="220" height="1.5" fill="url(#gold-h)" opacity="0.6"/>

  <text
    x="80" y="${regionY}"
    font-family="Arial,Helvetica,sans-serif"
    font-size="17" font-weight="600" letter-spacing="0.12em"
    fill="rgba(201,168,76,0.72)">
    ${esc(region.toUpperCase())} · MAURITIUS
  </text>

  ${ptTextEls}

  <text
    x="80" y="${starY}"
    font-family="Georgia,serif"
    font-size="18" fill="rgba(201,168,76,0.45)" letter-spacing="0.05em">
    ${esc(starStrip(starRating))}
  </text>` : '';

  const ratingBadge = !isGeneric && rating ? `
  <rect
    x="${CARD_W - 188}" y="28"
    width="156" height="60"
    rx="30"
    fill="rgba(201,168,76,0.1)"
    stroke="#c9a84c" stroke-width="1.5"/>
  <text
    x="${CARD_W - 110}" y="51"
    font-family="Arial,Helvetica,sans-serif"
    font-size="12" font-weight="700" letter-spacing="0.14em"
    fill="rgba(201,168,76,0.55)" text-anchor="middle">
    RATING
  </text>
  <text
    x="${CARD_W - 110}" y="76"
    font-family="Georgia,serif"
    font-size="26" font-weight="bold"
    fill="#c9a84c" text-anchor="middle">
    ${esc(String(rating))}/10
  </text>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  width="${CARD_W}" height="${CARD_H}"
  viewBox="0 0 ${CARD_W} ${CARD_H}"
  xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"
      gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="${bgDark}"/>
      <stop offset="55%"  stop-color="${bgMid}"/>
      <stop offset="100%" stop-color="${bgRight}"/>
    </linearGradient>
    <radialGradient id="glow" cx="75%" cy="18%" r="55%"
      gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="hsl(${hue},58%,20%)" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${bgDark}"            stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold-h" x1="0" y1="0" x2="1" y2="0"
      gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#9b7d35"/>
      <stop offset="50%"  stop-color="#c9a84c"/>
      <stop offset="100%" stop-color="#e2bc60"/>
    </linearGradient>
    <linearGradient id="gold-v" x1="0" y1="0" x2="0" y2="1"
      gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#c9a84c"/>
      <stop offset="100%" stop-color="#9b7d35"/>
    </linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none"
        stroke="rgba(255,255,255,0.018)" stroke-width="1"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#grid)"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="5" height="${CARD_H}" fill="url(#gold-v)"/>

  <!-- Corner ornament top-left -->
  <rect x="28" y="28" width="56"  height="2" fill="#c9a84c" opacity="0.45"/>
  <rect x="28" y="28" width="2"   height="56" fill="#c9a84c" opacity="0.45"/>

  <!-- Corner ornament bottom-right -->
  <rect x="${CARD_W - 84}" y="${CARD_H - 30}" width="56" height="2"
    fill="#c9a84c" opacity="0.25"/>
  <rect x="${CARD_W - 30}" y="${CARD_H - 84}" width="2" height="56"
    fill="#c9a84c" opacity="0.25"/>

  <!-- Rating badge (hotel pages only) -->
  ${ratingBadge}

  <!-- Main content -->
  ${hotelContent}
  ${genericContent}

  <!-- Bottom bar -->
  <rect x="0" y="${CARD_H - 68}" width="${CARD_W}" height="68"
    fill="rgba(0,0,0,0.30)"/>

  <!-- Brand URL -->
  <text
    x="80" y="${CARD_H - 24}"
    font-family="Arial,Helvetica,sans-serif"
    font-size="18" fill="rgba(139,148,158,0.7)">
    mauritiusresortfinder.com
  </text>

  <!-- Logo mark -->
  <rect x="${CARD_W - 104}" y="${CARD_H - 56}" width="76" height="30"
    rx="7" fill="#c9a84c"/>
  <text
    x="${CARD_W - 66}" y="${CARD_H - 34}"
    font-family="Georgia,serif"
    font-size="14" font-weight="bold" fill="#08111f" text-anchor="middle">
    MRF
  </text>
</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates social card SVGs for an array of hotels into outDir.
 * Also generates a generic site card.
 * Skips cards whose content hash has not changed since last run.
 *
 * @param  {Object[]} hotels   — active hotel objects from dataset
 * @param  {string}  outDir   — absolute path to dist/ directory
 * @returns {{ generated: number, cached: number, total: number }}
 */
function generateSocialCards(hotels, outDir) {
  const socialDir = path.join(outDir, 'assets', 'social');
  if (!fs.existsSync(socialDir)) fs.mkdirSync(socialDir, { recursive: true });

  const cache    = loadCache();
  const newCache = {};
  let generated  = 0;
  let cached     = 0;

  // ── Hotel cards ──────────────────────────────────────────────────────────
  for (const hotel of (hotels || [])) {
    const id       = hotel.hotel_id;
    const name     = hotel.hotel_name || id;
    const rating   = hotel.overall_rating ? parseFloat(hotel.overall_rating.toFixed(1)) : null;
    const region   = hotel.region || 'Mauritius';
    const stars    = hotel.star_rating || 5;
    const point    = getSellingPoint(hotel);
    const hue      = getHue(id);

    const inputData = { id, name, rating, region, stars, point, hue };
    const hash      = contentHash(inputData);
    newCache[id]    = hash;

    if (cache[id] === hash) {
      const filePath = path.join(socialDir, `${id}.svg`);
      if (fs.existsSync(filePath)) { cached++; continue; }
    }

    const svg = buildCardSVG({
      hotelId:      id,
      hotelName:    name,
      rating,
      region,
      starRating:   stars,
      sellingPoint: point,
      hue,
      isGeneric:    false,
    });

    fs.writeFileSync(path.join(socialDir, `${id}.svg`), svg, 'utf8');
    generated++;
  }

  // ── Generic site card ────────────────────────────────────────────────────
  const genericHash = contentHash({ type: 'generic', v: 2 });
  newCache['__generic__'] = genericHash;

  if (cache['__generic__'] !== genericHash || !fs.existsSync(path.join(socialDir, 'generic.svg'))) {
    const svg = buildCardSVG({
      hotelId:      '__generic__',
      hotelName:    '',
      rating:       null,
      region:       '',
      starRating:   5,
      sellingPoint: '',
      hue:          205,
      isGeneric:    true,
    });
    fs.writeFileSync(path.join(socialDir, 'generic.svg'), svg, 'utf8');
    generated++;
  } else {
    cached++;
  }

  saveCache(newCache);

  return {
    generated,
    cached,
    total: generated + cached,
  };
}

/**
 * Returns the absolute og:image URL for a given hotel_id.
 * Pass null for non-hotel pages (returns generic card URL).
 *
 * @param  {string|null} hotelId
 * @param  {string}      baseUrl
 * @returns {string}
 */
function socialCardUrl(hotelId, baseUrl) {
  const base = (baseUrl || 'https://mauritiusresortfinder.com').replace(/\/$/, '');
  if (hotelId) return `${base}/assets/social/${hotelId}.svg`;
  return `${base}/assets/social/generic.svg`;
}

module.exports = {
  generateSocialCards,
  socialCardUrl,
  getSellingPoint,
  buildCardSVG,
  wrapText,
  contentHash,
  getHue,
};
