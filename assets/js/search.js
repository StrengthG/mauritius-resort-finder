/**
 * search.js — Mauritius Resort Finder
 * Client-side search engine: loads search-index.json, fuzzy-matches queries,
 * renders results, handles URL params, recent searches (localStorage), and
 * fires GA4 analytics events.
 *
 * CSP: loaded as an external script from 'self'. No inline eval, no CDN deps.
 */

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────

  var INDEX_URL       = '/search-index.json';
  var STORAGE_KEY     = 'mrf_recent_searches';
  var MAX_RECENT      = 5;
  var MAX_RESULTS     = 20;
  var DEBOUNCE_MS     = 220;
  var MIN_QUERY_LEN   = 2;

  var POPULAR_SEARCHES = [
    'luxury', 'honeymoon', 'adults only', 'family', 'Grand Baie',
    'Belle Mare', 'wellness', 'best value', 'golf', 'snorkelling',
    'beach', 'spa', 'budget', 'Le Morne', 'beachfront'
  ];

  // ─── State ─────────────────────────────────────────────────────────────────

  var searchIndex    = null;   // loaded once, cached
  var currentQuery   = '';
  var debounceTimer  = null;
  var indexLoading   = false;

  // ─── DOM refs (populated in init) ──────────────────────────────────────────

  var elInput, elResultsSection, elResultsHeader, elResultsGrid,
      elLoading, elEmpty, elRecentSection, elRecentChips, elPopularSection;

  // ─────────────────────────────────────────────────────────────────────────────
  // ALGORITHM (mirrors search_engine_client.js — kept in sync manually)
  // ─────────────────────────────────────────────────────────────────────────────

  function normalise(str) {
    if (!str || typeof str !== 'string') return '';
    return str.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim();
  }

  function tokenise(query) {
    if (!query || typeof query !== 'string') return [];
    return normalise(query)
      .split(/[^a-z0-9]+/)
      .filter(function (t) { return t.length >= 2; })
      .filter(function (t, i, arr) { return arr.indexOf(t) === i; });
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [], curr = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (j = 1; j <= b.length; j++) {
        curr[j] = a[i-1] === b[j-1]
          ? prev[j-1]
          : 1 + Math.min(prev[j], curr[j-1], prev[j-1]);
      }
      var tmp = prev; prev = curr; curr = tmp;
    }
    return prev[b.length];
  }

  function fuzzyMatchScore(token, normText) {
    if (token.length < 4) return 0;
    var words = normText.split(/\s+/).filter(function (w) { return w.length >= 3; });
    var threshold = token.length >= 6 ? 2 : 1;
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (Math.abs(token.length - word.length) > threshold + 1) continue;
      if (levenshtein(token, word) <= threshold) return threshold === 2 ? 3 : 5;
    }
    return 0;
  }

  function scoreItem(item, tokens) {
    if (!tokens.length) return 0;
    var normTitle   = normalise(item.title || '');
    var normText    = normalise(item.searchText || '');
    var normDesc    = normalise(item.description || '');
    var fuzzyCorpus = normTitle + ' ' + normText;
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (normTitle === token)                           { total += 100; continue; }
      if (normTitle.startsWith(token + ' ') || normTitle === token) total += 60;
      else if (normTitle.indexOf(token) !== -1)          total += 25;
      if (normText.indexOf(token) !== -1)                total += 10;
      if (normDesc.indexOf(token) !== -1)                total += 5;
      total += fuzzyMatchScore(token, fuzzyCorpus);
    }
    if (tokens.length > 1) {
      var allPresent = tokens.every(function (t) {
        return normTitle.indexOf(t) !== -1 ||
               normText.indexOf(t) !== -1 ||
               fuzzyMatchScore(t, fuzzyCorpus) > 0;
      });
      if (allPresent) total = Math.round(total * 1.25);
    }
    return total;
  }

  function runSearch(index, query) {
    if (!query || !query.trim() || !index || !Array.isArray(index.items)) return [];
    var tokens = tokenise(query);
    if (!tokens.length) return [];
    var scored = index.items
      .map(function (item) { return { item: item, score: scoreItem(item, tokens) }; })
      .filter(function (r) { return r.score > 0; })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if (a.item.type === 'hotel' && b.item.type === 'hotel') {
          return (b.item.score || 0) - (a.item.score || 0);
        }
        return (a.item.title || '').localeCompare(b.item.title || '');
      })
      .slice(0, MAX_RESULTS);
    return scored.map(function (r) {
      return Object.assign({}, r.item, { _relevanceScore: r.score });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX LOADING
  // ─────────────────────────────────────────────────────────────────────────────

  function loadIndex(callback) {
    if (searchIndex) { callback(null, searchIndex); return; }
    if (indexLoading) { setTimeout(function () { loadIndex(callback); }, 50); return; }
    indexLoading = true;
    fetch(INDEX_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        searchIndex = data;
        indexLoading = false;
        callback(null, data);
      })
      .catch(function (err) {
        indexLoading = false;
        callback(err, null);
      });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RECENT SEARCHES (localStorage)
  // ─────────────────────────────────────────────────────────────────────────────

  function getRecentSearches() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function addRecentSearch(term) {
    var clean = term.trim();
    if (!clean || clean.length < MIN_QUERY_LEN) return;
    try {
      var list = getRecentSearches().filter(function (t) {
        return t.toLowerCase() !== clean.toLowerCase();
      });
      list.unshift(clean);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    } catch (_) { /* storage may be unavailable */ }
    renderRecentSearches();
  }

  function renderRecentSearches() {
    if (!elRecentSection || !elRecentChips) return;
    var list = getRecentSearches();
    if (!list.length) { elRecentSection.hidden = true; return; }

    elRecentChips.innerHTML = '';
    list.forEach(function (term) {
      var btn = document.createElement('button');
      btn.className = 'search-chip search-chip--recent';
      btn.textContent = term;
      btn.setAttribute('aria-label', 'Search for ' + term);
      btn.addEventListener('click', function () { setQuery(term); });
      elRecentChips.appendChild(btn);
    });
    elRecentSection.hidden = false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POPULAR SEARCHES
  // ─────────────────────────────────────────────────────────────────────────────

  function initPopularSearches() {
    var container = document.getElementById('popular-chips');
    if (!container) return;
    container.innerHTML = '';
    POPULAR_SEARCHES.forEach(function (term) {
      var btn = document.createElement('button');
      btn.className = 'search-chip';
      btn.textContent = term;
      btn.setAttribute('aria-label', 'Search for ' + term);
      btn.addEventListener('click', function () { setQuery(term); });
      container.appendChild(btn);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var TYPE_LABELS = {
    hotel:      'Hotel',
    ranking:    'Rankings',
    region:     'Region Guide',
    guide:      'Travel Guide',
    comparison: 'Comparison',
  };

  var TYPE_ICONS = {
    hotel:      '🏨',
    ranking:    '🏆',
    region:     '📍',
    guide:      '📖',
    comparison: '⚖️',
  };

  function renderResult(item) {
    var typeLabel = TYPE_LABELS[item.type] || 'Guide';
    var typeIcon  = TYPE_ICONS[item.type] || '📄';
    var scoreHtml = item.type === 'hotel' && item.score
      ? '<span class="sr-score">' + esc(item.score.toFixed(1)) + '</span>'
      : '';
    var descHtml = item.description
      ? '<p class="sr-desc">' + esc(item.description) + '</p>'
      : '';

    return '<a href="' + esc(item.url) + '" class="search-result-card" '
      + 'data-type="' + esc(item.type) + '" '
      + 'data-slug="' + esc(item.slug) + '">'
      + '<div class="sr-header">'
      +   '<span class="sr-icon" aria-hidden="true">' + typeIcon + '</span>'
      +   '<div class="sr-meta">'
      +     '<span class="sr-type">' + esc(typeLabel) + '</span>'
      +     scoreHtml
      +   '</div>'
      + '</div>'
      + '<div class="sr-title">' + esc(item.title) + '</div>'
      + descHtml
      + '</a>';
  }

  function showLoading() {
    if (elLoading)          elLoading.hidden          = false;
    if (elEmpty)            elEmpty.hidden            = true;
    if (elResultsGrid)      elResultsGrid.innerHTML   = '';
    if (elResultsSection)   elResultsSection.hidden   = false;
    if (elResultsHeader)    elResultsHeader.textContent = '';
  }

  function showResults(results, query) {
    if (elLoading)  elLoading.hidden = true;

    if (!results.length) {
      if (elEmpty) {
        elEmpty.querySelector('.empty-query').textContent = esc(query);
        elEmpty.hidden = false;
      }
      if (elResultsHeader) elResultsHeader.textContent = 'No results for “' + query + '”';
      if (elResultsGrid)   elResultsGrid.innerHTML = '';
      return;
    }

    if (elEmpty) elEmpty.hidden = true;
    if (elResultsHeader) {
      elResultsHeader.textContent = results.length + ' result'
        + (results.length !== 1 ? 's' : '') + ' for “' + query + '”';
    }
    if (elResultsGrid) {
      elResultsGrid.innerHTML = results.map(renderResult).join('');
      // Attach click analytics
      elResultsGrid.querySelectorAll('.search-result-card').forEach(function (card) {
        card.addEventListener('click', function () {
          fireAnalytics('select_content', {
            content_type: card.dataset.type,
            item_id:      card.dataset.slug,
            search_term:  currentQuery,
          });
        });
      });
    }
  }

  function showEmpty(query) {
    showResults([], query);
  }

  function hideResults() {
    if (elResultsSection) elResultsSection.hidden = true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ANALYTICS
  // ─────────────────────────────────────────────────────────────────────────────

  function fireAnalytics(event, params) {
    try {
      if (typeof gtag === 'function') {
        gtag('event', event, params);
      }
    } catch (_) { /* GA4 not loaded */ }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SEARCH EXECUTION
  // ─────────────────────────────────────────────────────────────────────────────

  function executeSearch(query) {
    var q = (query || '').trim();
    currentQuery = q;

    if (q.length < MIN_QUERY_LEN) {
      hideResults();
      return;
    }

    showLoading();

    loadIndex(function (err, index) {
      if (err || !index) {
        if (elLoading) elLoading.hidden = true;
        if (elResultsHeader) elResultsHeader.textContent = 'Search unavailable — please try again.';
        return;
      }

      var results = runSearch(index, q);
      showResults(results, q);

      // Analytics: fire on search (debounced — only fire after results render)
      fireAnalytics('search', {
        search_term:   q,
        results_count: results.length,
      });
    });
  }

  function setQuery(term) {
    if (!elInput) return;
    elInput.value = term;
    elInput.focus();
    clearTimeout(debounceTimer);
    executeSearch(term);
    addRecentSearch(term);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // URL PARAMETER HANDLING
  // ─────────────────────────────────────────────────────────────────────────────

  function getUrlQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      return (params.get('q') || '').trim();
    } catch (_) { return ''; }
  }

  function updateUrl(query) {
    try {
      var url = new URL(window.location.href);
      if (query) {
        url.searchParams.set('q', query);
      } else {
        url.searchParams.delete('q');
      }
      history.replaceState(null, '', url.toString());
    } catch (_) { /* older browser */ }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────────────

  function init() {
    elInput          = document.getElementById('search-input');
    elResultsSection = document.getElementById('search-results-section');
    elResultsHeader  = document.getElementById('results-header');
    elResultsGrid    = document.getElementById('search-results-grid');
    elLoading        = document.getElementById('search-loading');
    elEmpty          = document.getElementById('search-empty');
    elRecentSection  = document.getElementById('recent-searches');
    elRecentChips    = document.getElementById('recent-chips');
    elPopularSection = document.getElementById('popular-searches');

    if (!elInput) return;

    // Populate popular searches chips
    initPopularSearches();

    // Populate recent searches from localStorage
    renderRecentSearches();

    // Input event — debounced
    elInput.addEventListener('input', function () {
      var q = elInput.value.trim();
      updateUrl(q);
      clearTimeout(debounceTimer);
      if (q.length < MIN_QUERY_LEN) {
        hideResults();
        return;
      }
      debounceTimer = setTimeout(function () {
        executeSearch(q);
        addRecentSearch(q);
      }, DEBOUNCE_MS);
    });

    // Enter key: execute immediately
    elInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        var q = elInput.value.trim();
        if (q.length >= MIN_QUERY_LEN) {
          executeSearch(q);
          addRecentSearch(q);
        }
      }
    });

    // Pre-fill and run from URL ?q= param
    var urlQuery = getUrlQuery();
    if (urlQuery.length >= MIN_QUERY_LEN) {
      elInput.value = urlQuery;
      executeSearch(urlQuery);
      // Pre-fetch index so first keystroke is instant
    } else {
      // Pre-fetch index in background for fast first search
      setTimeout(function () { loadIndex(function () {}); }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
