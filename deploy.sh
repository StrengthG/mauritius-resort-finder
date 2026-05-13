#!/bin/bash
# Luxury redesign deploy script — run once to commit & push
set -e
cd "$(dirname "$0")"

echo "🔓 Removing stale git lock files..."
rm -f .git/index.lock
rm -f .git/HEAD.lock
rm -f .git/COMMIT_EDITMSG.lock
find .git -name "*.lock" -delete
echo "   Locks cleared."

echo "📝 Committing staged changes..."
git commit -m "Luxury redesign: animated mobile-first UI upgrade

- Add assets/css/global.css — luxury design system (Playfair Display + Inter, deep navy/gold palette, scroll reveal, animations)
- Add assets/js/animations.js — scroll reveal, parallax hero, animated score bars, counter animations
- Add assets/js/interactions.js — sticky transparent nav, mobile hamburger menu, keyboard accessibility
- Redesign index.html — cinematic hero, animated trust bar, luxury hotel cards, stagger regions grid, shimmer CTAs, luxury footer
- Update static_page_renderer.js — Playfair Display + Inter fonts, luxury CSS tokens, gold gradient CTAs, hover lift, inline animation script for all 43 generated pages
- Update site_builder.js — copy assets/ to dist/assets/ at build time"

echo "🚀 Pushing to GitHub..."
git push origin main

echo "✅ Done! Cloudflare Pages will deploy automatically."
