# Trending Engine — Deployment Guide

## Prerequisites

1. **GA4 property** with Measurement ID `G-TN713HPVCQ` (already wired in `analytics.js`)
2. **Google Cloud service account** with the Analytics Data API enabled
3. **GA4 numeric Property ID** (different from the Measurement ID)
4. **Custom dimension** `hotel_id` registered in GA4 (for event-level data)

---

## Step 1 — Find your GA4 numeric Property ID

GA4 Admin → Property Settings → "Property ID" (a number like `12345678`).  
This is **not** the same as the Measurement ID (`G-TN713HPVCQ`).

---

## Step 2 — Create a Google Cloud Service Account

```bash
# In Google Cloud Console → IAM → Service Accounts → Create
# Name: mrf-analytics-reader
# Role: none (we add it in GA4 directly)
# Create JSON key → download → save as sa-key.json
```

In **GA4 Admin → Property → Property Access Management**, add the service account email with **Viewer** role.

---

## Step 3 — Register the `hotel_id` custom dimension

GA4 Admin → Property → Custom Definitions → Custom Dimensions → Create:

| Field | Value |
|---|---|
| Dimension name | `hotel_id` |
| Scope | Event |
| Event parameter | `hotel_id` |

This allows the Data API to query `hotel_id` across `resort_click`, `wishlist_add`, `compare_add` events.

---

## Step 4 — Set environment variables

### Cloudflare Pages

Dashboard → Settings → Environment Variables → Add:

| Variable | Value |
|---|---|
| `GA4_PROPERTY_ID` | `12345678` (your numeric property ID) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Base64-encoded JSON key (see below) |

**Encode the key:**
```bash
base64 -i sa-key.json | tr -d '\n'
```

Copy the output as the value for `GOOGLE_SERVICE_ACCOUNT_KEY`.

### Local development

```bash
export GA4_PROPERTY_ID=12345678
export GOOGLE_SERVICE_ACCOUNT_KEY=$(base64 -i sa-key.json | tr -d '\n')
node site_builder.js
```

---

## Step 5 — Verify

After setting env vars and running a build:

```bash
node site_builder.js --verbose
# Expected output:
# ✓ trending.json (source: ga4_api, 6 trending hotels)
```

Check `dist/assets/data/trending.json` — `"source"` should be `"ga4_api"`.

---

## Graceful degradation

| Scenario | Behaviour |
|---|---|
| No env vars | Default rating-based data (source: `default`) |
| API error | Stale cache if available (source: `cache_stale`), else default |
| Cache < 23h old | Return cache instantly, skip API call (source: `cache`) |
| Cache > 23h + API up | Fetch GA4, update cache, return fresh data (source: `ga4_api`) |

The widget never shows an error to users — it silently disappears if data cannot be loaded.

---

## Cache management

Cache lives at `data/trending-cache.json`. It is checked into git as a **fallback** during cold Cloudflare deployments when no API credentials are set.

To force a full refresh on next build:
```bash
rm data/trending-cache.json
node site_builder.js
```

---

## Testing the API locally

```bash
export GA4_PROPERTY_ID=12345678
export GOOGLE_SERVICE_ACCOUNT_KEY=$(base64 -i sa-key.json | tr -d '\n')
node -e "
const { generateTrendingData } = require('./ga4_trending_engine.js');
const harness = require('./integration_harness.js');
generateTrendingData(harness.HOTEL_DATASET, { forceRefresh: true }).then(d => {
  console.log('source:', d.source);
  console.log('trending:', d.trending.map(h => h.name));
});
"
```

---

## Events being tracked

The following events feed the trending engine once the custom dimension is set up:

| Event | Fired from | Parameters |
|---|---|---|
| `resort_click` | `hotel-tracking.js` on hotel card link clicks | `hotel_id`, `hotel_name`, `click_type`, `page_path` |
| `wishlist_add` | `resort-map.js` on map wishlist button | `hotel_id` |
| `compare_add` | `resort-map.js` on map compare button | `hotel_id`, `hotel_name` |
| `page_view` | GA4 automatic (no code needed) | `page_path` includes `/hotels/{slug}/` |

`page_view` data is always available without custom dimensions — it provides the trending baseline. Custom event data (wishlist, compare, clicks) becomes available once the `hotel_id` dimension is registered.

---

## Recommended Cloudflare Pages build settings

| Setting | Value |
|---|---|
| Build command | `node site_builder.js` |
| Output directory | `dist` |
| Node.js version | `20.x` |
| Environment variables | `GA4_PROPERTY_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` |

Cloudflare Pages triggers a new build on every `git push` to `main`. The trending data refreshes automatically with each build (at most once per 23 hours due to cache TTL).
