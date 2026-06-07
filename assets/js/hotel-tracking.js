/* hotel-tracking.js — Resort click event tracking (CSP-safe event delegation) */

(function () {
  'use strict';

  function gtag() {
    if (typeof window.gtag === 'function') {
      window.gtag.apply(window, arguments);
    }
  }

  /* Extract hotel_id from nearest ancestor article with id="hotel-{id}" */
  function hotelIdFrom(el) {
    var article = el.closest('article[id^="hotel-"]');
    if (!article) return null;
    return article.id.replace(/^hotel-/, '');
  }

  /* Extract hotel name from nearest h2.hotel-card__name */
  function hotelNameFrom(el) {
    var article = el.closest('article[id^="hotel-"]');
    if (!article) return '';
    var h2 = article.querySelector('.hotel-card__name');
    return h2 ? h2.textContent.trim() : '';
  }

  /* Determine click type from class */
  function clickType(el) {
    if (el.classList.contains('hotel-card__cta-btn'))    return 'booking';
    if (el.classList.contains('hotel-card__review-btn')) return 'detail';
    if (el.classList.contains('ranking-summary__cta'))   return 'booking';
    if (el.classList.contains('ranking-summary__name'))  return 'detail';
    return 'unknown';
  }

  function init() {
    document.body.addEventListener('click', function (e) {
      var link = e.target.closest(
        '.hotel-card__cta-btn, .hotel-card__review-btn, .ranking-summary__cta, .ranking-summary__name'
      );
      if (!link) return;

      var hotelId   = hotelIdFrom(link);
      var hotelName = hotelNameFrom(link);
      if (!hotelId) return;

      gtag('event', 'resort_click', {
        hotel_id:   hotelId,
        hotel_name: hotelName,
        click_type: clickType(link),
        page_path:  window.location.pathname,
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
