/**
 * ambient-visuals.js — Mauritius Resort Finder
 * Hero Ken Burns slideshow, ambient strip parallax, floating panel reveals.
 * All scroll work is RAF-batched. Respects prefers-reduced-motion.
 */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Ken Burns animation definitions — one per slide slot */
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

    /* Always show first slide, even without JS animation */
    slides[0].style.opacity = '1';
    if (!REDUCED) applyKenBurns(slides[0], 0);

    if (REDUCED) return;

    var current = 0;
    var INTERVAL = 6000; /* ms each slide is shown */

    setInterval(function () {
      var prev = current;
      current = (current + 1) % slides.length;

      /* Fade out previous */
      slides[prev].style.opacity = '0';

      /* Fade in next with Ken Burns restart */
      var next = slides[current];
      next.style.opacity = '1';
      applyKenBurns(next, current);
    }, INTERVAL);
  }

  /* Force CSS animation restart — remove, flush, reapply */
  function applyKenBurns(el, index) {
    el.style.animation = 'none';
    void el.offsetWidth; /* trigger reflow to reset animation */
    el.style.animation = KB_ANIMS[index % KB_ANIMS.length];
  }

  /* ── Ambient Strip Parallax ────────────────────────────────────────────── */
  function initAmbientParallax() {
    var strips = document.querySelectorAll('.ambient-strip');
    if (!strips.length || REDUCED) return;

    var ticking = false;

    function update() {
      Array.prototype.forEach.call(strips, function (strip) {
        var img  = strip.querySelector('.ambient-strip__img');
        if (!img) return;
        var rect = strip.getBoundingClientRect();
        if (rect.bottom < -80 || rect.top > window.innerHeight + 80) return;
        var progress    = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
        var translateY  = (progress - 0.5) * 64;
        img.style.transform = 'translateY(' + translateY.toFixed(1) + 'px) scale(1.14)';
      });
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });

    update();
  }

  /* ── IntersectionObserver reveal helper ───────────────────────────────── */
  function initReveal(selector, threshold, rootMargin) {
    var els = document.querySelectorAll(selector);
    if (!els.length) return;

    if (REDUCED) {
      Array.prototype.forEach.call(els, function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: threshold || 0.08, rootMargin: rootMargin || '0px 0px -40px 0px' });

    Array.prototype.forEach.call(els, function (el) { observer.observe(el); });
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  function init() {
    initHeroSlideshow();
    initAmbientParallax();
    initReveal('.ambient-strip', 0.05);
    initReveal('.ambient-panel', 0.12, '0px 0px -48px 0px');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
