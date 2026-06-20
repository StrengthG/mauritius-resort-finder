/**
 * hotel_image_engine.js
 * Mauritius Resort Finder — Hotel Image Engine
 *
 * Handles all image rendering for hotel pages:
 *   - Hero images (full-width, above fold)
 *   - Gallery strips (thumbnail row, lightbox-enabled)
 *   - Hotel card thumbnails (on ranking/persona pages)
 *   - CSS gradient placeholders (when real photos are unavailable)
 *   - ImageObject schema.org markup
 *   - Image sitemap XML generation
 *
 * Image file convention (relative to output dist/ root):
 *   assets/images/hotels/{hotel_id}/hero.webp        1200×800  (3:2)
 *   assets/images/hotels/{hotel_id}/gallery-1.webp    800×600
 *   assets/images/hotels/{hotel_id}/gallery-2.webp    800×600
 *   assets/images/hotels/{hotel_id}/gallery-3.webp    800×600
 *   assets/images/hotels/{hotel_id}/gallery-4.webp    800×600
 *   assets/images/hotels/{hotel_id}/thumb.webp        400×300  (4:3)
 *
 * Drop real WebP files into the above paths and rebuild — placeholders
 * are replaced automatically without any code changes.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_DATA_PATH = path.join(__dirname, 'data', 'hotel-images.json');

const HERO_W    = 1200;
const HERO_H    = 800;
const GALLERY_W = 800;
const GALLERY_H = 600;
const THUMB_W   = 400;
const THUMB_H   = 300;

const GALLERY_COUNT = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Image data loader (cached)
// ─────────────────────────────────────────────────────────────────────────────

let _cache = null;

function loadImageData() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(IMAGE_DATA_PATH, 'utf8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch (_) {
    _cache = { hotels: {} };
    return _cache;
  }
}

function getHotelImages(hotelId) {
  const data = loadImageData();
  return (data.hotels && data.hotels[hotelId]) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// File path helpers
// ─────────────────────────────────────────────────────────────────────────────

function heroWebPath(hotelId) {
  return `/assets/images/hotels/${hotelId}/hero.webp`;
}

function galleryWebPath(hotelId, index) {
  return `/assets/images/hotels/${hotelId}/gallery-${index}.webp`;
}

function thumbWebPath(hotelId) {
  return `/assets/images/hotels/${hotelId}/thumb.webp`;
}

function heroFsPath(hotelId, outDir) {
  return path.join(outDir, 'assets', 'images', 'hotels', hotelId, 'hero.webp');
}

function galleryFsPath(hotelId, index, outDir) {
  return path.join(outDir, 'assets', 'images', 'hotels', hotelId, `gallery-${index}.webp`);
}

function thumbFsPath(hotelId, outDir) {
  return path.join(outDir, 'assets', 'images', 'hotels', hotelId, 'thumb.webp');
}

// PNG source paths — checked against assets/ source dir (not dist/) so they're found on first build
function heroPngFsPath(hotelId) {
  return path.join(__dirname, 'assets', 'images', 'hotels', hotelId, 'photo_01.png');
}

function galleryPngFsPath(hotelId, galleryIndex) {
  const num = String(galleryIndex + 1).padStart(2, '0');
  return path.join(__dirname, 'assets', 'images', 'hotels', hotelId, `photo_${num}.png`);
}

function heroPngWebPath(hotelId) {
  return `/assets/images/hotels/${hotelId}/photo_01.png`;
}

function galleryPngWebPath(hotelId, galleryIndex) {
  const num = String(galleryIndex + 1).padStart(2, '0');
  return `/assets/images/hotels/${hotelId}/photo_${num}.png`;
}

function fileExists(fsPath) {
  try { return fs.existsSync(fsPath); } catch (_) { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML escaping (minimal subset — renderer's esc() not available here)
// ─────────────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS Gradient Placeholder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a CSS gradient placeholder <figure> when no real image file exists.
 * Each hotel gets a unique gradient derived from its hotel_id hue setting.
 *
 * @param  {string} hotelId
 * @param  {string} hotelName
 * @param  {string} region
 * @param  {string} variant — 'hero' | 'gallery' | 'thumb'
 * @param  {string} altText
 * @returns {string} HTML
 */
