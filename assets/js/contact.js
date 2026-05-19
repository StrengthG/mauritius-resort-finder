/**
 * assets/js/contact.js
 * Contact form — client-side validation, async submission, UI feedback.
 */

(function () {
  'use strict';

  const form        = document.getElementById('contact-form');
  const submitBtn   = document.getElementById('contact-submit');
  const successBox  = document.getElementById('contact-success');
  const toast       = document.getElementById('contact-toast');
  const charCount   = document.getElementById('char-count');
  const msgInput    = document.getElementById('message');

  if (!form) return;

  // ─── Character counter ───────────────────────────────────────────────────

  if (msgInput && charCount) {
    msgInput.addEventListener('input', function () {
      const len = this.value.length;
      charCount.textContent = len + ' / 5000';
      charCount.classList.toggle('contact-char-count--warn', len > 4500);
    });
  }

  // ─── Inline error helpers ────────────────────────────────────────────────

  function setError(fieldId, msg) {
    const el = document.getElementById(fieldId + '-error');
    const input = document.getElementById(fieldId);
    if (el) { el.textContent = msg; el.hidden = !msg; }
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function clearErrors() {
    ['name', 'email', 'message'].forEach(function (id) { setError(id, ''); });
  }

  // ─── Client-side validation ──────────────────────────────────────────────

  const NAME_RE  = /^[\p{L}\s'\-]+$/u;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validate(data) {
    var errs = {};
    var n = (data.name || '').trim();
    var e = (data.email || '').trim();
    var m = (data.message || '').trim();

    if (!n)            errs.name = 'Full name is required.';
    else if (n.length < 2)  errs.name = 'Name must be at least 2 characters.';
    else if (n.length > 100) errs.name = 'Name must be 100 characters or fewer.';
    else if (!NAME_RE.test(n)) errs.name = 'Name may only contain letters, spaces, hyphens, and apostrophes.';

    if (!e)            errs.email = 'Email address is required.';
    else if (e.length > 254)  errs.email = 'Email address is too long.';
    else if (!EMAIL_RE.test(e)) errs.email = 'Please enter a valid email address.';

    if (!m)            errs.message = 'Message is required.';
    else if (m.length < 10) errs.message = 'Message must be at least 10 characters.';
    else if (m.length > 5000) errs.message = 'Message must be 5,000 characters or fewer.';

    return errs;
  }

  // ─── Toast ───────────────────────────────────────────────────────────────

  var toastTimer;
  function showToast(msg, type) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'contact-toast contact-toast--' + type + ' contact-toast--visible';
    toastTimer = setTimeout(function () {
      toast.classList.remove('contact-toast--visible');
    }, 6000);
  }

  // ─── Submit ──────────────────────────────────────────────────────────────

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();

    var data = {
      name:    document.getElementById('name').value,
      email:   document.getElementById('email').value,
      message: document.getElementById('message').value,
      website: document.getElementById('website') ? document.getElementById('website').value : '',
    };

    var errs = validate(data);
    var firstErrField = null;

    ['name', 'email', 'message'].forEach(function (id) {
      if (errs[id]) {
        setError(id, errs[id]);
        if (!firstErrField) firstErrField = id;
      }
    });

    if (firstErrField) {
      document.getElementById(firstErrField).focus();
      return;
    }

    // Loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('contact-btn--loading');
    submitBtn.querySelector('.btn-text').textContent = 'Sending...';

    fetch('/api/contact', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('contact-btn--loading');
        submitBtn.querySelector('.btn-text').textContent = 'Send Message';

        if (json.success) {
          form.style.display = 'none';
          if (successBox) { successBox.hidden = false; successBox.focus(); }
        } else if (json.errors && json.errors.length) {
          json.errors.forEach(function (msg) { showToast(msg, 'error'); });
        } else {
          showToast(json.message || 'Something went wrong. Please try again.', 'error');
        }
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.classList.remove('contact-btn--loading');
        submitBtn.querySelector('.btn-text').textContent = 'Send Message';
        showToast('Network error. Please check your connection and try again.', 'error');
      });
  });
}());
