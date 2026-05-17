/**
 * ambient-visuals.js — Mauritius Resort Finder
 * Cinematic ambient image layer: hero Ken Burns slideshow, ambient strip
 * parallax, floating panel scroll-reveals.
 * Performance: RAF-batched scroll, IntersectionObserver, no continuous loops.
 */
(function () {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Hero Ken Burns Slideshow ──────────────────────────────────────────── */
  function initHeroSlideshow() {
    const slides = document.querySelectorAll('.hero__slide');
    if (!slides.length) return;

    // Immediately show first slide (no JS required for initial state)
    slides[0].classList.add('is-active');

    if (REDUCED) return;

    let current = 0;
    const INTERVAL = 6000; // ms per slide

    function advance() {
      const prev = current;
      current = (current + 1) % slides.length;

      // Outgoing: remove active (opacity transitions to 0 via CSS)
      slides[prev].classList.remove('is-active');

      // Incoming: add active (opacity transitions to 1, Ken Burns starts)
      slides[current].classList.add('is-active');

      // Force animation restart by toggling a data attribute
      slides[current].dataset.kbTick = (slides[current].dataset.kbTick | 0) + 1;
    }

    setInterval(advance, INTERVAL);
  }

  /* ── Ambient Strip Parallax ────────────────────────────────────────────── */
  function initAmbientParallax() {
    const strips = document.querySelectorAll('.ambient-strip');
    if (!strips.length || REDUCED) return;

    let ticking = false;

    function update() {
      strips.forEach(function (strip) {
        const img = strip.querySelector('.ambient-strip__img');
        if (!img) return;

        const rect     = strip.getBoundingClientRect();
        const inView   = rect.bottom > -50 && rect.top < window.innerHeight + 50;
        if (!inView) return;

        // progress 0 (strip entering from bottom) → 1 (strip leaving top)
        const progress  = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
        const translateY = (progress - 0.5) * 72; // ±36px range
        img.style.transform = 'translateY(' + translateY.toFixed(2) + 'px) scale(1.14)';
      });
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });

    // Run once on load
    update();
  }

  /* ── Floating Panel Scroll Reveals ────────────────────────────────────── */
  function initFloatingPanels() {
    const panels = document.querySelectorAll('.ambient-panel');
    if (!panels.length) return;

    if (REDUCED) {
      panels.forEach(function (p) { p.classList.add('is-visible'); });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });

    panels.forEach(function (p) { observer.observe(p); });
  }

  /* ── Ambient Strip Reveal (fade in when scrolled into view) ───────────── */
  function initStripReveal() {
    const strips = document.querySelectorAll('.ambient-strip');
    if (!strips.length || REDUCED) {
      strips.forEach(function (s) { s.classList.add('is-visible'); });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05 });

    strips.forEach(function (s) { observer.observe(s); });
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  function init() {
    initHeroSlideshow();
    initAmbientParallax();
    initFloatingPanels();
    initStripReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
