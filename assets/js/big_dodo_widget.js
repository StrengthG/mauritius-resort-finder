/**
 * Big Dodo Widget — Mauritius Resort Finder AI Concierge
 *
 * Self-contained, dependency-free chat widget. Reads configuration from
 * window.BigDodoConfig (injected per-page by the site renderer):
 *
 *   window.BigDodoConfig = {
 *     apiUrl:      '/api/chat',
 *     pageContext: { pageType: 'ranking', slug: '...' },
 *   };
 */
(function () {
  'use strict';

  // ── Config & constants ────────────────────────────────────────────────────

  const cfg = window.BigDodoConfig || {};
  const API_URL    = cfg.apiUrl    || '/api/chat';
  const PAGE_CTX   = cfg.pageContext || {};

  const STORAGE_KEY   = 'bd_session_history';
  const SEEN_KEY      = 'bd_has_opened';
  const MAX_HISTORY   = 16;

  const WELCOME = "Hello! I'm Big Dodo, your Mauritius resort concierge. I can help you compare resorts, find the best beach, recommend stays for families or couples — all based on verified data. What are you looking for?";

  const SUGGESTIONS = [
    'Best honeymoon resort',
    'Family-friendly hotels',
    'Best value luxury stay',
    'Top-rated spa resort',
    'Quietest beach location',
  ];

  // ── SVGs ──────────────────────────────────────────────────────────────────

  const SVG_CHAT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`;

  const SVG_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`;

  const SVG_SEND = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>`;

  const SVG_DODO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <text y="18" font-size="16" font-family="serif">🦤</text>
  </svg>`;

  // ── HTML escaping helpers ─────────────────────────────────────────────────

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    if (typeof url !== 'string') return '#';
    const t = url.trim();
    if (t.startsWith('https://expedia.com/affiliate/')) return t;
    if (/^https?:\/\//.test(t)) return t;
    return '#invalid';
  }

  function textToHtml(str) {
    return esc(str).replace(/\n/g, '<br>');
  }

  // ── BigDodo class ─────────────────────────────────────────────────────────

  function BigDodo() {
    this.history   = [];
    this.isOpen    = false;
    this.isBusy    = false;
    this._abortCtrl = null;

    this._loadHistory();
    this._buildDOM();
    this._bindEvents();

    // Pulse on first visit
    if (!sessionStorage.getItem(SEEN_KEY)) {
      this.btn.classList.add('bd-trigger--pulse');
    }
  }

  // ── DOM construction ────────────────────────────────────────────────────

  BigDodo.prototype._buildDOM = function () {
    var root = document.createElement('div');
    root.className = 'bd-widget';
    root.setAttribute('data-big-dodo', '');

    // Trigger button
    var btn = document.createElement('button');
    btn.className    = 'bd-trigger';
    btn.type         = 'button';
    btn.setAttribute('aria-label', 'Open Big Dodo resort concierge');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'bd-panel');
    btn.innerHTML    = `
      <svg class="bd-trigger__icon" viewBox="0 0 24 24" fill="none" stroke="#08111f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="bd-trigger__label">Ask</span>
    `;

    // Panel
    var panel = document.createElement('div');
    panel.id        = 'bd-panel';
    panel.className = 'bd-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Big Dodo resort concierge');
    panel.setAttribute('aria-hidden', 'true');

    panel.innerHTML = `
      <header class="bd-header">
        <div class="bd-header__avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#08111f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="bd-header__info">
          <div class="bd-header__name">Big Dodo</div>
          <div class="bd-header__status">
            <span class="bd-header__dot" aria-hidden="true"></span>
            Resort Concierge
          </div>
        </div>
        <button type="button" class="bd-header__close" aria-label="Close Big Dodo concierge">
          ${SVG_CLOSE}
        </button>
      </header>

      <div class="bd-messages" id="bd-messages" role="log" aria-live="polite" aria-label="Conversation"></div>

      <div class="bd-typing" id="bd-typing" role="status" aria-label="Big Dodo is thinking">
        <span class="bd-typing__dot"></span>
        <span class="bd-typing__dot"></span>
        <span class="bd-typing__dot"></span>
      </div>

      <div class="bd-suggestions" id="bd-suggestions" aria-label="Suggested questions"></div>

      <div class="bd-input-area">
        <textarea
          class="bd-input"
          id="bd-input"
          rows="1"
          placeholder="Ask about resorts, beaches, families…"
          aria-label="Your message to Big Dodo"
          maxlength="600"
        ></textarea>
        <button type="button" class="bd-send" id="bd-send" aria-label="Send message">
          ${SVG_SEND}
        </button>
      </div>
    `;

    root.appendChild(btn);
    root.appendChild(panel);
    document.body.appendChild(root);

    // Cache references
    this.root      = root;
    this.btn       = btn;
    this.panel     = panel;
    this._messages = panel.querySelector('#bd-messages');
    this._typing   = panel.querySelector('#bd-typing');
    this._suggestions = panel.querySelector('#bd-suggestions');
    this._input    = panel.querySelector('#bd-input');
    this._sendBtn  = panel.querySelector('#bd-send');
    this._closeBtn = panel.querySelector('.bd-header__close');
  };

  // ── Event binding ────────────────────────────────────────────────────────

  BigDodo.prototype._bindEvents = function () {
    var self = this;

    this.btn.addEventListener('click', function () { self._toggle(); });
    this._closeBtn.addEventListener('click', function () { self._close(); });

    // Keyboard
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self.isOpen) self._close();
    });

    this._input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        self._send();
      }
    });

    // Auto-resize textarea
    this._input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    this._sendBtn.addEventListener('click', function () { self._send(); });

    // Click outside to close (optional — disabled by default for accessibility)
    // panel.addEventListener('click', function(e) { e.stopPropagation(); });
    // document.addEventListener('click', function() { if (self.isOpen) self._close(); });
  };

  // ── Open / close ────────────────────────────────────────────────────────

  BigDodo.prototype._open = function () {
    this.isOpen = true;
    this.panel.classList.add('bd-panel--open');
    this.panel.setAttribute('aria-hidden', 'false');
    this.btn.setAttribute('aria-expanded', 'true');
    this.btn.classList.remove('bd-trigger--pulse');
    sessionStorage.setItem(SEEN_KEY, '1');

    // Show welcome + suggestions on first open
    if (this.history.length === 0) {
      this._appendMessage('assistant', WELCOME);
      this._saveHistory();
      this._renderSuggestions();
    } else {
      this._renderHistory();
      this._hideSuggestions();
    }

    var self = this;
    requestAnimationFrame(function () {
      self._input.focus();
      self._scrollBottom();
    });

    this._track('big_dodo_open');
  };

  BigDodo.prototype._close = function () {
    this.isOpen = false;
    this.panel.classList.remove('bd-panel--open');
    this.panel.setAttribute('aria-hidden', 'true');
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.focus();
  };

  BigDodo.prototype._toggle = function () {
    this.isOpen ? this._close() : this._open();
  };

  // ── Send message ─────────────────────────────────────────────────────────

  BigDodo.prototype._send = function () {
    var text = this._input.value.trim();
    if (!text || this.isBusy) return;
    if (text.length > 600) {
      text = text.slice(0, 600);
    }

    this._input.value = '';
    this._input.style.height = 'auto';
    this._hideSuggestions();
    this._appendMessage('user', text);
    this.history.push({ role: 'user', content: text });
    this._saveHistory();

    this._track('big_dodo_question');

    var self = this;
    this._showTyping();

    var historyForAPI = this.history.slice(-(12));

    // Cancel any in-flight request
    if (this._abortCtrl) {
      try { this._abortCtrl.abort(); } catch (_) {}
    }
    this._abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;

    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        pageContext: PAGE_CTX,
        conversationHistory: historyForAPI,
      }),
      signal: self._abortCtrl ? self._abortCtrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        self._hideTyping();
        self._renderBotResponse(data);
        self.history.push({ role: 'assistant', content: data.answer || '' });
        self._saveHistory();
        self._track('big_dodo_response', { confidence: data.confidence });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        self._hideTyping();
        self._appendError("I'm having trouble connecting right now. Please try again in a moment.");
      });
  };

  // ── Message rendering ────────────────────────────────────────────────────

  BigDodo.prototype._appendMessage = function (role, text) {
    var wrap = document.createElement('div');
    wrap.className = 'bd-msg bd-msg--' + role;

    var bubble = document.createElement('div');
    bubble.className = 'bd-bubble';
    bubble.innerHTML = textToHtml(text);

    wrap.appendChild(bubble);
    this._messages.appendChild(wrap);
    this._scrollBottom();
    return wrap;
  };

  BigDodo.prototype._renderBotResponse = function (data) {
    var wrap = document.createElement('div');
    wrap.className = 'bd-msg bd-msg--assistant';

    var bubble = document.createElement('div');
    bubble.className = 'bd-bubble';
    bubble.innerHTML = textToHtml(data.answer || '');
    wrap.appendChild(bubble);

    // Hotel recommendation cards
    var hotels = Array.isArray(data.recommendedHotels) ? data.recommendedHotels : [];
    if (hotels.length > 0) {
      var cards = this._buildHotelCards(hotels);
      wrap.appendChild(cards);
      this._track('big_dodo_recommendations', { count: hotels.length });
    }

    // Affiliate disclosure
    if (data.affiliateDisclosure && hotels.length > 0) {
      var disc = document.createElement('p');
      disc.className = 'bd-disclosure';
      disc.textContent = data.affiliateDisclosure;
      wrap.appendChild(disc);
    }

    this._messages.appendChild(wrap);
    this._scrollBottom();
  };

  BigDodo.prototype._buildHotelCards = function (hotels) {
    var self  = this;
    var wrap  = document.createElement('div');
    wrap.className = 'bd-hotel-cards';

    hotels.forEach(function (h) {
      var card = document.createElement('div');
      card.className = 'bd-hotel-card';

      var scoreStr = h.score ? h.score + '/10' : '';
      var metaStr  = [h.region, scoreStr].filter(Boolean).join(' · ');

      var hasCta = h.bookingUrl && safeUrl(h.bookingUrl) !== '#invalid';

      card.innerHTML =
        '<div class="bd-hotel-card__name">' + esc(h.name) + '</div>' +
        (metaStr ? '<div class="bd-hotel-card__meta">' + esc(metaStr) + '</div>' : '') +
        '<div class="bd-hotel-card__reason">' + esc(h.reason) + '</div>' +
        (hasCta
          ? '<a href="' + esc(safeUrl(h.bookingUrl)) + '" rel="nofollow sponsored" target="_blank" class="bd-hotel-card__cta" aria-label="Check prices for ' + esc(h.name) + ' on Expedia">Check prices →</a>'
          : '');

      // Analytics on booking click
      var link = card.querySelector('.bd-hotel-card__cta');
      if (link) {
        link.addEventListener('click', function () {
          self._track('big_dodo_booking_click', { hotel: h.name });
        });
      }

      wrap.appendChild(card);
    });

    return wrap;
  };

  BigDodo.prototype._appendError = function (text) {
    var wrap = document.createElement('div');
    wrap.className = 'bd-msg bd-msg--assistant';
    var err = document.createElement('div');
    err.className = 'bd-error';
    err.textContent = text;
    wrap.appendChild(err);
    this._messages.appendChild(wrap);
    this._scrollBottom();
  };

  // ── Typing indicator ─────────────────────────────────────────────────────

  BigDodo.prototype._showTyping = function () {
    this.isBusy = true;
    this._sendBtn.disabled = true;
    this._typing.classList.add('bd-typing--visible');
    this._messages.appendChild(this._typing);
    this._scrollBottom();
  };

  BigDodo.prototype._hideTyping = function () {
    this.isBusy = false;
    this._sendBtn.disabled = false;
    this._typing.classList.remove('bd-typing--visible');
  };

  // ── Suggested prompts ────────────────────────────────────────────────────

  BigDodo.prototype._renderSuggestions = function () {
    var self = this;
    this._suggestions.innerHTML = '';

    SUGGESTIONS.forEach(function (text) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bd-suggestion';
      btn.textContent = text;
      btn.addEventListener('click', function () {
        self._input.value = text;
        self._send();
      });
      self._suggestions.appendChild(btn);
    });
  };

  BigDodo.prototype._hideSuggestions = function () {
    this._suggestions.innerHTML = '';
  };

  // ── Session history ──────────────────────────────────────────────────────

  BigDodo.prototype._renderHistory = function () {
    var self = this;
    this._messages.innerHTML = '';
    this.history.slice(-MAX_HISTORY).forEach(function (turn) {
      self._appendMessage(turn.role, turn.content);
    });
  };

  BigDodo.prototype._saveHistory = function () {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.history.slice(-MAX_HISTORY)));
    } catch (_) {}
  };

  BigDodo.prototype._loadHistory = function () {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      this.history = raw ? JSON.parse(raw) : [];
    } catch (_) {
      this.history = [];
    }
  };

  // ── Scroll ───────────────────────────────────────────────────────────────

  BigDodo.prototype._scrollBottom = function () {
    var el = this._messages;
    requestAnimationFrame(function () {
      el.scrollTop = el.scrollHeight;
    });
  };

  // ── Analytics ────────────────────────────────────────────────────────────

  BigDodo.prototype._track = function (eventName, params) {
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, Object.assign({ event_category: 'big_dodo' }, params || {}));
      }
    } catch (_) {}
  };

  // ── Bootstrap ────────────────────────────────────────────────────────────

  function init() {
    // Don't double-init
    if (document.querySelector('[data-big-dodo]')) return;
    window._bigDodo = new BigDodo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
