/* resort-map.js — Resort Discovery Map (Leaflet, CSP-safe, zero inline events) */

(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────────────────────── */

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trackEvent(name, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, params || {});
    }
  }

  /* ── State ───────────────────────────────────────────────────────────────── */

  var hotels      = [];
  var markerMap   = new Map();   // hotel id → Leaflet marker
  var markerLayer = null;
  var map         = null;
  var activeMarker = null;

  var filterRegion   = 'all';
  var filterCategory = 'all';
  var searchQuery    = '';

  var compareList = [];          // [{id, name, slug}] max 2
  var wishlist    = [];          // [hotel_id]

  /* ── Wishlist (localStorage) ─────────────────────────────────────────────── */

  function loadWishlist() {
    try {
      wishlist = JSON.parse(localStorage.getItem('mrf_wishlist') || '[]');
    } catch (_) {
      wishlist = [];
    }
  }

  function saveWishlist() {
    try { localStorage.setItem('mrf_wishlist', JSON.stringify(wishlist)); } catch (_) {}
  }

  function isWishlisted(id) {
    return wishlist.indexOf(id) !== -1;
  }

  /* ── Marker color tier ───────────────────────────────────────────────────── */

  function markerClass(hotel) {
    if ((hotel.rating || 0) >= 9.0) return 'rm-marker--gold';
    return 'rm-marker--premium';
  }

  /* ── Popup HTML ──────────────────────────────────────────────────────────── */

  function starStr(n) {
    var out = '';
    for (var i = 0; i < 5; i++) out += (i < n) ? '★' : '☆';
    return out;
  }

  function buildPopupHtml(h) {
    var inCompare   = compareList.some(function (c) { return c.id === h.id; });
    var isWished    = isWishlisted(h.id);
    var rating      = h.rating != null ? Number(h.rating).toFixed(1) : '—';
    var compareCls  = inCompare ? ' selected' : '';
    var wishCls     = isWished ? ' saved' : '';
    var wishLabel   = isWished ? '&#9829; Saved' : '&#9825; Save';

    return (
      '<div class="rm-popup" data-hotel-id="' + esc(h.id) + '">' +
        '<div class="rm-popup__name">' + esc(h.name) + '</div>' +
        '<div class="rm-popup__stars">' + starStr(h.stars || 5) + '</div>' +
        '<div class="rm-popup__region">' + esc(h.region) + ' &middot; Mauritius</div>' +
        '<div class="rm-popup__rating">' + esc(rating) + '<span>/10</span></div>' +
        '<div class="rm-popup__point">' + esc(h.selling_point) + '</div>' +
        '<div class="rm-popup__actions">' +
          '<a href="/hotels/' + esc(h.slug) + '/" class="rm-popup__view">View resort &#8594;</a>' +
          '<button class="rm-popup__compare' + compareCls + '"' +
            ' data-action="compare"' +
            ' data-id="' + esc(h.id) + '"' +
            ' data-name="' + esc(h.name) + '"' +
            ' data-slug="' + esc(h.slug) + '">' +
            (inCompare ? '&#10003; Added' : '&#8862; Compare') +
          '</button>' +
          '<button class="rm-popup__wishlist' + wishCls + '"' +
            ' data-action="wishlist"' +
            ' data-id="' + esc(h.id) + '">' +
            wishLabel +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ── Marker creation ─────────────────────────────────────────────────────── */

  function createMarker(h) {
    var cls = markerClass(h);
    var rating = h.rating != null ? Number(h.rating).toFixed(1) : '';

    var icon = L.divIcon({
      className: '',
      html: '<div class="rm-marker ' + cls + '" data-hotel-id="' + esc(h.id) + '">' +
              '<span class="rm-marker__rating">' + esc(rating) + '</span>' +
            '</div>',
      iconSize:   [38, 38],
      iconAnchor: [19, 38],
      popupAnchor: [0, -40],
    });

    var marker = L.marker([h.lat, h.lng], { icon: icon, title: h.name });

    marker.bindPopup(buildPopupHtml(h), {
      minWidth: 240,
      maxWidth: 280,
      className: 'rm-leaflet-popup',
    });

    marker.on('click', function () {
      if (activeMarker && activeMarker !== marker) {
        var prevEl = activeMarker.getElement();
        if (prevEl) prevEl.querySelector('.rm-marker').classList.remove('rm-marker--active');
      }
      activeMarker = marker;
      var el = marker.getElement();
      if (el) el.querySelector('.rm-marker').classList.add('rm-marker--active');

      trackEvent('marker_click', {
        hotel_id:   h.id,
        hotel_name: h.name,
        region:     h.region,
      });
    });

    marker.on('popupclose', function () {
      var el = marker.getElement();
      if (el) el.querySelector('.rm-marker').classList.remove('rm-marker--active');
    });

    return marker;
  }

  /* ── Filter logic ────────────────────────────────────────────────────────── */

  function matchesFilters(h) {
    if (filterRegion !== 'all' && h.region !== filterRegion) return false;
    if (filterCategory !== 'all' && (!h.categories || h.categories.indexOf(filterCategory) === -1)) return false;
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      if (h.name.toLowerCase().indexOf(q) === -1 && h.region.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }

  function applyFilters() {
    var visible = 0;

    hotels.forEach(function (h) {
      var marker = markerMap.get(h.id);
      if (!marker) return;

      if (matchesFilters(h)) {
        if (!map.hasLayer(marker)) marker.addTo(map);
        visible++;
      } else {
        if (map.hasLayer(marker)) marker.remove();
        if (map.isPopupOpen() && activeMarker === marker) map.closePopup();
      }
    });

    updateCount(visible);
    updateHotelList();
  }

  /* ── Sidebar hotel list ──────────────────────────────────────────────────── */

  function updateCount(n) {
    var el = document.getElementById('rm-count');
    if (el) el.textContent = n + (n === 1 ? ' resort' : ' resorts');
  }

  function updateHotelList() {
    var list = document.getElementById('rm-hotel-list');
    if (!list) return;

    var visible = hotels.filter(matchesFilters).sort(function (a, b) {
      return (b.rating || 0) - (a.rating || 0);
    });

    list.innerHTML = visible.map(function (h) {
      var cls = markerClass(h);
      var clsName = cls === 'rm-marker--gold' ? 'rm-hotel-item__badge--gold' : 'rm-hotel-item__badge--premium';
      var bgColor = cls === 'rm-marker--gold' ? '#d4a843' : '#1a6b8a';
      var rating  = h.rating != null ? Number(h.rating).toFixed(1) : '—';

      return '<a href="/hotels/' + esc(h.slug) + '/" class="rm-hotel-item" data-action="list-click" data-id="' + esc(h.id) + '">' +
        '<div class="rm-hotel-item__badge ' + clsName + '" style="background:' + bgColor + '">' + esc(rating) + '</div>' +
        '<div class="rm-hotel-item__info">' +
          '<div class="rm-hotel-item__name">' + esc(h.name) + '</div>' +
          '<div class="rm-hotel-item__region">' + esc(h.region) + '</div>' +
          '<div class="rm-hotel-item__rating">&#9733; ' + esc(rating) + ' / 10</div>' +
        '</div>' +
      '</a>';
    }).join('');
  }

  /* ── Filter pill builders ────────────────────────────────────────────────── */

  var CATEGORY_LABELS = {
    luxury:      'Luxury',
    beach:       'Beach',
    spa:         'Spa & Wellness',
    family:      'Family',
    adults_only: 'Adults Only',
    golf:        'Golf',
    all_inclusive: 'All-Inclusive',
    overwater:   'Overwater',
  };

  function buildRegionPills() {
    var regions = ['all'].concat(
      hotels
        .map(function (h) { return h.region; })
        .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; })
        .sort()
    );

    var container = document.getElementById('rm-filter-region');
    if (!container) return;

    container.innerHTML = regions.map(function (r) {
      var label = r === 'all' ? 'All Regions' : r;
      var active = filterRegion === r ? ' active' : '';
      return '<button class="rm-pill' + active + '" data-filter="region" data-value="' + esc(r) + '">' + esc(label) + '</button>';
    }).join('');
  }

  function buildCategoryPills() {
    var cats = new Set();
    hotels.forEach(function (h) {
      (h.categories || []).forEach(function (c) { cats.add(c); });
    });

    var ordered = ['all'].concat(Object.keys(CATEGORY_LABELS).filter(function (c) { return cats.has(c); }));

    var container = document.getElementById('rm-filter-category');
    if (!container) return;

    container.innerHTML = ordered.map(function (c) {
      var label  = c === 'all' ? 'All Types' : (CATEGORY_LABELS[c] || c);
      var active = filterCategory === c ? ' active' : '';
      return '<button class="rm-pill' + active + '" data-filter="category" data-value="' + esc(c) + '">' + esc(label) + '</button>';
    }).join('');
  }

  /* ── Compare bar ─────────────────────────────────────────────────────────── */

  function onCompare(id, name, slug) {
    var idx = compareList.findIndex(function (c) { return c.id === id; });

    if (idx >= 0) {
      compareList.splice(idx, 1);
    } else {
      if (compareList.length >= 2) return;
      compareList.push({ id: id, name: name, slug: slug });
      trackEvent('compare_add', { hotel_id: id, hotel_name: name });
    }

    updateCompareBar();

    var marker = markerMap.get(id);
    if (marker && map.hasLayer(marker)) {
      var popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(buildPopupHtml(hotels.find(function (h) { return h.id === id; }) || {}));
      }
    }
  }

  function updateCompareBar() {
    var bar = document.getElementById('rm-compare-bar');
    if (!bar) return;

    if (compareList.length === 0) {
      bar.classList.remove('visible');
      return;
    }

    bar.classList.add('visible');

    var itemsEl = bar.querySelector('.rm-compare-bar__items');
    if (!itemsEl) return;

    var itemsHtml = compareList.map(function (c, i) {
      return '<span class="rm-compare-bar__item">' +
        esc(c.name) +
        '<button class="rm-compare-bar__remove" data-action="remove-compare" data-id="' + esc(c.id) + '" aria-label="Remove ' + esc(c.name) + '">&#10005;</button>' +
        '</span>' +
        (i === 0 && compareList.length === 2 ? '<span class="rm-compare-bar__vs">vs</span>' : '');
    }).join('');

    itemsEl.innerHTML = itemsHtml;

    var goBtn = bar.querySelector('.rm-compare-bar__go');
    if (goBtn) {
      if (compareList.length === 2) {
        var slugs = [compareList[0].slug, compareList[1].slug].slice().sort();
        var url   = '/compare/' + slugs[0] + '-vs-' + slugs[1] + '/';
        goBtn.href = url;
        goBtn.removeAttribute('aria-disabled');
      } else {
        goBtn.removeAttribute('href');
        goBtn.setAttribute('aria-disabled', 'true');
      }
    }
  }

  /* ── Wishlist ────────────────────────────────────────────────────────────── */

  function onWishlist(id, btn) {
    var idx = wishlist.indexOf(id);
    if (idx >= 0) {
      wishlist.splice(idx, 1);
      btn.textContent  = '♡ Save';
      btn.classList.remove('saved');
    } else {
      wishlist.push(id);
      btn.innerHTML = '♥ Saved';
      btn.classList.add('saved');
      trackEvent('wishlist_add', { hotel_id: id });
    }
    saveWishlist();
  }

  /* ── Fly to hotel from sidebar list ─────────────────────────────────────── */

  function flyToHotel(id) {
    var h = hotels.find(function (h) { return h.id === id; });
    if (!h) return;
    var marker = markerMap.get(id);
    if (!marker) return;
    map.flyTo([h.lat, h.lng], 13, { animate: true, duration: 0.8 });
    setTimeout(function () { marker.openPopup(); }, 850);
    trackEvent('marker_click', { hotel_id: id, hotel_name: h.name, source: 'sidebar_list' });
  }

  /* ── Search ──────────────────────────────────────────────────────────────── */

  function initSearch() {
    var input = document.getElementById('rm-search-input');
    var clear = document.getElementById('rm-search-clear');
    if (!input) return;

    input.addEventListener('input', function () {
      searchQuery = input.value.trim();
      clear.classList.toggle('visible', searchQuery.length > 0);
      applyFilters();
      if (searchQuery) {
        trackEvent('map_search', { query: searchQuery });
      }
    });

    if (clear) {
      clear.addEventListener('click', function () {
        input.value = '';
        searchQuery = '';
        clear.classList.remove('visible');
        applyFilters();
      });
    }
  }

  /* ── Event delegation ────────────────────────────────────────────────────── */

  function initDelegation() {
    /* Popup buttons on the Leaflet map container */
    document.getElementById('resort-map').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;

      if (action === 'compare') {
        onCompare(btn.dataset.id, btn.dataset.name, btn.dataset.slug);
      } else if (action === 'wishlist') {
        onWishlist(btn.dataset.id, btn);
      }
    });

    /* Sidebar hotel list */
    var list = document.getElementById('rm-hotel-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var item = e.target.closest('[data-action="list-click"]');
        if (!item) return;
        e.preventDefault();
        flyToHotel(item.dataset.id);
      });
    }

    /* Compare bar buttons */
    var bar = document.getElementById('rm-compare-bar');
    if (bar) {
      bar.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;

        if (action === 'remove-compare') {
          onCompare(btn.dataset.id, '', '');
        } else if (action === 'clear-compare') {
          compareList = [];
          updateCompareBar();
        }
      });
    }

    /* Filter pills */
    var sidebar = document.getElementById('rm-sidebar');
    if (sidebar) {
      sidebar.addEventListener('click', function (e) {
        var pill = e.target.closest('[data-filter]');
        if (!pill) return;

        var filterType = pill.dataset.filter;
        var value      = pill.dataset.value;

        if (filterType === 'region') {
          filterRegion = value;
          sidebar.querySelectorAll('[data-filter="region"]').forEach(function (p) {
            p.classList.toggle('active', p.dataset.value === value);
          });
        } else if (filterType === 'category') {
          filterCategory = value;
          sidebar.querySelectorAll('[data-filter="category"]').forEach(function (p) {
            p.classList.toggle('active', p.dataset.value === value);
          });
        }

        applyFilters();
        trackEvent('filter_change', { filter_type: filterType, filter_value: value });
      });
    }

    /* Mobile sidebar toggle */
    var toggleBtn = document.getElementById('rm-toggle');
    var sidebarEl = document.getElementById('rm-sidebar');
    if (toggleBtn && sidebarEl) {
      toggleBtn.addEventListener('click', function () {
        var isOpen = sidebarEl.classList.toggle('open');
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
        toggleBtn.textContent = isOpen ? '✕ Close' : '☰ Filters';
      });
    }
  }

  /* ── Tile layers ─────────────────────────────────────────────────────────── */

  var TILE_LIGHT = {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  };

  var TILE_DARK = {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  };

  /* ── Map initialisation ──────────────────────────────────────────────────── */

  function initMap(data) {
    hotels = data;

    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var tiles  = isDark ? TILE_DARK : TILE_LIGHT;

    map = L.map('resort-map', {
      center:    [-20.25, 57.58],
      zoom:      10,
      minZoom:   9,
      maxZoom:   17,
      zoomControl: true,
    });

    L.tileLayer(tiles.url, {
      attribution: tiles.attribution,
      subdomains:  tiles.subdomains,
      maxZoom:     tiles.maxZoom,
    }).addTo(map);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      map.eachLayer(function (layer) {
        if (layer instanceof L.TileLayer) map.removeLayer(layer);
      });
      var t = e.matches ? TILE_DARK : TILE_LIGHT;
      L.tileLayer(t.url, {
        attribution: t.attribution,
        subdomains:  t.subdomains,
        maxZoom:     t.maxZoom,
      }).addTo(map);
    });

    hotels.forEach(function (h) {
      var marker = createMarker(h);
      marker.addTo(map);
      markerMap.set(h.id, marker);
    });

    buildRegionPills();
    buildCategoryPills();
    updateCount(hotels.length);
    updateHotelList();

    trackEvent('map_open', { hotel_count: hotels.length });
  }

  /* ── Lazy load via IntersectionObserver ─────────────────────────────────── */

  function startLoadingWhenVisible() {
    var mapWrap = document.getElementById('rm-map-wrap');
    if (!mapWrap) { loadData(); return; }

    if (!('IntersectionObserver' in window)) { loadData(); return; }

    var obs = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        obs.disconnect();
        loadData();
      }
    }, { threshold: 0.01 });

    obs.observe(mapWrap);
  }

  /* ── Data fetch ──────────────────────────────────────────────────────────── */

  function loadData() {
    fetch('/assets/data/map-hotels.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var hotels = Array.isArray(data) ? data : (data.hotels || []);
        if (!hotels.length) throw new Error('Empty hotel dataset');

        var container = document.getElementById('rm-loading');
        if (container) container.remove();

        initMap(hotels);
        initSearch();
        initDelegation();
      })
      .catch(function (err) {
        var container = document.getElementById('rm-loading');
        if (container) {
          container.innerHTML =
            '<div class="rm-spinner" style="display:none"></div>' +
            '<p style="font-size:.85rem;color:#888">Unable to load map data.<br>' +
            '<a href="/best-luxury-hotels-mauritius/" style="color:#e25822">Browse resorts instead &#8594;</a></p>';
        }
        console.error('Resort map: failed to load data', err);
      });
  }

  /* ── Boot ────────────────────────────────────────────────────────────────── */

  function boot() {
    if (typeof L === 'undefined') {
      console.error('Resort map: Leaflet not loaded');
      return;
    }

    loadWishlist();
    startLoadingWhenVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