function renderPlaceholder(hotelId, hotelName, region, variant, altText) {
  const imageData = getHotelImages(hotelId);
  const hue = (imageData && imageData.theme && imageData.theme.hue) || deriveHue(hotelId);
  const label = (imageData && imageData.theme && imageData.theme.label) || region;

  const aspectClass = variant === 'thumb' ? 'hotel-img--thumb' :
                      variant === 'gallery' ? 'hotel-img--gallery' :
                      'hotel-img--hero';

  const shortName = hotelName.replace(/ (Resort|Hotel|Villas?|Boutique|Suites?).*$/i, '').trim();

  return [
    `<figure class="hotel-img hotel-img--placeholder ${esc(aspectClass)}"`,
    `        data-hotel-id="${esc(hotelId)}"`,
    `        style="--hi-hue:${hue}"`,
    `        role="img"`,
    `        aria-label="${esc(altText || hotelName)}">`,
    `  <div class="hotel-img__grad" aria-hidden="true"></div>`,
    `  <div class="hotel-img__overlay" aria-hidden="true">`,
    `    <span class="hotel-img__region">${esc(region)}</span>`,
    `    <span class="hotel-img__name">${esc(shortName)}</span>`,
    `    <span class="hotel-img__note">${esc(label)}</span>`,
    `  </div>`,
    `</figure>`,
  ].join('\n');
}

