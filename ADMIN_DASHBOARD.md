# Admin Dashboard

Secure Express.js admin panel for managing hotel records, images, and site builds.

## Quick start

```bash
# 1. Copy env file and fill in SESSION_SECRET
cp .env.example .env

# 2. Create your superuser (first-run only)
npm run setup-admin

# 3. Start the server
npm run admin         # http://localhost:3001/admin
```

## Architecture

```
admin/
  server.js        — Express app, session, CSRF, route mounts
  db.js            — SQLite Promise wrapper + schema migrations
  adapter.js       — Merges admin DB → data/hotels.json before builds
  setup.js         — Interactive first-run superuser creation
  middleware/
    auth.js        — requireAuth, csrfMiddleware, validateCsrf, audit()
  routes/
    auth.js        — GET/POST /admin/login, POST /admin/logout
    hotels.js      — Hotel CRUD + image upload/delete/reorder
    build.js       — POST /admin/build (spawns site_builder.js), GET /admin/build/stream (SSE)
    audit.js       — Paginated audit log viewer
  views/           — EJS templates using express-ejs-layouts
  data/            — SQLite databases (gitignored)
  uploads/         — Uploaded hotel images (gitignored)
```

## npm scripts

| Command | Action |
|---------|--------|
| `npm run admin` | Start admin server on port 3001 |
| `npm run setup-admin` | Create initial superuser account |
| `npm run test:admin` | Run admin test suite (19 tests) |

## Security model

- **Authentication**: bcrypt (cost 12) password hashing, express-session with SQLite store
- **CSRF**: per-session token injected into every form via `<%= csrfToken %>` hidden field
- **Sessions**: `httpOnly`, `sameSite: strict`, `secure` in production, 8-hour expiry, regenerated on login
- **Image uploads**: MIME type + file extension allowlist (JPEG, PNG, WebP), 10 MB limit, 5 images per hotel, crypto-random filenames
- **Audit log**: every CREATE / UPDATE / DELETE / LOGIN action is recorded with user, IP, and timestamp

## Hotel → site pipeline

The **Upload & Rank** button in the admin UI:

1. Calls `adapter.mergeAndWrite()` — exports admin hotels from SQLite and merges them into `data/hotels.json` (admin records override existing entries by name; new records are appended)
2. Spawns `node site_builder.js --verbose` from the project root
3. Streams stdout/stderr back to the browser via Server-Sent Events

## Image uploads

Images are stored at `admin/uploads/hotels/{hotel_id}/{random-hex}.{ext}` and served at `/admin/uploads/hotels/...` (behind `requireAuth`). They are currently for admin reference only — the static site uses images from `assets/images/ambient/`.

## Environment variables

| Variable | Required | Default |
|----------|----------|---------|
| `SESSION_SECRET` | Yes (in production) | hardcoded fallback |
| `ADMIN_PORT` | No | `3001` |

See `.env.example` for a complete template.

## Database schema

Three tables in `admin/data/admin.db`:

- **users** — `id, username, password_hash, role, created_at`
- **hotels** — `id, slug, name, affiliate_url, location, region, star_rating, price_per_night_usd, description_override, created_at, updated_at`
- **hotel_images** — `id, hotel_id, filename, alt_text, display_order`
- **audit_log** — `id, user_id, username, action, entity_type, entity_id, detail, ip_address, created_at`
- **build_log** — `id, triggered_by, status, started_at, finished_at, duration_ms, exit_code, output`
