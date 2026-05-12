/**
 * animations.js — Mauritius Resort Finder
 * Scroll reveal, parallax hero, animated score bars, counter animations
 * v2.0 — Luxury UI upgrade
 */

(function () {
  'use strict';

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Scroll Reveal ─────────────────────────────────────────────────── */
  function initReveal() {
    if (REDUCED_MOTION) {
      // Immediately show all reveal elements
      document.querySelectorAll('.reveal, .stagger-children').forEach(el => {
        el.classList.add('is-visible');
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
    );

    document.querySelectorAll('.reveal, .stagger-children').forEach(el => {
      observer.observe(el);
    });
  }

  /* ── Parallax Hero ─────────────────────────────────────────────────── */
  function initParallax() {
    const heroBg = document.querySelector('.hero--parallax .hero__bg');
    if (!heroBg || REDUCED_MOTION) return;

    let ticking = false;

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          // Only apply while hero is in view
          if (scrollY < window.innerHeight * 1.5) {
            heroBg.style.transform = `translateY(${scrollY * 0.3}px)`;
          }
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ── Animated Score Bars ───────────────────────────────────────────── */
  function initScoreBars() {
    const bars = document.querySelectorAll('.score-bar');
    if (!bars.length) return;

    // Store target widths before resetting to 0
    bars.forEach(bar => {
      const fill = bar.querySelector('.score-bar__fill');
      if (!fill) return;
      const originalWidth = fill.style.width || '0%';
      fill.dataset.targetWidth = originalWidth;
      if (!REDUCED_MOTION) fill.style.width = '0%';
    });

    if (REDUCED_MOTION) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const fill = entry.target.querySelector('.score-bar__fill');
            if (fill && fill.dataset.targetWidth) {
              setTimeout(() => {
                fill.style.width = fill.dataset.targetWidth;
              }, 200);
            }
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );

    bars.forEach(bar => observer.observe(bar));
  }

  /* ── Hero Entrance Animation ───────────────────────────────────────── */
  function initHeroAnimation() {
    if (REDUCED_MOTION) return;

    const timings = [
      ['.hero__eyebrow',  0],
      ['.hero__title',    120],
      ['.hero__subtitle', 280],
      ['.hero__actions',  440],
    ];

    timings.forEach(([selector, delay]) => {
      const el = document.querySelector(selector);
      if (!el) return;
      // Hero elements start invisible via CSS transform
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = `opacity 0.7s ease, transform 0.7s ease`;
      setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, delay);
    });
  }

  /* ── Counter Animation ─────────────────────────────────────────────── */
  function animateCounter(el, rawTarget, suffix, isDecimal, duration) {
    const start = performance.now();

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function tick(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const ease     = easeOutCubic(progress);
      const current  = rawTarget * ease;

      el.textContent = (isDecimal ? current.toFixed(1) : Math.floor(current)) + suffix;

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function initCounters() {
    const counters = document.querySelectorAll('.trust-stat__value');
    if (!counters.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el      = entry.target;
          const text    = el.dataset.count || el.textContent.trim();
          // Store original so we can re-parse
          el.dataset.count = text;

          const isDecimal = text.includes('.');
          const suffix    = text.replace(/[\d,.]/g, '');
          const raw       = parseFloat(text.replace(/[^0-9.]/g, ''));

          if (!isNaN(raw) && !REDUCED_MOTION) {
            animateCounter(el, raw, suffix, isDecimal, 1800);
          }
          observer.unobserve(el);
        });
      },
      { threshold: 0.6 }
    );

    counters.forEach(el => observer.observe(el));
  }

  /* ── Hotel Card Stagger on scroll ──────────────────────────────────── */
  function initCardStagger() {
    if (REDUCED_MOTION) return;
    const cards = document.querySelectorAll('.hotel-card');
    cards.forEach((card, i) => {
      card.style.transitionDelay = `${i * 0.06}s`;
    });
  }

  /* ── Init ──────────────────────────────────────────────────────────── */
  function init() {
    initHeroAnimation();
    initReveal();
    initParallax();
    initScoreBars();
    initCounters();
    initCardStagger();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
