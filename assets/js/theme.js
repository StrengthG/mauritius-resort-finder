/* Mauritius Resort Finder — Theme Manager
   Handles dark/light toggle, localStorage persistence, OS preference sync. */
(function () {
  'use strict';

  var KEY = 'mrf-theme';
  var html = document.documentElement;

  function preferred() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  function save(theme) {
    try { localStorage.setItem(KEY, theme); } catch (_) {}
  }

  function apply(theme) {
    html.setAttribute('data-theme', theme);
    /* Update every toggle button on the page */
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute(
        'aria-label',
        theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
      );
    });
  }

  function toggle() {
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    save(next);
    apply(next);
  }

  /* Init — anti-FOUC already done by inline script; this just syncs button state */
  apply(stored() || preferred());

  /* Click delegation — handles desktop + mobile toggle buttons */
  document.addEventListener('click', function (e) {
    if (e.target.closest('.theme-toggle')) {
      toggle();
      /* Tactile press feedback */
      var btn = e.target.closest('.theme-toggle');
      btn.classList.add('theme-toggle--pressed');
      setTimeout(function () { btn.classList.remove('theme-toggle--pressed'); }, 200);
    }
  });

  /* Keyboard: Space / Enter already fire click on <button>; no extra handling needed */

  /* Respond to OS preference changes only when user has no stored choice */
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
      if (!stored()) apply(e.matches ? 'light' : 'dark');
    });
  } catch (_) {}

  window.__mrfTheme = { toggle: toggle, get: function () { return html.getAttribute('data-theme'); } };
}());
