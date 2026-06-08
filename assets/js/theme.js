/* Mauritius Resort Finder — Theme Manager (supplementary)
   The core toggle is defined inline in <head> via window.mrfToggle.
   This script syncs aria-label / aria-pressed on all .theme-toggle buttons
   and watches OS preference changes when the user has no stored choice. */
(function () {
  'use strict';

  var KEY = 'mrf-theme';

  function syncButtons(theme) {
    var isDark = theme === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    });
  }

  syncButtons(document.documentElement.getAttribute('data-theme') || 'light');

  try {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'data-theme') {
          syncButtons(document.documentElement.getAttribute('data-theme') || 'light');
        }
      });
    }).observe(document.documentElement, { attributes: true });
  } catch (_) {}

  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!localStorage.getItem(KEY) && window.mrfToggle) {
        var want = e.matches ? 'dark' : 'light';
        if (document.documentElement.getAttribute('data-theme') !== want) window.mrfToggle();
      }
    });
  } catch (_) {}
}());
