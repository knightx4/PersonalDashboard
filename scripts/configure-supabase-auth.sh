#!/usr/bin/env bash
#
# Set Supabase Auth Site URL and redirect allow-list for this app.
#
# Requires a personal access token (not the anon/service-role keys):
#   https://supabase.com/dashboard/account/tokens
#
#   export SUPABASE_ACCESS_TOKEN=sbp_...
#   ./scripts/configure-supabase-auth.sh
#
# Optional overrides:
#   PROJECT_REF=asjztutnqxbecruvyrbj
#   SITE_URL=https://dash.selveyknight.com
#   EXTRA_REDIRECTS='https://other.example/auth/callback'
#
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-asjztutnqxbecruvyrbj}"
SITE_URL="${SITE_URL:-https://dash.selveyknight.com}"

# Every hostname the app is reachable on has to be on the allow-list, because
# Supabase silently falls back to Site URL for any `redirectTo` that is not --
# and a Site URL whose DNS record has been retired is how "a server with the
# specified hostname could not be found" appears *after* a successful Google
# consent. The wildcards cover Vercel's generated aliases (which change
# whenever the project is renamed) so a rename cannot break sign-in again.
VERCEL_PATTERNS="${VERCEL_PATTERNS:-https://*-knightx4s-projects.vercel.app/**,https://personal-dashboard*.vercel.app/**}"

die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || die "Set SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens)."

REDIRECTS="$(
  node -e "
    const site = process.env.SITE_URL;
    const split = (value) =>
      (value || '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const urls = [
      site + '/auth/callback',
      site + '/**',
      ...split(process.env.VERCEL_PATTERNS),
      'http://localhost:3000/auth/callback',
      ...split(process.env.EXTRA_REDIRECTS),
    ];
    process.stdout.write([...new Set(urls)].join(','));
  "
)"

echo "Project:   $PROJECT_REF"
echo "Site URL:  $SITE_URL"
echo "Redirects: $REDIRECTS"
echo

BODY="$(
  SITE_URL="$SITE_URL" REDIRECTS="$REDIRECTS" node -e "
    const body = {
      site_url: process.env.SITE_URL,
      uri_allow_list: process.env.REDIRECTS,
    };
    process.stdout.write(JSON.stringify(body));
  "
)"

HTTP_CODE="$(
  curl -sS -o /tmp/supabase-auth-config.json -w '%{http_code}' \
    -X PATCH \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$BODY"
)"

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "Auth config update failed (HTTP $HTTP_CODE):"
  cat /tmp/supabase-auth-config.json
  echo
  exit 1
fi

echo "Auth config updated."
node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('/tmp/supabase-auth-config.json', 'utf8'));
  console.log('site_url:', data.site_url || '(not in response)');
  console.log('uri_allow_list:', data.uri_allow_list || '(not in response)');
"
