/* trending-widget.js — Resort Trending Widget (CSP-safe, zero inline events) */

(function () {
  'use strict';

  var DATA_URL = '/assets/data/trending.json';

  /* ── Helpers ─────────────────────────────────────────────────────────────── */

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function stars(n) {
    var out = '';
    for (var i = 0; i < 5; i++) out += (i < (n || 0)) ? '★' : '☆';
    return out;
  }

  function trackClick(hotelId, hotelName, position, listType) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'trending_click', {
        hotel_id:  hotelId,
        hotel_name: hotelName,
        position:  position,
        list_type: listType,
      });
    }
  }

  /* ── Card builders ───────────────────────────────────────────────────────── */

  function trendingCard(h, rank) {
    var score     = h.score || 0;
    var barWidth  = Math.max(score, 12);
    var scoreStr  = h.rating != null ? Number(h.rating).toFixed(1) + '/10' : '';
    var signalHtml = score >= 80
      ? '<span class="tw-card__signal tw-card__signal--hot">&#128293; Hot</span>'
      : '<span class="tw-card__signal">Trending</span>';

    return (
      '<a href="/hotels/' + esc(h.slug) + '/" class="tw-card"' +
        ' data-tw-click data-hotel-id="' + esc(h.hotel_id) + '"' +
        ' data-hotel-name="' + esc(h.name) + '"' +
        ' data-position="' + rank + '"' +
        ' data-list-type="trending">' +
        '<div class="tw-card__badge">' +
          '<span class="tw-card__rank">#' + rank + '</span>' +
          signalHtml +
        '</div>' +
        '<div class="tw-card__name">' + esc(h.name) + '</div>' +
        '<div class="tw-card__region">' + esc(h.region) + '</div>' +
        '<div class="tw-card__rating">' +
          (scoreStr ? '<span class="tw-card__score">' + esc(scoreStr) + '</span>' : '') +
          '<span class="tw-card__stars">' + stars(h.stars) + '</span>' +
        '</div>' +
        '<div class="tw-card__bar-wrap"><div class="tw-card__bar" style="width:' + barWidth + '%"></div></div>' +
      '</a>'
    );
  }

  function growingCard(h, rank) {
    var pct      = h.growth_pct || 0;
    var isNew    = pct >= 999;
    var label    = isNew ? 'New' : ('+' + pct + '%');
    var pillCls  = isNew ? 'tw-card__growth--new' : '';
    var scoreStr = h.rating != null ? Number(h.rating).toFixed(1) + '/10' : '';

    return (
      '<a href="/hotels/' + esc(h.slug) + '/" class="tw-card"' +
        ' data-tw-click data-hotel-id="' + esc(h.hotel_id) + '"' +
        ' data-hotel-name="' + esc(h.name) + '"' +
        ' data-position="' + rank + '"' +
        ' data-list-type="fastest_growing">' +
        '<div class="tw-card__badge">' +
          '<span class="tw-card__signal tw-card__signal--up">&#8593; Rising</span>' +
        '</div>' +
        '<div class="tw-card__name">' + esc(h.name) + '</div>' +
        '<div class="tw-card__region">' + esc(h.region) + '</div>' +
        '<div class="tw-card__rating">' +
          (scoreStr ? '<span class="tw-card__score">' + esc(scoreStr) + '</span>' : '') +
          '<span class="tw-card__stars">' + stars(h.stars) + '</span>' +
        '</div>' +
        '<span class="tw-card__growth ' + pillCls + '">' + esc(label) + ' this week</span>' +
      '</a>'
    );
  }

  function comparedCard(h, rank) {
    var count    = h.compare_count || 0;
    var scoreStr = h.rating != null ? Number(h.rating).toFixed(1) + '/10' : '';
    var label    = count > 0 ? count + ' comparisons' : 'Frequently compared';

    return (
      '<a href="/hotels/' + esc(h.slug) + '/" class="tw-card"' +
        ' data-tw-click data-hotel-id="' + esc(h.hotel_id) + '"' +
        ' data-hotel-name="' + esc(h.name) + '"' +
        ' data-position="' + rank + '"' +
        ' data-list-type="most_compared">' +
        '<div class="tw-card__badge">' +
          '<span class="tw-card__signal tw-card__signal--compare">&#8862; Compared</span>' +
        '</div>' +
        '<div class="tw-card__name">' + esc(h.name) + '</div>' +
        '<div class="tw-card__region">' + esc(h.region) + '</div>' +
        '<div class="tw-card__rating">' +
          (scoreStr ? '<span class="tw-card__score">' + esc(scoreStr) + '</span>' : '') +
          '<span class="tw-card__stars">' + stars(h.stars) + '</span>' +
        '</div>' +
        '<span class="tw-card__growth" style="background:#e0f2fe;color:#075985">' + esc(label) + '</span>' +
      '</a>'
    );
  }

  function savedCard(h, rank) {
    var count    = h.save_count || 0;
    var scoreStr = h.rating != null ? Number(h.rating).toFixed(1) + '/10' : '';
    var label    = count > 0 ? count + ' saves' : 'Popular pick';

    return (
      '<a href="/hotels/' + esc(h.slug) + '/" class="tw-card"' +
        ' data-tw-click data-hotel-id="' + esc(h.hotel_id) + '"' +
        ' data-hotel-name="' + esc(h.name) + '"' +
        ' data-position="' + rank + '"' +
        ' data-list-type="most_saved">' +
        '<div class="tw-card__badge">' +
          '<span class="tw-card__signal tw-card__signal--saved">&#9829; Saved</span>' +
        '</div>' +
        '<div class="tw-card__name">' + esc(h.name) + '</div>' +
        '<div class="tw-card__region">' + esc(h.region) + '</div>' +
        '<div class="tw-card__rating">' +
          (scoreStr ? '<span class="tw-card__score">' + esc(scoreStr) + '</span>' : '') +
          '<span class="tw-card__stars">' + stars(h.stars) + '</span>' +
        '</div>' +
        '<span class="tw-card__growth" style="background:#fdf4e8;color:#b8892e">' + esc(label) + '</span>' +
      '</a>'
    );
  }

  function track(h) {
    var scoreStr = h.score ? h.score + '/10' : '';

    return (
      '<a href="/hotels/' + esc(h.slug) + '/" class="tw-card"' +
        ' data-tw-click data-hotel-id="' + esc(h.hotel_id) + '"' +
        ' data-hotel-name="' + esc(h.name) + '"' +
        ' data-position="1"' +
        ' data-list-type="also_trending">' +
        '<div class="tw-card__name">' + esc(h.name) + '</div>' +
        '<div class="tw-card__region">' + esc(h.region) + '</div>' +
        '<div class="tw-card__rating">' +
          (h.rating ? '<span class="tw-card__score">' + Number(h.rating).toFixed(1) + '/10</span>' : '') +
        '</div>' +
      '</a>'
    );
  }

  /* ── Tab switching ───────────────────────────────────────────────────────── */

  function initTabs(container) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tw-tab]');
      if (!btn) return;

      var target = btn.dataset.twTab;
      container.querySelectorAll('[data-tw-tab]').forEach(function (t) {
        t.classList.toggle('active', t.dataset.twTab === target);
      });
      container.querySelectorAll('[data-tw-panel]').forEach(function (p) {
        p.style.display = p.dataset.twPanel === target ? '' : 'none';
      });
    });
  }

  /* ── Event delegation for tracking ──────────────────────────────────────── */

  function initTracking(root) {
    root.addEventListener('click', function (e) {
      var card = e.target.closest('[data-tw-click]');
      if (!card) return;
      trackClick(
        card.dataset.hotelId,
        card.dataset.hotelName,
        Number(card.dataset.position),
        card.dataset.listType
      );
    });
  }

  /* ── Homepage widget (4 tabs) ────────────────────────────────────────────── */

  function renderHome(container, data) {
    var trending = (data.trending        || []).slice(0, 6);
    var growing  = (data.fastest_growing || []).slice(0, 5);
    var compared = (data.most_compared   || []).slice(0, 5);
    var saved    = (data.most_saved      || []).slice(0, 5);

    var srcLabel = data.source === 'ga4_api'
      ? 'Updated from GA4'
      : data.source === 'cache' ? 'Updated daily' : 'Based on ratings';

    container.innerHTML = (
      '<section class="tw-section">' +
        '<div class="tw-inner">' +
          '<div class="tw-heading-row">' +
            '<div>' +
              '<div class="tw-eyebrow">' + esc(srcLabel) + '</div>' +
              '<h2 class="tw-title">What Travellers Are Exploring</h2>' +
            '</div>' +
            '<a href="/best-luxury-hotels-mauritius/" class="tw-view-all">See all 36 resorts &#8594;</a>' +
          '</div>' +
          '<div class="tw-tabs" role="tablist">' +
            '<button class="tw-tab active" role="tab" data-tw-tab="trending" aria-selected="true">&#128293; Trending</button>' +
            '<button class="tw-tab" role="tab" data-tw-tab="growing"  aria-selected="false">&#8593; Rising Fast</button>' +
            '<button class="tw-tab" role="tab" data-tw-tab="compared" aria-selected="false">&#8862; Most Compared</button>' +
            '<button class="tw-tab" role="tab" data-tw-tab="saved"    aria-selected="false">&#9829; Most Saved</button>' +
          '</div>' +
          '<div data-tw-panel="trending">' +
            '<div class="tw-track">' +
              trending.map(function (h, i) { return trendingCard(h, i + 1); }).join('') +
            '</div>' +
          '</div>' +
          '<div data-tw-panel="growing" style="display:none">' +
            '<div class="tw-track">' +
              (growing.length ? growing.map(function (h, i) { return growingCard(h, i + 1); }).join('') : '<div class="tw-empty">No growth data yet — check back tomorrow</div>') +
            '</div>' +
          '</div>' +
          '<div data-tw-panel="compared" style="display:none">' +
            '<div class="tw-track">' +
              (compared.length ? compared.map(function (h, i) { return comparedCard(h, i + 1); }).join('') : '<div class="tw-empty">No comparison data yet</div>') +
            '</div>' +
          '</div>' +
          '<div data-tw-panel="saved" style="display:none">' +
            '<div class="tw-track">' +
              (saved.length ? saved.map(function (h, i) { return savedCard(h, i + 1); }).join('') : '<div class="tw-empty">No wishlist data yet</div>') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );

    initTabs(container);
    initTracking(container);
  }

  /* ── Region widget (filtered by region) ─────────────────────────────────── */

  function renderRegion(container, data, region) {
    var regionStr = String(region || '').toLowerCase();
    var filtered  = (data.trending || []).filter(function (h) {
      return h.region && h.region.toLowerCase().includes(regionStr);
    }).slice(0, 4);

    if (!filtered.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = (
      '<section class="tw-section tw-section--alt">' +
        '<div class="tw-inner">' +
          '<div class="tw-heading-row">' +
            '<div>' +
              '<div class="tw-eyebrow">Trending Now</div>' +
              '<h2 class="tw-title">Popular in ' + esc(region) + '</h2>' +
            '</div>' +
          '</div>' +
          '<div class="tw-track">' +
            filtered.map(function (h, i) { return trendingCard(h, i + 1); }).join('') +
          '</div>' +
        '</div>' +
      '</section>'
    );

    initTracking(container);
  }

  /* ── Hotel detail widget ("Also Trending") ───────────────────────────────── */

  function renderHotel(container, data, excludeId) {
    var others = (data.trending || []).filter(function (h) {
      return h.hotel_id !== excludeId;
    }).slice(0, 4);

    if (!others.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = (
      '<div class="tw-strip">' +
        '<div class="tw-inner">' +
          '<div class="tw-eyebrow" style="margin-bottom:0.5rem">Also Trending</div>' +
          '<div class="tw-track">' +
            others.map(function (h, i) { return trendingCard(h, i + 1); }).join('') +
          '</div>' +
        '</div>' +
      '</div>'
    );

    initTracking(container);
  }

  /* ── Main render dispatcher ──────────────────────────────────────────────── */

  function renderWidget(container, data) {
    var pageType  = container.dataset.twPage  || 'home';
    var region    = container.dataset.twRegion;
    var excludeId = container.dataset.twExclude;

    if (pageType === 'hotel') {
      renderHotel(container, data, excludeId);
    } else if (pageType === 'region') {
      renderRegion(container, data, region);
    } else {
      renderHome(container, data);
    }
  }

  /* ── Boot ────────────────────────────────────────────────────────────────── */

  function boot() {
    var placeholders = document.querySelectorAll('[data-tw-widget]');
    if (!placeholders.length) return;

    placeholders.forEach(function (el) {
      el.innerHTML = '<div class="tw-loading"><div class="tw-spinner"></div>Loading trends&hellip;</div>';
    });

    fetch(DATA_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        placeholders.forEach(function (el) {
          renderWidget(el, data);
        });
      })
      .catch(function (err) {
        placeholders.forEach(function (el) { el.innerHTML = ''; });
        console.warn('trending-widget: failed to load', err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
