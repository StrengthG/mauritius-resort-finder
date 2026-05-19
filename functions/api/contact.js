/**
 * functions/api/contact.js
 * Mauritius Resort Finder — Contact Form API
 *
 * Route: POST /api/contact
 *
 * Cloudflare Pages Function. Validates form input, checks honeypot + rate
 * limit, then sends email via Resend (https://resend.com).
 *
 * Required env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   RESEND_API_KEY   — API key from resend.com
 *   CONTACT_EMAIL    — recipient (default: strengthygivenncube@gmail.com)
 *   EMAIL_FROM       — sender address on verified domain (default: noreply@mauritiusresortfinder.com)
 */

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// In-memory, per edge-instance. Provides meaningful protection; Cloudflare's
// WAF handles volumetric attacks across all edge locations.

const _rateStore = new Map();
const RATE_LIMIT  = 5;
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function _checkRateLimit(ip) {
  const now = Date.now();
  const timestamps = (_rateStore.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (timestamps.length >= RATE_LIMIT) {
    _rateStore.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  _rateStore.set(ip, timestamps);
  return true;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const NAME_RE    = /^[\p{L}\s'\-]+$/u;
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateContact({ name, email, message, website }) {
  // Honeypot — silent success, deny actual delivery
  if (typeof website === 'string' && website.length > 0) {
    return { ok: false, honeypot: true };
  }

  const errors = [];

  // Name
  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('Full name is required.');
  } else {
    const n = name.trim();
    if (n.length < 2)    errors.push('Name must be at least 2 characters.');
    if (n.length > 100)  errors.push('Name must be 100 characters or fewer.');
    if (!NAME_RE.test(n)) errors.push('Name may only contain letters, spaces, hyphens, and apostrophes.');
  }

  // Email
  if (!email || typeof email !== 'string' || !email.trim()) {
    errors.push('Email address is required.');
  } else {
    const e = email.trim();
    if (e.length > 254)      errors.push('Email address is too long.');
    if (!EMAIL_RE.test(e))   errors.push('Please enter a valid email address.');
  }

  // Message
  if (!message || typeof message !== 'string' || !message.trim()) {
    errors.push('Message is required.');
  } else {
    const m = message.trim();
    if (m.length < 10)   errors.push('Message must be at least 10 characters.');
    if (m.length > 5000) errors.push('Message must be 5,000 characters or fewer.');
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    name:    name.trim(),
    email:   email.trim(),
    message: message.trim(),
  };
}

// ─── HTML escape ──────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─── Email builder ────────────────────────────────────────────────────────────

function _buildEmailHtml({ name, email, message, ip, userAgent, timestamp }) {
  const messageHtml = _esc(message).replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Contact Form Submission</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%">
        <tr>
          <td style="background:linear-gradient(135deg,#08111f 0%,#0e1623 100%);padding:32px 40px">
            <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#c9a84c">Mauritius Resort Finder</p>
            <h1 style="margin:8px 0 0;font-size:22px;color:#f5e6c8;font-weight:700">New Contact Form Submission</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#374151;width:130px;vertical-align:top">Name</td>
                <td style="padding:10px 0 10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827">${_esc(name)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#374151;vertical-align:top">Email</td>
                <td style="padding:10px 0 10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px"><a href="mailto:${_esc(email)}" style="color:#c9a84c">${_esc(email)}</a></td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#374151;vertical-align:top">Submitted</td>
                <td style="padding:10px 0 10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280">${_esc(timestamp)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#374151;vertical-align:top">IP Address</td>
                <td style="padding:10px 0 10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280">${_esc(ip || 'Unknown')}</td>
              </tr>
            </table>
            <h2 style="margin:28px 0 12px;font-size:16px;font-weight:700;color:#111827">Message</h2>
            <div style="background:#f9fafb;border-left:4px solid #c9a84c;border-radius:4px;padding:16px 20px;font-size:14px;color:#374151;line-height:1.75">${messageHtml}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:11px;color:#9ca3af">Sent from the contact form at mauritiusresortfinder.com</p>
            <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;word-break:break-all">User-Agent: ${_esc((userAgent || '').substring(0, 200))}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── CORS helper ──────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://mauritiusresortfinder.com',
  'https://www.mauritiusresortfinder.com',
];

function _corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
  };
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: _corsHeaders(context.request) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = _corsHeaders(request);

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid request format.' }),
      { status: 400, headers }
    );
  }

  // Validate
  const v = validateContact({
    name:    body.name,
    email:   body.email,
    message: body.message,
    website: body.website,
  });

  if (!v.ok) {
    if (v.honeypot) {
      // Silent — don't reveal honeypot to bots
      return new Response(
        JSON.stringify({ success: true, message: 'Your message has been sent successfully.' }),
        { status: 200, headers }
      );
    }
    return new Response(
      JSON.stringify({ success: false, errors: v.errors }),
      { status: 400, headers }
    );
  }

  // Rate limit
  const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('X-Forwarded-For')
          || 'unknown';
  if (!_checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ success: false, message: 'Too many submissions. Please try again in an hour.' }),
      { status: 429, headers }
    );
  }

  // Require API key
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[contact] RESEND_API_KEY is not configured');
    return new Response(
      JSON.stringify({ success: false, message: 'Server configuration error. Please try again later.' }),
      { status: 500, headers }
    );
  }

  const fromEmail  = env.EMAIL_FROM    || 'noreply@mauritiusresortfinder.com';
  const toEmail    = env.CONTACT_EMAIL || 'strengthygivenncube@gmail.com';
  const userAgent  = request.headers.get('User-Agent') || '';
  const timestamp  = new Date().toUTCString();

  // Send via Resend
  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     `Mauritius Resort Finder <${fromEmail}>`,
        to:       [toEmail],
        reply_to: v.email,
        subject:  `New Contact Form Submission from ${v.name}`,
        html:     _buildEmailHtml({
          name:      v.name,
          email:     v.email,
          message:   v.message,
          ip,
          userAgent,
          timestamp,
        }),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error('[contact] Resend error:', emailRes.status, errBody);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to send message. Please try again later.' }),
        { status: 500, headers }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Your message has been sent successfully.' }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error('[contact] Fetch error:', err);
    return new Response(
      JSON.stringify({ success: false, message: 'Failed to send message. Please try again later.' }),
      { status: 500, headers }
    );
  }
}
