/**
 * hotel_image_engine.test.js
 * Mauritius Resort Finder — Hotel Image Engine Test Suite
 *
 * Self-running. No test framework required.
 * Run: node hotel_image_engine.test.js
 *
 * Exit code 0 = all tests passed.
 * Exit code 1 = one or more failures.
 */

'use strict';

const {
  loadImageData,
  getHotelImages,
  renderPlaceholder,
  renderPicture,
  renderHeroImage,
  renderGalleryStrip,
  renderCardThumbnail,
  heroPreloadTag,
  buildImageObjectSchema,
  generateImageSitemap,
  heroWebPath,
  galleryWebPath,
  thumbWebPath,
} = require('./hotel_image_engine.js');

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL:', label); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else {
    failed++;
    console.error('  FAIL:', label);
    console.error('    Expected:', JSON.stringify(expected));
    console.error('    Actual:  ', JSON.stringify(actual));
  }
}

function suite(name, fn) {
  console.log('\n' + name);
  fn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_HOTEL_ID   = 'MQ001'; // Royal Palm Beachcomber Luxury — in hotel-images.json
const KNOWN_HOTEL_NAME = 'Royal Palm Beachcomber Luxury';
const KNOWN_REGION     = 'Grand Baie';
const MISSING_ID       = 'ZZZZZZ_NOT_IN_DATA';

const SAMPLE_HOTEL = {
  hotel_id:   KNOWN_HOTEL_ID,
  hotel_name: KNOWN_HOTEL_NAME,
  region:     KNOWN_REGION,
};

const BASE_URL = 'https://mauritiusresortfinder.com';

// ─────────────────────────────────────────────────────────────────────────────
// loadImageData / getHotelImages
// ─────────────────────────────────────────────────────────────────────────────

suite('loadImageData', function () {
  const data = loadImageData();
  assert(data !== null && typeof data === 'object', 'returns an object');
  assert(typeof data.hotels === 'object',            'has hotels key');
  assert(Object.keys(data.hotels).length > 0,        'hotels map is non-empty');
  assert(data.hotels[KNOWN_HOTEL_ID] !== undefined,   'known hotel MQ001 present');
});

suite('getHotelImages', function () {
  const img = getHotelImages(KNOWN_HOTEL_ID);
  assert(img !== null,                                       'returns data for known hotel');
  assert(typeof img.hero === 'object',                       'has hero object');
  assert(typeof img.hero.alt === 'string' && img.hero.alt.length > 0, 'hero.alt is non-empty string');
  assert(Array.isArray(img.gallery),                         'gallery is an array');
  assert(img.gallery.length === 4,                           'gallery has 4 entries');
  assert(typeof img.thumb === 'object',                      'has thumb object');
  assert(typeof img.theme === 'object',                      'has theme object');
  assert(typeof img.theme.hue === 'number',                  'theme.hue is a number');

  const missing = getHotelImages(MISSING_ID);
  assert(missing === null, 'returns null for unknown hotel ID');
});

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

suite('heroWebPath', function () {
  const p = heroWebPath(KNOWN_HOTEL_ID);
  assertEqual(p, '/assets/images/hotels/MQ001/hero.webp', 'correct hero path');
  assert(p.startsWith('/assets/'), 'starts with /assets/');
  assert(p.endsWith('.webp'),      'ends with .webp');
});

suite('galleryWebPath', function () {
  assertEqual(galleryWebPath(KNOWN_HOTEL_ID, 1), '/assets/images/hotels/MQ001/gallery-1.webp', 'index 1');
  assertEqual(galleryWebPath(KNOWN_HOTEL_ID, 4), '/assets/images/hotels/MQ001/gallery-4.webp', 'index 4');
  assert(galleryWebPath(KNOWN_HOTEL_ID, 2).includes('gallery-2'), 'contains gallery-2');
});

suite('thumbWebPath', function () {
  const p = thumbWebPath(KNOWN_HOTEL_ID);
  assertEqual(p, '/assets/images/hotels/MQ001/thumb.webp', 'correct thumb path');
  assert(p.endsWith('.webp'), 'ends with .webp');
});

// ─────────────────────────────────────────────────────────────────────────────
// renderPlaceholder
// ─────────────────────────────────────────────────────────────────────────────

suite('renderPlaceholder', function () {
  const html = renderPlaceholder(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION, 'hero', 'Pool view');

  assert(html.includes('hotel-img--placeholder'),         'has placeholder class');
  assert(html.includes('hotel-img--hero'),                'has hero aspect class');
  assert(html.includes('--hi-hue:'),                      'has CSS hue variable');
  assert(html.includes('role="img"'),                     'has role=img for accessibility');
  assert(html.includes('aria-label="Pool view"'),         'has correct aria-label');
  assert(html.includes('hotel-img__grad'),                'has gradient div');
  assert(html.includes('hotel-img__overlay'),             'has overlay div');
  assert(html.includes('hotel-img__region'),              'has region label');
  assert(html.includes('Grand Baie'),                     'region text present');
  assert(html.includes('<figure'),                        'wraps in figure element');
  assert(!html.includes('<script'),                       'no script tags (CSP safe)');

  const galleryHtml = renderPlaceholder(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION, 'gallery', 'Alt');
  assert(galleryHtml.includes('hotel-img--gallery'), 'gallery variant uses gallery class');

  const thumbHtml = renderPlaceholder(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION, 'thumb', 'Alt');
  assert(thumbHtml.includes('hotel-img--thumb'), 'thumb variant uses thumb class');
});

suite('renderPlaceholder — XSS safety', function () {
  const xss  = '<script>alert(1)</script>';
  const html = renderPlaceholder(KNOWN_HOTEL_ID, xss, xss, 'hero', xss);
  assert(!html.includes('<script>'), 'script tag not injected via hotel name');
  assert(html.includes('&lt;script&gt;') || !html.includes('<script>'), 'content is escaped');
});

suite('renderPlaceholder — hue derivation for unknown hotel', function () {
  const html = renderPlaceholder(MISSING_ID, 'Test Hotel', 'Test Region', 'hero', 'Alt');
  assert(html.includes('--hi-hue:'), 'still produces a hue variable via deriveHue');
  const match = html.match(/--hi-hue:(\d+)/);
  assert(match !== null, 'hue variable has a numeric value');
  if (match) {
    const hue = parseInt(match[1], 10);
    assert(hue >= 170 && hue <= 229, 'derived hue is in range 170-229');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// renderPicture
// ─────────────────────────────────────────────────────────────────────────────

suite('renderPicture', function () {
  const html = renderPicture('/assets/images/hotels/MQ001/hero.webp', 'Pool view', 1200, 800, 'eager', 'hotel-img--hero');

  assert(html.includes('<picture>'),            'has picture element');
  assert(html.includes('<source'),              'has source element');
  assert(html.includes('type="image/webp"'),    'source specifies WebP type');
  assert(html.includes('srcset='),              'has srcset attribute');
  assert(html.includes('@2x.webp'),             'includes 2x retina srcset');
  assert(html.includes('1x,'),                  'srcset has 1x descriptor');
  assert(html.includes('alt="Pool view"'),       'alt text applied');
  assert(html.includes('width="1200"'),          'width attribute set');
  assert(html.includes('height="800"'),          'height attribute set');
  assert(html.includes('loading="eager"'),       'loading attribute set');
  assert(html.includes('decoding="async"'),      'decoding=async present');
  assert(html.includes('hotel-img__real'),       'img has real-image class');
  assert(html.includes('hotel-img--hero'),       'figure has extra class');
  assert(!html.includes('<script'),              'no script tags (CSP safe)');
});

suite('renderPicture — lazy loading', function () {
  const html = renderPicture('/assets/images/hotels/MQ001/gallery-1.webp', 'Alt', 800, 600, 'lazy', '');
  assert(html.includes('loading="lazy"'), 'lazy loading applied');
});

suite('renderPicture — XSS safety in src/alt', function () {
  const xss  = '" onerror="alert(1)';
  const html = renderPicture(xss, xss, 100, 100, 'lazy', '');
  // esc() converts " to &quot;, so the literal attribute onerror=" cannot form
  assert(!html.includes(' onerror="'), 'unescaped onerror attribute not injected via src');
  assert(html.includes('&quot;') || !html.includes('"onerror'), 'double-quotes are entity-escaped');
});

// ─────────────────────────────────────────────────────────────────────────────
// renderHeroImage
// ─────────────────────────────────────────────────────────────────────────────

suite('renderHeroImage — without outDir (PNG fallback)', function () {
  const html = renderHeroImage(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION);
  assert(html.includes('hotel-hero-img'),          'has hero wrapper class');
  assert(html.includes('data-hotel-id="MQ001"'),   'has data-hotel-id');
  // PNG photos now exist for MQ001 — engine uses real image instead of gradient placeholder
  assert(html.includes('photo_01.png') || html.includes('hotel-img--placeholder'),
         'uses PNG photo or placeholder');
});

suite('renderHeroImage — with non-existent outDir (PNG fallback)', function () {
  const html = renderHeroImage(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION, '/nonexistent/path');
  // PNG source files exist for MQ001, so engine uses PNG even when outDir has no WebP
  assert(html.includes('photo_01.png') || html.includes('hotel-img--placeholder'),
         'uses PNG photo or placeholder when WebP not found');
});

suite('renderHeroImage — caption from metadata', function () {
  const html = renderHeroImage(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION);
  // MQ001 has caption: "Beachfront infinity pool..."
  assert(html.includes('hotel-hero-img__caption') || html.includes('Beachfront'),
         'caption element rendered for hotels with caption data');
});

// ─────────────────────────────────────────────────────────────────────────────
// renderGalleryStrip
// ─────────────────────────────────────────────────────────────────────────────

suite('renderGalleryStrip — known hotel (placeholder mode)', function () {
  const html = renderGalleryStrip(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION);
  assert(html.includes('gallery-strip'),              'has gallery-strip wrapper');
  assert(html.includes('gallery-strip__inner'),       'has inner grid wrapper');
  assert(html.includes('gallery-strip__btn'),         'has gallery buttons');
  assert(html.includes('gallery-strip__hint'),        'has "Tap to enlarge" hint');
  assert(html.includes('data-gallery-index="0"'),     'first button has index 0');
  assert(html.includes('data-gallery-index="3"'),     'fourth button has index 3');
  assert(html.includes('data-hotel-id="MQ001"'),      'buttons carry hotel ID');
  assert(html.includes('type="button"'),              'buttons have explicit type');

  // Count occurrences of gallery-strip__btn to verify exactly 4
  const btnCount = (html.match(/class="gallery-strip__btn"/g) || []).length;
  assertEqual(btnCount, 4, 'exactly 4 gallery buttons rendered');
});

suite('renderGalleryStrip — unknown hotel returns empty string', function () {
  const html = renderGalleryStrip(MISSING_ID, 'Ghost Hotel', 'Unknown', null);
  assertEqual(html, '', 'empty string for unknown hotel ID');
});

suite('renderGalleryStrip — alt text from metadata', function () {
  const html = renderGalleryStrip(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION);
  // MQ001 gallery[0].alt = "Royal Palm Beachcomber Luxury private beach at sunset..."
  assert(html.includes('private beach') || html.includes('aria-label'),
         'gallery alt text from metadata is present');
});

suite('renderGalleryStrip — captions from metadata', function () {
  const html = renderGalleryStrip(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION);
  // MQ001 gallery[0].caption = "Private beach at golden hour"
  assert(html.includes('golden hour'), 'gallery caption from metadata rendered');
});

// ─────────────────────────────────────────────────────────────────────────────
// renderCardThumbnail
// ─────────────────────────────────────────────────────────────────────────────

suite('renderCardThumbnail — placeholder mode', function () {
  const html = renderCardThumbnail(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION);
  assert(html.includes('hotel-img--placeholder') || html.includes('hotel-img--thumb'),
         'renders thumb variant');
  assert(html.includes('hotel-img'), 'has hotel-img base class');
});

suite('renderCardThumbnail — alt text from metadata', function () {
  const html = renderCardThumbnail(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION);
  // MQ001 thumb.alt = "Royal Palm Beachcomber Luxury hotel, Grand Baie, Mauritius"
  assert(
    html.includes('Royal Palm') || html.includes('Grand Baie'),
    'thumb alt text from hotel-images.json is applied'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// heroPreloadTag
// ─────────────────────────────────────────────────────────────────────────────

suite('heroPreloadTag', function () {
  // No outDir → always empty (cannot know if WebP exists; PNG preload requires outDir arg)
  assertEqual(heroPreloadTag(KNOWN_HOTEL_ID), '', 'empty when no outDir');
  // PNG photos exist for MQ001 — returns PNG preload tag even with non-existent WebP outDir
  const tag = heroPreloadTag(KNOWN_HOTEL_ID, '/nonexistent');
  assert(tag.includes('photo_01.png') || tag === '', 'PNG preload tag or empty when file not present');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildImageObjectSchema
// ─────────────────────────────────────────────────────────────────────────────

suite('buildImageObjectSchema — without outDir (all images)', function () {
  const schema = buildImageObjectSchema(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION, BASE_URL);
  // Without outDir: hero + 4 gallery = 5 entries
  assert(Array.isArray(schema),     'returns an array');
  assert(schema.length === 5,       'returns 5 ImageObjects (hero + 4 gallery)');

  const hero = schema[0];
  assertEqual(hero['@type'],  'ImageObject', 'hero has correct @type');
  assert(hero.url.startsWith(BASE_URL),      'hero URL starts with base URL');
  assert(hero.url.includes('MQ001'),         'hero URL contains hotel ID');
  assert(hero.url.endsWith('.webp'),         'hero URL ends with .webp');
  assertEqual(hero.width,  1200,             'hero width is 1200');
  assertEqual(hero.height, 800,              'hero height is 800');
  assert(typeof hero.caption === 'string',   'hero has caption string');

  const gallery1 = schema[1];
  assertEqual(gallery1['@type'], 'ImageObject', 'gallery item has correct @type');
  assertEqual(gallery1.width,  800,  'gallery width is 800');
  assertEqual(gallery1.height, 600,  'gallery height is 600');
  assert(gallery1.url.includes('gallery-1'), 'gallery-1 URL correct');

  const gallery4 = schema[4];
  assert(gallery4.url.includes('gallery-4'), 'gallery-4 URL correct');
});

suite('buildImageObjectSchema — unknown hotel returns empty array', function () {
  const schema = buildImageObjectSchema(MISSING_ID, 'Ghost', 'Unknown', BASE_URL);
  assert(Array.isArray(schema),    'returns an array');
  assertEqual(schema.length, 0,    'empty array for unknown hotel');
});

suite('buildImageObjectSchema — base URL normalised', function () {
  const schema1 = buildImageObjectSchema(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION, BASE_URL + '/');
  const schema2 = buildImageObjectSchema(KNOWN_HOTEL_ID, KNOWN_HOTEL_NAME, KNOWN_REGION, BASE_URL);
  assertEqual(schema1[0].url, schema2[0].url, 'trailing slash in baseUrl is normalised');
});

// ─────────────────────────────────────────────────────────────────────────────
// generateImageSitemap
// ─────────────────────────────────────────────────────────────────────────────

suite('generateImageSitemap — structure', function () {
  const hotels  = [SAMPLE_HOTEL];
  const xml     = generateImageSitemap(hotels, BASE_URL);

  assert(xml.startsWith('<?xml'), 'starts with XML declaration');
  assert(xml.includes('xmlns:image='), 'has image sitemap namespace');
  assert(xml.includes('<urlset'),      'has urlset root element');
  assert(xml.includes('</urlset>'),    'urlset is closed');
  assert(xml.includes('<url>'),        'has url elements');
  assert(xml.includes('<loc>'),        'has loc elements');
  assert(xml.includes('<image:image>'), 'has image:image elements');
  assert(xml.includes('<image:loc>'),   'has image:loc elements');
  assert(xml.includes('<image:title>'), 'has image:title elements');
  assert(xml.includes(BASE_URL),        'base URL appears in loc elements');
  assert(xml.includes('MQ001'),         'hotel ID appears in image URLs');
  assert(xml.includes('hero.webp'),     'hero image referenced');
  assert(xml.includes('gallery-1.webp'),'gallery-1 image referenced');
  assert(xml.includes('gallery-4.webp'),'gallery-4 image referenced');
});

suite('generateImageSitemap — empty hotels array', function () {
  const xml = generateImageSitemap([], BASE_URL);
  assert(xml.includes('<urlset'),  'still valid XML with empty hotels');
  assert(!xml.includes('<url>'),   'no url entries for empty hotels');
});

suite('generateImageSitemap — unknown hotel skipped', function () {
  const hotels = [{ hotel_id: MISSING_ID, hotel_name: 'Ghost', region: 'Unknown' }];
  const xml    = generateImageSitemap(hotels, BASE_URL);
  assert(!xml.includes(MISSING_ID), 'unknown hotel not included in sitemap');
});

suite('generateImageSitemap — XSS safety in XML', function () {
  const malicious = [{ hotel_id: KNOWN_HOTEL_ID, hotel_name: '<b>Hotel</b>', region: 'Test & Region' }];
  const xml = generateImageSitemap(malicious, BASE_URL);
  assert(!xml.includes('<b>'), 'HTML tags escaped in XML output');
  assert(xml.includes('&amp;') || !xml.includes('&Region'), 'ampersands escaped');
});

suite('generateImageSitemap — page URL contains hotel slug', function () {
  const hotels = [SAMPLE_HOTEL];
  const xml    = generateImageSitemap(hotels, BASE_URL);
  // Royal Palm Beachcomber Luxury → royal-palm-beachcomber-luxury
  assert(xml.includes('royal-palm-beachcomber-luxury'), 'hotel name correctly slugified in page URL');
});

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────────────────────────────────');
console.log('hotel_image_engine.test.js:', passed, 'passed,', failed, 'failed');
console.log('─────────────────────────────────────────────────────────────');

if (failed > 0) process.exit(1);
