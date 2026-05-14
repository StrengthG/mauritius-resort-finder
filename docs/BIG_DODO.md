# Big Dodo — AI Resort Concierge

Big Dodo is an AI-powered chat widget embedded on every page of Mauritius Resort Finder. It answers visitor questions about luxury resorts using only verified internal data, and recommends hotels with affiliate booking links when appropriate.

---

## Architecture

```
Browser (widget)  →  POST /api/chat  →  Cloudflare Pages Function  →  Claude claude-haiku-4-5-20251001
                                              ↓
                                     Hotel context retrieved
                                     from embedded data
                                              ↓
                                     Structured JSON response
                                     returned to widget
```

### Files

| File | Purpose |
|---|---|
| `assets/js/big_dodo_widget.js` | Frontend widget (vanilla JS, no deps) |
| `assets/css/big_dodo_widget.css` | Widget styles (dark luxury aesthetic) |
| `functions/api/chat.js` | Cloudflare Pages Function — POST /api/chat |
| `functions/api/_hotel_data.js` | Hotel data bundled for the function (auto-generated) |

---

## Setup

### 1. Set the API key secret

In the **Cloudflare Dashboard**:

1. Go to **Pages → mauritius-resort-finder → Settings → Environment variables**
2. Add a new **encrypted** variable:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key
   - Environment: Production **and** Preview

The key is never exposed to the client — it lives only in the Pages Function runtime.

### 2. Deploy

Push to `main`. Cloudflare Pages automatically builds and deploys both the static site and the Pages Functions from the `functions/` directory.

```bash
git push origin main
```

The widget appears on every page at `https://mauritiusresortfinder.com`. The API is live at `https://mauritiusresortfinder.com/api/chat`.

---

## How it works

### Frontend (widget)

- A floating gold button appears in the bottom-right corner of every page.
- Clicking it opens a chat panel with a welcome message and five suggested prompts.
- The user types a question; the widget POSTs to `/api/chat`.
- The function returns a JSON response with an answer and up to three hotel recommendations.
- Hotel recommendations render as cards with scores, a reason, and a "Check prices →" affiliate link.
- Session history is persisted in `sessionStorage` (cleared when the tab closes).

### Backend (Pages Function)

1. Validates the request payload (message length, JSON structure).
2. Runs keyword-based intent detection on the user's question (honeymoon, family, wellness, beach, value, remote work, golf, private).
3. Detects any region mentioned (Grand Baie, Belle Mare, etc.).
4. Scores and ranks all 29 hotels by relevance to the detected intents and region.
5. Formats the top 9 hotels as a text context block.
6. Calls Claude claude-haiku-4-5-20251001 with the system prompt + hotel context + conversation history.
7. Parses Claude's JSON response and sanitises it before returning.

### System prompt rules

Big Dodo is instructed to:
- Use **only** the hotel data provided in context.
- Say **"I don't know based on the information currently available to me."** when unsupported.
- Never invent amenities, prices, or policies.
- Keep answers to 2–4 sentences.
- Always disclose affiliate relationships when recommending hotels.

---

## Updating hotel data

When `data/hotels.json` changes, regenerate the bundled data for the function:

```bash
node -e "
const hotels = require('./data/hotels.json').filter(h => h._status !== 'inactive');
const compact = hotels.map(h => ({
  id: h.hotel_id, name: h.hotel_name, region: h.region,
  overall: h.overall_rating, location: h.location_score,
  amenity: h.amenity_score, brand: h.brand_score, value: h.value_score,
  reviews: h.review_count, avgRating: h.avg_rating,
  price: h.price_per_night_usd, stars: h.star_rating,
  amenities: h.amenities,
  link: h._affiliate_links?.[0]?.booking_url || null,
}));
const fs = require('fs');
fs.writeFileSync('./functions/api/_hotel_data.js',
  'export const HOTELS = ' + JSON.stringify(compact, null, 2) + ';\n');
console.log('Done —', compact.length, 'hotels written');
"
```

Then commit and push.

---

## Analytics events

All events are sent to Google Analytics (GA4) via `window.gtag`:

| Event | Trigger |
|---|---|
| `big_dodo_open` | Widget opened |
| `big_dodo_question` | User sends a message |
| `big_dodo_response` | Bot responds (includes `confidence` param) |
| `big_dodo_recommendations` | Hotels recommended (includes `count` param) |
| `big_dodo_booking_click` | "Check prices →" link clicked (includes `hotel` param) |

---

## Supported question types

- Best honeymoon / couples resort
- Family-friendly hotels
- Resorts with spa / wellness facilities
- Best beach / lagoon location
- Best value luxury stays
- Quiet / private / secluded resorts
- Regional recommendations (Grand Baie, Belle Mare, Cap Malheureux, etc.)
- Hotel comparisons
- Remote-work-friendly hotels
- Golf resorts

---

## Security

- User input is HTML-escaped before rendering (no `innerHTML` with raw input).
- The API key lives only in the Cloudflare Function runtime — never in client code.
- Booking URLs are validated (`safeUrl()`) before being set as `href` attributes.
- Message length is capped at 600 characters on both client and server.
- Conversation history is stored in `sessionStorage` (not `localStorage`) — cleared on tab close.
- CORS is restricted to `mauritiusresortfinder.com` and `www.mauritiusresortfinder.com`.

---

## Model

Big Dodo uses **Claude claude-haiku-4-5-20251001** (`claude-haiku-4-5-20251001`) — Anthropic's fastest, most cost-efficient model. At typical chat volumes this costs less than $0.01 per 100 conversations.

To upgrade to a more capable model, change `MODEL` in `functions/api/chat.js`:
```js
const MODEL = 'claude-sonnet-4-6';  // more capable, higher cost
```