function deriveHue(hotelId) {
  let h = 0;
  for (let i = 0; i < hotelId.length; i++) h = (h * 31 + hotelId.charCodeAt(i)) & 0xffff;
  return 170 + (h % 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// Real image <picture> element
// ─────────────────────────────────────────────────────────────────────────────

function renderPicture(webPath, altText, width, height, loading, extraClass) {
  const srcset2x = webPath.replace('.webp', '@2x.webp');
  return [
    `<figure class="hotel-img${extraClass ? ' ' + extraClass : ''}">`,
    `  <picture>`,
    `    <source`,
    `      srcset="${esc(webPath)} 1x, ${esc(srcset2x)} 2x"`,
    `      type="image/webp">`,
    `    <img`,
    `      src="${esc(webPath)}"`,
    `      alt="${esc(altText)}"`,
    `      width="${width}"`,
    `      height="${height}"`,
    `      loading="${loading}"`,
    `      decoding="async"`,
    `      class="hotel-img__real">`,
    `  </picture>`,
    `</figure>`,
  ].join('\n');
}

function renderPngImage(webPath, altText, width, height, loading, extraClass) {
  return [
    `<figure class="hotel-img${extraClass ? ' ' + extraClass : ''}">`,
    `  <img`,
    `    src="${esc(webPath)}"`,
    `    alt="${esc(altText)}"`,
    `    width="${width}"`,
    `    height="${height}"`,
    `    loading="${loading}"`,
    `    decoding="async"`,
    `    class="hotel-img__real">`,
    `</figure>`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public rendering API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the hero image (or placeholder) for a hotel detail page.
 * Hero is above the fold — eager loaded, preloaded in <head>.
 *
 * @param  {string} hotelId
 * @param  {string} hotelName
 * @param  {string} region
 * @param  {string} [outDir]  — dist/ path; if provided, checks for real image
 * @returns {string} HTML
 */
function renderHeroImage(hotelId, hotelName, region, outDir) {
  const imageData = getHotelImages(hotelId);
  const altText   = (imageData && imageData.hero && imageData.hero.alt) ||
                    `${hotelName} hotel resort and pool, ${region}, Mauritius`;
  const caption   = imageData && imageData.hero && imageData.hero.caption;

  const fsPath  = outDir ? heroFsPath(hotelId, outDir) : null;
  const hasReal = fsPath && fileExists(fsPath);
  const hasPng  = fileExists(heroPngFsPath(hotelId));

  let figureHtml;
  if (hasReal) {
    figureHtml = renderPicture(heroWebPath(hotelId), altText, HERO_W, HERO_H, 'eager', 'hotel-img--hero');
  } else if (hasPng) {
    figureHtml = renderPngImage(heroPngWebPath(hotelId), altText, HERO_W, HERO_H, 'eager', 'hotel-img--hero');
  } else {
    figureHtml = renderPlaceholder(hotelId, hotelName, region, 'hero', altText);
  }

  return [
    `<div class="hotel-hero-img" data-hotel-id="${esc(hotelId)}">`,
    `  <div class="hotel-hero-img__inner">`,
    figureHtml.split('\n').map(l => '    ' + l).join('\n'),
    caption ? `    <figcaption class="hotel-hero-img__caption">${esc(caption)}</figcaption>` : '',
    `  </div>`,
    `</div>`,
  ].filter(l => l.trim() !== '').join('\n');
}

/**
 * Render the gallery strip (4 thumbnails) for a hotel detail page.
 * Gallery images are lazy-loaded; clicking opens the lightbox.
 *
 * @param  {string} hotelId
 * @param  {string} hotelName
 * @param  {string} region
 * @param  {string} [outDir]
 * @returns {string} HTML  (empty string if no images and no data)
 */
function renderGalleryStrip(hotelId, hotelName, region, outDir) {
  const imageData = getHotelImages(hotelId);
  const hasPngFiles = fileExists(galleryPngFsPath(hotelId, 1));
  if (!imageData && !hasPngFiles) return '';

  const gallery = imageData ? (imageData.gallery || []) : [];
  const thumbItems = [];

  for (let i = 1; i <= GALLERY_COUNT; i++) {
    const meta    = gallery[i - 1] || {};
    const altText = meta.alt || `${hotelName} gallery image ${i}, ${region}, Mauritius`;
    const caption = meta.caption || '';

    const fsPath  = outDir ? galleryFsPath(hotelId, i, outDir) : null;
    const hasReal = fsPath && fileExists(fsPath);
    const hasPng  = fileExists(galleryPngFsPath(hotelId, i));

    let figHtml;
    if (hasReal) {
      figHtml = renderPicture(galleryWebPath(hotelId, i), altText, GALLERY_W, GALLERY_H, 'lazy', 'hotel-img--gallery');
    } else if (hasPng) {
      figHtml = renderPngImage(galleryPngWebPath(hotelId, i), altText, GALLERY_W, GALLERY_H, 'lazy', 'hotel-img--gallery');
    } else {
      figHtml = renderPlaceholder(hotelId, hotelName, region, 'gallery', altText);
    }

    thumbItems.push([
      `  <button class="gallery-strip__btn"`,
      `          data-gallery-index="${i - 1}"`,
      `          data-hotel-id="${esc(hotelId)}"`,
      `          aria-label="${esc('View image: ' + altText)}"`,
      `          type="button">`,
      figHtml.split('\n').map(l => '    ' + l).join('\n'),
      caption ? `    <figcaption class="gallery-strip__caption">${esc(caption)}</figcaption>` : '',
      `  </button>`,
    ].filter(l => l.trim() !== '').join('\n'));
  }

  return [
    `<div class="gallery-strip" data-hotel-id="${esc(hotelId)}" aria-label="Photo gallery for ${esc(hotelName)}">`,
    `  <div class="gallery-strip__inner">`,
    thumbItems.map(item => item.split('\n').map(l => '  ' + l).join('\n')).join('\n'),
    `  </div>`,
    `  <p class="gallery-strip__hint" aria-hidden="true">Tap to enlarge</p>`,
    `</div>`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo discovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discover all available photos for a hotel, in order.
 * Prefers photo_01.webp … photo_10.webp; falls back to .png at same path.
 * Also falls back to hero.webp / gallery-N.webp if neither exists.
 *
 * @param  {string} hotelId
 * @param  {string} hotelName
 * @param  {string} region
 * @param  {Object} [imageData]  — from hotel-images.json
 * @returns {Array<{webPath, altText, loading, index}>}
 */
function discoverPhotos(hotelId, hotelName, region, imageData) {
  const photos = [];
  const gallery = (imageData && imageData.gallery) || [];

  // Primary: photo_01.webp (preferred) → photo_01.png (fallback)
  for (let i = 1; i <= 10; i++) {
    const num     = String(i).padStart(2, '0');
    const base    = path.join(__dirname, 'assets', 'images', 'hotels', hotelId, `photo_${num}`);
    const webpFs  = base + '.webp';
    const pngFs   = base + '.png';
    const useWebp = fileExists(webpFs);
    const usePng  = !useWebp && fileExists(pngFs);
    if (!useWebp && !usePng) break;

    const ext     = useWebp ? 'webp' : 'png';
    const meta    = i === 1
      ? (imageData && imageData.hero) || {}
      : gallery[i - 2] || {};
    const altText = meta.alt ||
      (i === 1
        ? `${hotelName} resort, ${region}, Mauritius`
        : `${hotelName} gallery photo ${i}, ${region}, Mauritius`);

    photos.push({
      webPath:  `/assets/images/hotels/${hotelId}/photo_${num}.${ext}`,
      altText,
      loading:  i === 1 ? 'eager' : 'lazy',
      width:    i === 1 ? HERO_W : GALLERY_W,
      height:   i === 1 ? HERO_H : GALLERY_H,
      index:    i - 1,
    });
  }

  // Fallback: hero.webp / gallery-N.webp
  if (photos.length === 0) {
    const heroFsP = path.join(__dirname, 'assets', 'images', 'hotels', hotelId, 'hero.webp');
    if (fileExists(heroFsP)) {
      const heroAlt = (imageData && imageData.hero && imageData.hero.alt) ||
                      `${hotelName} resort, ${region}, Mauritius`;
      photos.push({
        webPath: heroWebPath(hotelId),
        altText: heroAlt,
        loading: 'eager',
        width:   HERO_W,
        height:  HERO_H,
        index:   0,
      });
      for (let i = 1; i <= GALLERY_COUNT; i++) {
        const fsP = path.join(__dirname, 'assets', 'images', 'hotels', hotelId, `gallery-${i}.webp`);
        if (!fileExists(fsP)) continue;
        const meta    = gallery[i - 1] || {};
        const altText = meta.alt || `${hotelName} gallery photo ${i + 1}, ${region}, Mauritius`;
        photos.push({
          webPath: galleryWebPath(hotelId, i),
          altText,
          loading: 'lazy',
          width:   GALLERY_W,
          height:  GALLERY_H,
          index:   i,
        });
      }
    }
  }

  return photos;
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG icons
// ─────────────────────────────────────────────────────────────────────────────

const GRID_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">` +
  `<rect x="1" y="1" width="9" height="9" rx="1.5"/>` +
  `<rect x="12" y="1" width="9" height="9" rx="1.5"/>` +
  `<rect x="1" y="12" width="9" height="9" rx="1.5"/>` +
  `<rect x="12" y="12" width="9" height="9" rx="1.5"/>` +
  `</svg>`;

// ─────────────────────────────────────────────────────────────────────────────
// Luxury Gallery — Airbnb-style (60 % hero / 40 % 2×2 thumbnails)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the premium hotel gallery for a hotel detail page.
 *
 * Desktop layout:
 *   ┌──────────────────────┬──────────┬──────────┐  ↕ 260px
 *   │                      │  photo2  │  photo3  │
 *   │      hero (photo1)   ├──────────┼──────────┤  ↕ 260px
 *   │       60% width      │  photo4  │  photo5⊞ │
 *   └──────────────────────┴──────────┴──────────┘
 *
 * Mobile: swipeable horizontal carousel with snap scrolling.
 *
 * @param  {string} hotelId
 * @param  {string} hotelName
 * @param  {string} region
 * @param  {string} [outDir]   — unused (kept for API compat)
 * @returns {string} HTML (empty string if no images available)
 */
function renderPhotoMosaic(hotelId, hotelName, region, outDir) {  // eslint-disable-line no-unused-vars
  const imageData = getHotelImages(hotelId);
  const photos    = discoverPhotos(hotelId, hotelName, region, imageData);

  // No images → no gallery (hotel page renders without gallery section)
  if (photos.length === 0) return '';

  const totalPhotos = photos.length;
  const heroPhoto   = photos[0];
  const thumbPhotos = photos.slice(1, 5); // up to 4 thumbnails
  const shownCount  = 1 + thumbPhotos.length;
  const heroCaption = imageData && imageData.hero && imageData.hero.caption;

  // ── Hero button ──────────────────────────────────────────────────────────
  const heroCaptionHtml = heroCaption
    ? `\n  <p class="hg-caption">${esc(heroCaption)}</p>`
    : '';

  const heroBtn = [
    `<button class="hg__hero" data-idx="0" data-hotel-id="${esc(hotelId)}" type="button"`,
    `        aria-label="${esc('View photos of ' + hotelName)}">`,
    `  <figure class="hg-img">`,
    `    <img src="${esc(heroPhoto.webPath)}"`,
    `         alt="${esc(heroPhoto.altText)}"`,
    `         width="${heroPhoto.width}" height="${heroPhoto.height}"`,
    `         loading="eager" decoding="async" fetchpriority="high"`,
    `         class="hg-img__pic">`,
    `  </figure>${heroCaptionHtml}`,
    `</button>`,
  ].join('\n');

  // ── Thumbnail buttons ────────────────────────────────────────────────────
  const thumbBtns = thumbPhotos.map((photo, i) => {
    const isLast  = i === thumbPhotos.length - 1 && thumbPhotos.length === 4;
    const classes = `hg__cell${isLast ? ' hg__cell--last' : ''}`;
    const overlay = isLast
      ? [
          `  <span class="hg-more" aria-hidden="true">`,
          `    ${GRID_SVG}`,
          `    <span>Show all photos</span>`,
          `  </span>`,
        ].join('\n')
      : '';

    return [
      `<button class="${classes}" data-idx="${photo.index}" data-hotel-id="${esc(hotelId)}" type="button"`,
      `        aria-label="${esc('Photo ' + (photo.index + 1) + ' of ' + hotelName)}">`,
      `  <figure class="hg-img">`,
      `    <img src="${esc(photo.webPath)}"`,
      `         alt="${esc(photo.altText)}"`,
      `         width="${photo.width}" height="${photo.height}"`,
      `         loading="lazy" decoding="async"`,
      `         class="hg-img__pic">`,
      `  </figure>`,
      overlay,
      `</button>`,
    ].filter(Boolean).join('\n');
  });

  // ── Right-side grid (absent when hero-only) ──────────────────────────────
  const gridHtml = thumbBtns.length > 0
    ? [
        `<div class="hg__grid" data-cells="${thumbBtns.length}">`,
        thumbBtns.map(b => b.split('\n').map(l => '  ' + l).join('\n')).join('\n'),
        `</div>`,
      ].join('\n')
    : '';

  // ── "Show all photos" floating button (Airbnb-style, desktop only) ───────
  const showAllBtn = totalPhotos >= 5
    ? [
        `<button class="hg__show-all" type="button" aria-label="Show all ${totalPhotos} photos">`,
        `  ${GRID_SVG}`,
        `  <span>Show all photos</span>`,
        `</button>`,
      ].join('\n')
    : '';

  // ── Assemble ─────────────────────────────────────────────────────────────
  return [
    `<section class="hg" data-hotel-id="${esc(hotelId)}" data-count="${shownCount}" data-total="${totalPhotos}"`,
    `         aria-label="Photo gallery for ${esc(hotelName)}">`,
    heroBtn.split('\n').map(l => '  ' + l).join('\n'),
    gridHtml ? gridHtml.split('\n').map(l => '  ' + l).join('\n') : '',
    showAllBtn ? showAllBtn.split('\n').map(l => '  ' + l).join('\n') : '',
    `</section>`,
  ].filter(l => l.trim() !== '').join('\n');
}

/**
 * Render a thumbnail for a hotel card (ranking / persona pages).
 *
 * @param  {string} hotelId
 * @param  {string} hotelName
 * @param  {string} region
 * @param  {string} [outDir]
 * @returns {string} HTML
 */
function renderCardThumbnail(hotelId, hotelName, region, outDir) {
  const imageData = getHotelImages(hotelId);
  const altText   = (imageData && imageData.thumb && imageData.thumb.alt) ||
                    `${hotelName}, ${region}, Mauritius`;

  const fsPath  = outDir ? thumbFsPath(hotelId, outDir) : null;
  const hasReal = fsPath && fileExists(fsPath);
  const hasPng  = fileExists(heroPngFsPath(hotelId));

  if (hasReal) {
    return renderPicture(thumbWebPath(hotelId), altText, THUMB_W, THUMB_H, 'lazy', 'hotel-img--thumb');
  }
  if (hasPng) {
    return renderPngImage(heroPngWebPath(hotelId), altText, THUMB_W, THUMB_H, 'lazy', 'hotel-img--thumb');
  }
  return renderPlaceholder(hotelId, hotelName, region, 'thumb', altText);
}

// ─────────────────────────────────────────────────────────────────────────────
// <link rel="preload"> for hero image
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a <link rel="preload"> tag for the hero image, if it exists.
 * Placed in <head> for hotel detail pages.
 *
 * @param  {string} hotelId
 * @param  {string} [outDir]
 * @returns {string} HTML or empty string
 */
function heroPreloadTag(hotelId, outDir) {
  // WebP preferred (photo_01.webp)
  const webpFs = path.join(__dirname, 'assets', 'images', 'hotels', hotelId, 'photo_01.webp');
  if (fileExists(webpFs)) {
    return `  <link rel="preload" as="image" href="/assets/images/hotels/${hotelId}/photo_01.webp" type="image/webp">`;
  }
  // PNG fallback
  if (fileExists(heroPngFsPath(hotelId))) {
    return `  <link rel="preload" as="image" href="${esc(heroPngWebPath(hotelId))}" type="image/png">`;
  }
  // Legacy hero.webp
  if (outDir && fileExists(heroFsPath(hotelId, outDir))) {
    return `  <link rel="preload" as="image" href="${esc(heroWebPath(hotelId))}" type="image/webp">`;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageObject schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an array of schema.org ImageObject entries for a hotel.
 * Appended to the Hotel JSON-LD object's "image" array.
 *
 * @param  {string} hotelId
 * @param  {string} hotelName
 * @param  {string} region
 * @param  {string} baseUrl
 * @param  {string} [outDir]  — only include existing images if outDir provided
 * @returns {Object[]}  — schema.org ImageObject array (may be empty)
 */
function buildImageObjectSchema(hotelId, hotelName, region, baseUrl, outDir) {
  const base      = (baseUrl || '').replace(/\/$/, '');
  const imageData = getHotelImages(hotelId);
  if (!imageData) return [];

  const results = [];

  // Hero
  const heroAlt = (imageData.hero && imageData.hero.alt) ||
                  `${hotelName} resort, ${region}, Mauritius`;
  const heroPath = heroFsPath(hotelId, outDir || '');
  const heroReal = outDir ? fileExists(heroPath) : true;
  if (heroReal || !outDir) {
    results.push({
      '@type':  'ImageObject',
      url:       base + heroWebPath(hotelId),
      width:     HERO_W,
      height:    HERO_H,
      caption:   heroAlt,
    });
  }

  // Gallery
  const gallery = imageData.gallery || [];
  for (let i = 1; i <= GALLERY_COUNT; i++) {
    const meta    = gallery[i - 1] || {};
    const altText = meta.alt || `${hotelName} gallery image ${i}, ${region}`;
    const fsPath  = galleryFsPath(hotelId, i, outDir || '');
    const hasReal = outDir ? fileExists(fsPath) : true;
    if (hasReal || !outDir) {
      results.push({
        '@type':  'ImageObject',
        url:       base + galleryWebPath(hotelId, i),
        width:     GALLERY_W,
        height:    GALLERY_H,
        caption:   altText,
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image Sitemap
// ─────────────────────────────────────────────────────────────────────────────

function xmlEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generate an image sitemap XML document for all hotels that have real images
 * (or all hotels when outDir is not specified — builds index of intended images).
 *
 * @param  {Object[]} hotels    — array of active hotel objects from dataset
 * @param  {string}   baseUrl
 * @param  {string}   [outDir]
 * @returns {string} XML string
 */
function generateImageSitemap(hotels, baseUrl, outDir) {
  const base      = (baseUrl || '').replace(/\/$/, '');
  const imageData = loadImageData();
  const entries   = [];

  for (const hotel of (hotels || [])) {
    const id   = hotel.hotel_id;
    const name = hotel.hotel_name || id;
    const data = imageData.hotels && imageData.hotels[id];
    if (!data) continue;

    // Slugify to match the site_builder _slugify logic
    const slug = 'hotels/' + String(name)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const pageUrl = `${base}/${slug}/`;

    const images = [];

    // Hero
    const heroAlt = (data.hero && data.hero.alt) || `${name}, ${hotel.region}, Mauritius`;
    const heroReal = outDir ? fileExists(heroFsPath(id, outDir)) : true;
    if (heroReal || !outDir) {
      images.push({ url: base + heroWebPath(id), title: heroAlt });
    }

    // Gallery
    const gallery = data.gallery || [];
    for (let i = 1; i <= GALLERY_COUNT; i++) {
      const meta    = gallery[i - 1] || {};
      const altText = meta.alt || `${name} gallery image ${i}`;
      const fsPath  = outDir ? galleryFsPath(id, i, outDir) : null;
      const hasReal = outDir ? fileExists(fsPath) : true;
      if (hasReal || !outDir) {
        images.push({ url: base + galleryWebPath(id, i), title: altText });
      }
    }

    if (images.length === 0) continue;

    const imageXml = images.map(img => [
      `    <image:image>`,
      `      <image:loc>${xmlEsc(img.url)}</image:loc>`,
      `      <image:title>${xmlEsc(img.title)}</image:title>`,
      `    </image:image>`,
    ].join('\n')).join('\n');

    entries.push([
      `  <url>`,
      `    <loc>${xmlEsc(pageUrl)}</loc>`,
      imageXml,
      `  </url>`,
    ].join('\n'));
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset`,
    `  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`,
    `  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`,
    ...entries,
    `</urlset>`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  loadImageData,
  getHotelImages,
  renderHeroImage,
  renderGalleryStrip,
  renderPhotoMosaic,
  renderCardThumbnail,
  heroPreloadTag,
  buildImageObjectSchema,
  generateImageSitemap,
  renderPlaceholder,
  renderPicture,
  // path helpers (for tests)
  heroWebPath,
  galleryWebPath,
  thumbWebPath,
};
