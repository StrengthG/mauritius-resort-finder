/* Mauritius Resort Finder — Theme Manager (supplementary)
   The core toggle is defined inline in <head> via window.mrfToggle.
   This script handles aria-label sync and OS preference watching. */
(function () {
  'use strict';

  var KEY = 'mrf-theme';

  function syncLabels(theme) {
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute(
        'aria-label',
        theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
      );
    });
  }

  /* Sync button labels to current theme */
  syncLabels(document.documentElement.getAttribute('data-theme') || 'dark');

  /* Re-sync after toggle via MutationObserver on <html> data-theme */
  try {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'data-theme') {
          syncLabels(document.documentElement.getAttribute('data-theme') || 'dark');
        }
      });
    }).observe(document.documentElement, { attributes: true });
  } catch (_) {}

  /* Respond to OS preference changes only when user has no stored choice */
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
      if (!localStorage.getItem(KEY) && window.mrfToggle) {
        var want = e.matches ? 'light' : 'dark';
        if (document.documentElement.getAttribute('data-theme') !== want) window.mrfToggle();
      }
    });
  } catch (_) {}
}());
