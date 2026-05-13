/**
 * interactions.js — Mauritius Resort Finder
 * Sticky nav, mobile menu, keyboard accessibility
 * v2.0 — Luxury UI upgrade
 */

(function () {
  'use strict';

  /* ── Sticky Nav ────────────────────────────────────────────────────── */
  function initStickyNav() {
    const nav = document.querySelector('.nav');
    if (!nav) return;

    let lastScrollY = window.scrollY;
    let ticking     = false;

    function updateNav() {
      const scrollY = window.scrollY;

      // Solid background when past 60px
      nav.classList.toggle('nav--scrolled', scrollY > 60);

      // Hide on scroll-down, reveal on scroll-up (only past 320px)
      if (scrollY > 320) {
        if (scrollY > lastScrollY + 6) {
          nav.style.transform = 'translateY(-100%)';
        } else if (scrollY < lastScrollY - 6) {
          nav.style.transform = 'translateY(0)';
        }
      } else {
        nav.style.transform = 'translateY(0)';
      }

      lastScrollY = scrollY;
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(updateNav);
        ticking = true;
      }
    }, { passive: true });

    // Initial state
    updateNav();
  }

  /* ── Mobile Menu ───────────────────────────────────────────────────── */
  function initMobileMenu() {
    const hamburger  = document.querySelector('.nav__hamburger');
    const mobileMenu = document.querySelector('.nav__mobile-menu');
    if (!hamburger || !mobileMenu) return;

    let isOpen = false;

    function openMenu() {
      isOpen = true;
      hamburger.classList.add('is-open');
      mobileMenu.classList.add('is-open');
      hamburger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      // Focus first link for accessibility
      const firstLink = mobileMenu.querySelector('a');
      if (firstLink) setTimeout(() => firstLink.focus(), 100);
    }

    function closeMenu() {
      isOpen = false;
      hamburger.classList.remove('is-open');
      mobileMenu.classList.remove('is-open');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', () => {
      isOpen ? closeMenu() : openMenu();
    });

    // Close when a menu link is clicked
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeMenu);
    });

    // Close on Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) {
        closeMenu();
        hamburger.focus();
      }
    });

    // Close when clicking outside the nav
    document.addEventListener('click', e => {
      if (isOpen && !nav.contains(e.target) && !mobileMenu.contains(e.target)) {
        closeMenu();
      }
    });
  }

  /* ── Smooth active nav links ───────────────────────────────────────── */
  function initActiveNavLinks() {
    const sections = document.querySelectorAll('section[id], div[id]');
    const navLinks = document.querySelectorAll('.nav__links a[href^="#"]');
    if (!sections.length || !navLinks.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            navLinks.forEach(link => link.classList.remove('is-active'));
            const activeLink = document.querySelector(`.nav__links a[href="#${entry.target.id}"]`);
            if (activeLink) activeLink.classList.add('is-active');
          }
        });
      },
      { threshold: 0.4, rootMargin: '-72px 0px 0px 0px' }
    );

    sections.forEach(section => observer.observe(section));
  }

  /* ── Skip link ─────────────────────────────────────────────────────── */
  function initSkipLink() {
    const skip = document.querySelector('.skip-link');
    if (!skip) return;
    skip.addEventListener('click', e => {
      e.preventDefault();
      const target = document.querySelector(skip.getAttribute('href'));
      if (target) {
        target.setAttribute('tabindex', '-1');
        target.focus();
      }
    });
  }

  /* ── Obfuscated Contact Links ──────────────────────────────────────── */
  // Email is never stored in HTML — assembled at runtime to prevent scraping
  function initContactLinks() {
    const links = document.querySelectorAll('.js-contact');
    if (!links.length) return;
    // Parts joined at runtime — not a complete address in source
    const parts = ['strengthygiven', 'ncube', '@', 'gmail', '.com'];
    const addr  = parts.join('');
    links.forEach(function (el) {
      el.setAttribute('href', 'mailto:' + addr);
      el.removeAttribute('aria-label');
    });
  }

  /* ── Reading Progress Bar ──────────────────────────────────────────── */
  function initProgressBar() {
    const bar = document.getElementById('progress-bar');
    if (!bar) return;

    let ticking = false;

    function update() {
      const scrollTop  = window.scrollY;
      const docHeight  = document.documentElement.scrollHeight - window.innerHeight;
      const progress   = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      bar.style.width  = Math.min(progress, 100) + '%';
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
  }

  /* ── Back to Top ───────────────────────────────────────────────────── */
  function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    let ticking = false;

    function toggleVisibility() {
      btn.classList.toggle('is-visible', window.scrollY > 600);
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(toggleVisibility); ticking = true; }
    }, { passive: true });

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Init ──────────────────────────────────────────────────────────── */
  const nav = document.querySelector('.nav');

  function init() {
    initStickyNav();
    initMobileMenu();
    initActiveNavLinks();
    initSkipLink();
    initContactLinks();
    initProgressBar();
    initBackToTop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
