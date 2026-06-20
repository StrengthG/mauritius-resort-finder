/* hotel-gallery.js — Photo Mosaic, Lightbox, keyboard nav, touch swipe
   CSP safe: no inline scripts, loaded as external file with defer.           */
(function () {
  'use strict';

  // ── Lightbox state ─────────────────────────────────────────────────────────
  var lb      = null;
  var slides  = [];
  var current = 0;
  var touchStartX = 0;

  // ── Build lightbox DOM (once) ──────────────────────────────────────────────
  function buildLightbox() {
    var el = document.createElement('div');
    el.className = 'hotel-lightbox';
    el.id = 'hotel-lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Photo gallery');
    el.innerHTML =
      '<div class="hotel-lightbox__stage">' +
        '<button class="hotel-lightbox__close" type="button" aria-label="Close gallery">×</button>' +
        '<button class="hotel-lightbox__prev"  type="button" aria-label="Previous image">‹</button>' +
        '<button class="hotel-lightbox__next"  type="button" aria-label="Next image">›</button>' +
        '<div class="hotel-lightbox__frame"></div>' +
        '<p class="hotel-lightbox__caption"></p>' +
        '<p class="hotel-lightbox__counter"></p>' +
        '<div class="hotel-lightbox__thumbs"></div>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('.hotel-lightbox__close').addEventListener('click', closeLightbox);
    el.querySelector('.hotel-lightbox__prev').addEventListener('click', function () { showSlide(current - 1); });
    el.querySelector('.hotel-lightbox__next').addEventListener('click', function () { showSlide(current + 1); });
    el.addEventListener('click', function (e) { if (e.target === el) closeLightbox(); });

    return el;
  }

  function getLightbox() {
    if (!lb) lb = document.getElementById('hotel-lightbox') || buildLightbox();
    return lb;
  }

  // ── Slide extraction ───────────────────────────────────────────────────────

  function extractSlidesFromMosaic(mosaic) {
    return Array.from(mosaic.querySelectorAll('.hotel-mosaic__cell')).map(function (cell) {
      var img = cell.querySelector('.hotel-img__real');
      var fig = cell.querySelector('.hotel-img');
      var cap = cell.querySelector('.hotel-mosaic__caption');
      return {
        figNode: fig ? fig.cloneNode(true) : null,
        src:     img ? (img.currentSrc || img.src) : null,
        alt:     img ? img.alt : '',
        caption: cap ? cap.textContent.trim() : '',
      };
    });
  }

  function extractSlidesFromStrip(strip) {
    return Array.from(strip.querySelectorAll('.gallery-strip__btn')).map(function (btn) {
      var img = btn.querySelector('.hotel-img__real');
      var fig = btn.querySelector('.hotel-img');
      var cap = btn.querySelector('.gallery-strip__caption');
      return {
        figNode: fig ? fig.cloneNode(true) : null,
        src:     img ? (img.currentSrc || img.src) : null,
        alt:     img ? img.alt : '',
        caption: cap ? cap.textContent.trim() : '',
      };
    });
  }

  // ── Render one slide into the lightbox frame ───────────────────────────────
  function showSlide(index) {
    current = ((index % slides.length) + slides.length) % slides.length;
    var dialog  = getLightbox();
    var frame   = dialog.querySelector('.hotel-lightbox__frame');
    var caption = dialog.querySelector('.hotel-lightbox__caption');
    var counter = dialog.querySelector('.hotel-lightbox__counter');

    frame.innerHTML = '';
    var slide = slides[current];

    if (slide.src) {
      var fig = document.createElement('figure');
      fig.className = 'hotel-img hotel-img--gallery';
      var img = document.createElement('img');
      img.src       = slide.src;
      img.alt       = slide.alt;
      img.className = 'hotel-img__real';
      img.width     = 800;
      img.height    = 600;
      fig.appendChild(img);
      frame.appendChild(fig);
    } else if (slide.figNode) {
      frame.appendChild(slide.figNode.cloneNode(true));
    }

    caption.textContent = slide.caption;
    counter.textContent = (current + 1) + ' / ' + slides.length;

    var thumbBtns = dialog.querySelectorAll('.hotel-lightbox__thumb-btn');
    for (var i = 0; i < thumbBtns.length; i++) {
      thumbBtns[i].classList.toggle('is-active', i === current);
    }
  }

  // ── Build lightbox thumbnail strip ─────────────────────────────────────────
  function buildThumbs() {
    var dialog = getLightbox();
    var thumbs = dialog.querySelector('.hotel-lightbox__thumbs');
    thumbs.innerHTML = '';
    slides.forEach(function (slide, i) {
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'hotel-lightbox__thumb-btn' + (i === current ? ' is-active' : '');
      btn.setAttribute('aria-label', 'View photo ' + (i + 1));

      if (slide.src) {
        var img = document.createElement('img');
        img.src    = slide.src;
        img.alt    = '';
        img.width  = 58;
        img.height = 44;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        btn.appendChild(img);
      } else if (slide.figNode) {
        var clone = slide.figNode.cloneNode(true);
        clone.style.cssText = 'width:100%;height:100%';
        btn.appendChild(clone);
      }

      btn.addEventListener('click', (function (idx) {
        return function () { showSlide(idx); };
      }(i)));

      thumbs.appendChild(btn);
    });
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  function openLightbox(container, index) {
    slides = container.classList.contains('hotel-mosaic')
      ? extractSlidesFromMosaic(container)
      : extractSlidesFromStrip(container);

    if (!slides.length) return;

    var dialog = getLightbox();
    buildThumbs();
    showSlide(index);
    dialog.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    dialog._returnFocus = document.activeElement;
    var closeBtn = dialog.querySelector('.hotel-lightbox__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeLightbox() {
    var dialog = getLightbox();
    dialog.classList.remove('is-open');
    document.body.style.overflow = '';
    var ret = dialog._returnFocus;
    if (ret && typeof ret.focus === 'function') ret.focus();
    slides  = [];
    current = 0;
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    var dialog = document.getElementById('hotel-lightbox');
    if (!dialog || !dialog.classList.contains('is-open')) return;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    { e.preventDefault(); showSlide(current - 1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); showSlide(current + 1); }
    else if (e.key === 'Escape') closeLightbox();
  });

  // ── Touch swipe ────────────────────────────────────────────────────────────
  document.addEventListener('touchstart', function (e) {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    var dialog = document.getElementById('hotel-lightbox');
    if (!dialog || !dialog.classList.contains('is-open')) return;
    var dx = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(dx) < 40) return;
    showSlide(dx < 0 ? current + 1 : current - 1);
  }, { passive: true });

  // ── Wire mosaic ────────────────────────────────────────────────────────────
  function wireMosaic(mosaic) {
    mosaic.querySelectorAll('.hotel-mosaic__cell').forEach(function (cell) {
      cell.addEventListener('click', function () {
        var idx = parseInt(this.dataset.galleryIndex || '0', 10);
        openLightbox(mosaic, idx);
      });
    });
  }

  // ── Wire legacy gallery strip ──────────────────────────────────────────────
  function wireStrip(strip) {
    strip.querySelectorAll('.gallery-strip__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(this.dataset.galleryIndex || '0', 10);
        openLightbox(strip, idx);
      });
    });
  }

  // ── IntersectionObserver: gradient shimmer when in view ───────────────────
  function observePlaceholders() {
    if (!('IntersectionObserver' in window)) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('hotel-img--in-view', entry.isIntersecting);
      });
    }, { rootMargin: '200px' });
    document.querySelectorAll('.hotel-img--placeholder').forEach(function (el) {
      obs.observe(el);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    getLightbox();
    document.querySelectorAll('.hotel-mosaic').forEach(wireMosaic);
    document.querySelectorAll('.gallery-strip').forEach(wireStrip);
    observePlaceholders();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
