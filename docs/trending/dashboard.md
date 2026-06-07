# Trending Engine — GA4 Dashboard Examples

These queries can be run in GA4 Explore or the Data API to monitor resort engagement.

---

## Dashboard 1 — Trending Resorts (7-day rolling)

**In GA4 Explore → Free Form:**

| Setting | Value |
|---|---|
| Date range | Last 7 days |
| Dimensions | Page path |
| Metrics | Views |
| Filters | Page path starts with `/hotels/` |
| Sort | Views descending |

**Expected output:** Hotel detail pages ranked by traffic — the raw signal for "trending".

**API equivalent:**
```json
{
  "dateRanges": [{ "startDate": "7daysAgo", "endDate": "today" }],
  "dimensions": [{ "name": "pagePath" }],
  "metrics":    [{ "name": "screenPageViews" }],
  "dimensionFilter": {
    "filter": {
      "fieldName": "pagePath",
      "stringFilter": { "matchType": "BEGINS_WITH", "value": "/hotels/" }
    }
  },
  "orderBys": [{ "metric": { "metricName": "screenPageViews" }, "desc": true }],
  "limit": 10
}
```

---

## Dashboard 2 — Fastest Growing (week-over-week)

**Compare two date ranges in GA4 Explore:**

| Setting | Value |
|---|---|
| Date range 1 | Last 7 days |
| Date range 2 | Previous 7 days |
| Dimensions | Page path |
| Metrics | Views, Views (comparison) |
| Filters | Page path starts with `/hotels/` |

Sort by `% change` column to find the steepest risers.

**Reading the output:**
- `+200%` or higher → new content discovery or viral share
- `+50–100%` → healthy organic growth
- Negative % → investigate: is the page broken? Did it drop from sitemaps?

---

## Dashboard 3 — Most Compared (30-day, custom events)

*Requires `hotel_id` custom dimension registered in GA4.*

**GA4 Explore → Free Form:**

| Setting | Value |
|---|---|
| Date range | Last 30 days |
| Dimensions | `hotel_id` (custom event dimension), Event name |
| Metrics | Event count |
| Filters | Event name = `compare_add` |
| Sort | Event count descending |

**API equivalent:**
```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "today" }],
  "dimensions": [
    { "name": "customEvent:hotel_id" },
    { "name": "eventName" }
  ],
  "metrics": [{ "name": "eventCount" }],
  "dimensionFilter": {
    "filter": {
      "fieldName": "eventName",
      "stringFilter": { "value": "compare_add" }
    }
  },
  "orderBys": [{ "metric": { "metricName": "eventCount" }, "desc": true }],
  "limit": 10
}
```

---

## Dashboard 4 — Most Saved (wishlist_add, 30-day)

Same as Dashboard 3 but filter on `wishlist_add`:

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "today" }],
  "dimensions": [{ "name": "customEvent:hotel_id" }],
  "metrics":    [{ "name": "eventCount" }],
  "dimensionFilter": {
    "filter": {
      "fieldName": "eventName",
      "stringFilter": { "value": "wishlist_add" }
    }
  },
  "orderBys": [{ "metric": { "metricName": "eventCount" }, "desc": true }],
  "limit": 10
}
```

---

## Dashboard 5 — Resort Click-Through Rate (per listing page)

**Which persona pages drive the most hotel clicks?**

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "today" }],
  "dimensions": [{ "name": "pagePath" }, { "name": "eventName" }],
  "metrics":    [{ "name": "eventCount" }, { "name": "screenPageViews" }],
  "dimensionFilter": {
    "andGroup": {
      "expressions": [
        {
          "filter": {
            "fieldName": "eventName",
            "stringFilter": { "value": "resort_click" }
          }
        }
      ]
    }
  }
}
```

Divide `resort_click` count by `screenPageViews` per page path to get CTR.

---

## Dashboard 6 — Trending Widget Engagement

**How often do trending card clicks convert to hotel views?**

| Event | Meaning |
|---|---|
| `trending_click` | User clicked a hotel card in the trending widget |
| `page_view` on `/hotels/{slug}/` | Arrived at hotel detail page |

**Query:**
```json
{
  "dateRanges": [{ "startDate": "7daysAgo", "endDate": "today" }],
  "dimensions": [
    { "name": "customEvent:hotel_id" },
    { "name": "customEvent:list_type" }
  ],
  "metrics":    [{ "name": "eventCount" }],
  "dimensionFilter": {
    "filter": {
      "fieldName": "eventName",
      "stringFilter": { "value": "trending_click" }
    }
  },
  "orderBys": [{ "metric": { "metricName": "eventCount" }, "desc": true }],
  "limit": 20
}
```

`list_type` values: `trending`, `fastest_growing`, `most_compared`, `most_saved`, `also_trending`.

---

## Dashboard 7 — Map Engagement Funnel

Track how users move through the discovery map:

| Event | Step |
|---|---|
| `map_open` | Visited `/map/` and map rendered |
| `marker_click` | Tapped a resort marker |
| `filter_change` | Used region/category filter |
| `compare_add` | Started a comparison |
| `page_view` on `/compare/…` | Completed comparison |
| `wishlist_add` | Saved to wishlist |

In GA4 Explore → Funnel Exploration, set these as funnel steps to measure drop-off at each stage.

---

## Interpreting the `source` field in `trending.json`

| Value | Meaning | Action |
|---|---|---|
| `ga4_api` | Live data from GA4 | ✅ All good |
| `cache` | Cached data < 23 hours old | ✅ Expected between builds |
| `cache_stale` | API failed, using old cache | ⚠ Check `GA4_PROPERTY_ID` and service account |
| `default` | No API, no cache — rating-based | ⚠ Set up GA4 credentials |

Check `generated_at` in `trending.json` to see when data was last refreshed.
