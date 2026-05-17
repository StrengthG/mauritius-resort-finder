/**
 * ambient-visuals.js — Mauritius Resort Finder
 * Hero Ken Burns slideshow. Respects prefers-reduced-motion.
 */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var KB_ANIMS = [
    'kb-zoom-out  7.8s ease-in-out both',
    'kb-pan-right 7.8s ease-in-out both',
    'kb-zoom-in   7.8s ease-in-out both',
    'kb-pan-left  7.8s ease-in-out both',
  ];

  /* ── Hero Ken Burns Slideshow ──────────────────────────────────────────── */
  function initHeroSlideshow() {
    var slides = Array.prototype.slice.call(document.querySelectorAll('.hero__slide'));
    if (!slides.length) return;

    slides[0].style.opacity = '1';
    if (!REDUCED) applyKenBurns(slides[0], 0);

    if (REDUCED) return;

    var current = 0;
    var INTERVAL = 6000;

    setInterval(function () {
      var prev = current;
      current = (current + 1) % slides.length;

      slides[prev].style.opacity = '0';

      var next = slides[current];
      next.style.opacity = '1';
      applyKenBurns(next, current);
    }, INTERVAL);
  }

  /* Force CSS animation restart — remove, flush, reapply */
  function applyKenBurns(el, index) {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = KB_ANIMS[index % KB_ANIMS.length];
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeroSlideshow);
  } else {
    initHeroSlideshow();
  }

}());
