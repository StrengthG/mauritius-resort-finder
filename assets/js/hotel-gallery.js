/* hotel-gallery.js — Luxury Gallery: lightbox, mobile carousel, keyboard + touch nav
   CSP safe: no inline scripts. Loaded with defer on all hotel detail pages.   */
(function () {
  'use strict';

  /* ── Lightbox state ──────────────────────────────────────────────────────── */
  var lb        = null;
  var slides    = [];   // [{src, alt, caption}]
  var current   = 0;
  var touchSX   = 0;
  var touchSY   = 0;

  /* ── Build lightbox DOM (once, lazily) ───────────────────────────────────── */
  function buildLightbox() {
    var el = document.createElement('div');
    el.className   = 'hg-lb';
    el.id          = 'hg-lb';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Photo gallery');
    el.innerHTML =
      '<div class="hg-lb__stage">' +
        '<button class="hg-lb__close" type="button" aria-label="Close gallery">×</button>' +
        '<button class="hg-lb__prev"  type="button" aria-label="Previous photo">‹</button>' +
        '<button class="hg-lb__next"  type="button" aria-label="Next photo">›</button>' +
        '<div class="hg-lb__frame"></div>' +
        '<p class="hg-lb__caption"></p>' +
        '<p class="hg-lb__counter"></p>' +
        '<div class="hg-lb__thumbs"></div>' +
      '</div>';

    el.querySelector('.hg-lb__close').addEventListener('click', closeLb);
    el.querySelector('.hg-lb__prev').addEventListener('click', function () { goTo(current - 1); });
    el.querySelector('.hg-lb__next').addEventListener('click', function () { goTo(current + 1); });
    el.addEventListener('click', function (e) { if (e.target === el) closeLb(); });

    document.body.appendChild(el);
    return el;
  }

  function getLb() {
    if (!lb) lb = document.getElementById('hg-lb') || buildLightbox();
    return lb;
  }

  /* ── Extract slides from a gallery (.hg) ─────────────────────────────────── */
  function extractSlides(gallery) {
    var results = [];
    /* Hero */
    var hero = gallery.querySelector('.hg__hero');
    if (hero) {
      var img = hero.querySelector('.hg-img__pic');
      var cap = hero.querySelector('.hg-caption');
      if (img) results.push({ src: img.currentSrc || img.src, alt: img.alt, caption: cap ? cap.textContent.trim() : '' });
    }
    /* Thumbnails */
    var cells = gallery.querySelectorAll('.hg__cell');
    for (var i = 0; i < cells.length; i++) {
      var cellImg = cells[i].querySelector('.hg-img__pic');
      if (cellImg) results.push({ src: cellImg.currentSrc || cellImg.src, alt: cellImg.alt, caption: '' });
    }
    return results;
  }

  /* ── Render one slide into the lightbox frame ────────────────────────────── */
  function goTo(index) {
    if (!slides.length) return;
    current = ((index % slides.length) + slides.length) % slides.length;
    var dialog  = getLb();
    var frame   = dialog.querySelector('.hg-lb__frame');
    var caption = dialog.querySelector('.hg-lb__caption');
    var counter = dialog.querySelector('.hg-lb__counter');

    frame.innerHTML = '';

    var slide = slides[current];
    var img   = document.createElement('img');
    img.src    = slide.src;
    img.alt    = slide.alt;
    img.width  = 980;
    img.height = 735;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    frame.appendChild(img);

    caption.textContent = slide.caption;
    counter.textContent = (current + 1) + ' • ' + slides.length;

    /* Update thumb active state */
    var thumbs = dialog.querySelectorAll('.hg-lb__thumb');
    for (var t = 0; t < thumbs.length; t++) {
      thumbs[t].classList.toggle('is-active', t === current);
    }
  }

  /* ── Build thumbnail strip ───────────────────────────────────────────────── */
  function buildThumbs() {
    var dialog = getLb();
    var strip  = dialog.querySelector('.hg-lb__thumbs');
    strip.innerHTML = '';
    slides.forEach(function (slide, i) {
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'hg-lb__thumb' + (i === current ? ' is-active' : '');
      btn.setAttribute('aria-label', 'View photo ' + (i + 1));

      var img = document.createElement('img');
      img.src    = slide.src;
      img.alt    = '';
      img.width  = 60;
      img.height = 46;
      img.loading = 'lazy';
      btn.appendChild(img);

      btn.addEventListener('click', (function (idx) {
        return function () { goTo(idx); };
      }(i)));

      strip.appendChild(btn);
    });
  }

  /* ── Open / close ────────────────────────────────────────────────────────── */
  function openLb(gallery, startIndex) {
    slides = extractSlides(gallery);
    if (!slides.length) return;
    current = Math.min(startIndex, slides.length - 1);

    var dialog = getLb();
    buildThumbs();
    goTo(current);
    dialog.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    dialog._returnFocus = document.activeElement;
    var closeBtn = dialog.querySelector('.hg-lb__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeLb() {
    var dialog = getLb();
    dialog.classList.remove('is-open');
    document.body.style.overflow = '';
    var ret = dialog._returnFocus;
    if (ret && typeof ret.focus === 'function') ret.focus();
    slides  = [];
    current = 0;
  }

  /* ── Keyboard navigation ─────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    var dialog = document.getElementById('hg-lb');
    if (!dialog || !dialog.classList.contains('is-open')) return;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); goTo(current - 1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goTo(current + 1); }
    else if (e.key === 'Escape') closeLb();
  });

  /* ── Touch swipe (lightbox) ──────────────────────────────────────────────── */
  document.addEventListener('touchstart', function (e) {
    touchSX = e.changedTouches[0].screenX;
    touchSY = e.changedTouches[0].screenY;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    var dialog = document.getElementById('hg-lb');
    if (!dialog || !dialog.classList.contains('is-open')) return;
    var dx = e.changedTouches[0].screenX - touchSX;
    var dy = e.changedTouches[0].screenY - touchSY;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return; // vertical swipe — ignore
    goTo(dx < 0 ? current + 1 : current - 1);
  }, { passive: true });

  /* ── Wire a single gallery (.hg) ────────────────────────────────────────── */
  function wireGallery(gallery) {
    /* Clicking hero or any cell opens lightbox at that image's index */
    var hero = gallery.querySelector('.hg__hero');
    if (hero) {
      hero.addEventListener('click', function () { openLb(gallery, 0); });
    }

    var cells = gallery.querySelectorAll('.hg__cell');
    for (var i = 0; i < cells.length; i++) {
      (function (cell, idx) {
        cell.addEventListener('click', function () { openLb(gallery, idx + 1); });
      }(cells[i], i));
    }

    /* "Show all photos" floating button */
    var showAll = gallery.querySelector('.hg__show-all');
    if (showAll) {
      showAll.addEventListener('click', function () { openLb(gallery, 0); });
    }

    /* Mobile: add progress dots and sync to scroll position */
    addMobileDots(gallery);
  }

  /* ── Mobile carousel progress dots ──────────────────────────────────────── */
  function addMobileDots(gallery) {
    /* Only wire if we're actually in flex/carousel mode */
    if (window.innerWidth > 860) return;

    var items = [gallery.querySelector('.hg__hero')].concat(
      Array.from(gallery.querySelectorAll('.hg__cell'))
    ).filter(Boolean);

    if (items.length < 2) return;

    /* Build dots bar below the gallery */
    var dotsEl = document.createElement('div');
    dotsEl.className = 'hg-dots';
    dotsEl.setAttribute('aria-hidden', 'true');
    items.forEach(function (_, i) {
      var dot = document.createElement('span');
      dot.className = 'hg-dots__dot' + (i === 0 ? ' is-active' : '');
      dotsEl.appendChild(dot);
    });

    /* Insert after gallery */
    if (gallery.nextSibling) {
      gallery.parentNode.insertBefore(dotsEl, gallery.nextSibling);
    } else {
      gallery.parentNode.appendChild(dotsEl);
    }

    /* Update dots on scroll */
    var dots = dotsEl.querySelectorAll('.hg-dots__dot');
    var ticking = false;

    gallery.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        var scrollLeft = gallery.scrollLeft;
        var width      = gallery.offsetWidth;
        if (!width) return;
        var idx = Math.round(scrollLeft / (width * 0.86));
        idx = Math.max(0, Math.min(idx, dots.length - 1));
        for (var d = 0; d < dots.length; d++) {
          dots[d].classList.toggle('is-active', d === idx);
        }
      });
    }, { passive: true });
  }

  /* ── IntersectionObserver: observe placeholder shimmer ───────────────────── */
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

  /* ── Init ────────────────────────────────────────────────────────────────── */
  function init() {
    getLb(); // build lightbox DOM early (avoids layout jank on first open)
    document.querySelectorAll('.hg').forEach(wireGallery);
    observePlaceholders();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
