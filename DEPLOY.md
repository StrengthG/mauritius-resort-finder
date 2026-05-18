# Deploying the Admin Dashboard to Railway

The admin dashboard (`admin/server.js`) is a Node.js Express app. It runs separately from the static site (which is built by `site_builder.js` and deployed to Cloudflare Pages).

---

## Prerequisites

- [Railway account](https://railway.app)
- Railway CLI: `npm install -g @railway/cli` then `railway login`
- A GitHub personal access token with **repo** write scope (for the Upload & Rank feature)

---

## First deploy

```bash
# 1. Create a new Railway project linked to this repo
railway init

# 2. Add a persistent volume for the SQLite database and uploads
#    In the Railway dashboard: your service → Storage → Add Volume
#    Mount path: /app/admin/data   (for the database)
#
#    Add a second volume if you use image uploads:
#    Mount path: /app/admin/uploads

# 3. Set environment variables (Railway dashboard → Variables, or CLI):
railway variables set NODE_ENV=production
railway variables set SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
railway variables set GITHUB_TOKEN=ghp_your_token_here
railway variables set GITHUB_REPO=StrengthG/mauritius-resort-finder
railway variables set GITHUB_BRANCH=main
# Optional — triggers Cloudflare Pages rebuild immediately after commit:
# railway variables set CLOUDFLARE_DEPLOY_HOOK_URL=https://api.cloudflare.com/client/v4/pages/webhooks/...

# 4. Deploy
railway up
```

Railway will auto-detect `railway.toml` and use `node admin/server.js` as the start command.

---

## Create the first admin user

After the first deploy, run setup remotely via Railway's exec:

```bash
railway run node admin/setup.js
```

This creates the initial super_admin account interactively.

---

## Custom domain

In the Railway dashboard: your service → Settings → Domains → Add Custom Domain.

Point your DNS (e.g. `admin.mauritiusresortfinder.com`) to the Railway-provided CNAME. Railway provisions HTTPS automatically.

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production` |
| `SESSION_SECRET` | Yes | Long random string for session signing |
| `ADMIN_PORT` | No | Defaults to Railway's `PORT` env var |
| `GITHUB_TOKEN` | Yes (prod) | GitHub PAT with `repo` write scope |
| `GITHUB_REPO` | Yes (prod) | `owner/repo` e.g. `StrengthG/mauritius-resort-finder` |
| `GITHUB_BRANCH` | No | Branch to commit to (default: `main`) |
| `CLOUDFLARE_DEPLOY_HOOK_URL` | No | Triggers immediate CF Pages rebuild |
| `AIRTABLE_API_KEY` | No | Only needed if using Airtable sync |
| `AIRTABLE_BASE_ID` | No | Only needed if using Airtable sync |

---

## How Upload & Rank works in production

When you click "Upload & Rank" in the admin dashboard with `NODE_ENV=production`:

1. Admin DB hotels are merged into `data/hotels.json` on disk
2. The file is committed to GitHub via the GitHub API (`PUT /repos/{owner}/{repo}/contents/data/hotels.json`)
3. Cloudflare Pages detects the commit and rebuilds the static site (~60–90 seconds)
4. Optionally, a Cloudflare deploy hook is also triggered for immediate rebuild

The commit message includes `[skip ci]` to avoid double-triggering CI pipelines.

---

## Persistent volumes (important)

Railway deployments are ephemeral — the filesystem resets on redeploy. Mount persistent volumes for:

- `/app/admin/data` — SQLite database (`admin.db`, `sessions.db`)
- `/app/admin/uploads` — Hotel images

Without these volumes, all hotel data and user accounts are lost on each deploy.

---

## Roles

| Role | Access |
|---|---|
| `super_admin` | Full access: hotels, images, builds, user management |
| `editor` | Hotels, images, builds — cannot manage users |

Create additional users in the admin UI: **Users → New User**.
