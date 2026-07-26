#!/usr/bin/env bash
#
# Provision the Supabase project and apply every migration.
#
# RUN THIS ON YOUR OWN MACHINE, not in a Claude Code web session -- the login
# step opens a browser, and the sandboxed session cannot reach api.supabase.com
# anyway.
#
#   ./scripts/provision-supabase.sh
#
# It logs you in, creates the project, waits for it to come up, applies the
# migrations in supabase/migrations, and prints the block of environment
# variables to paste back.
#
# Everything it does is reproducible from this repo. Nothing is clicked into a
# dashboard, which is what keeps the database rebuildable.
set -euo pipefail

SUPABASE="npx --yes supabase@latest"
PROJECT_NAME="${PROJECT_NAME:-shopping-manager}"
REGION="${REGION:-us-east-1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

command -v npx >/dev/null || die "Node and npx are required."
command -v openssl >/dev/null || die "openssl is required."
command -v node >/dev/null || die "Node is required."

# Parse a JSON document from stdin with a small node expression.
# Keeps the script free of a jq dependency.
json_get() {
  local expr="$1"
  node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = (${expr});
    if (out === undefined || out === null || out === '') process.exit(2);
    if (typeof out === 'string' || typeof out === 'number' || typeof out === 'boolean') {
      process.stdout.write(String(out));
    } else {
      process.stdout.write(JSON.stringify(out));
    }
  "
}

# ---------------------------------------------------------------------------
say "1/6  Signing in to Supabase"
# ---------------------------------------------------------------------------
if $SUPABASE projects list >/dev/null 2>&1; then
  echo "Already signed in."
else
  echo "A browser window will open. Approve the login, then come back here."
  $SUPABASE login
fi

# ---------------------------------------------------------------------------
say "2/6  Choosing an organization"
# ---------------------------------------------------------------------------
$SUPABASE orgs list
echo
read -r -p "Paste the organization ID you want to use: " ORG_ID
[ -n "$ORG_ID" ] || die "An organization ID is required."

# ---------------------------------------------------------------------------
say "3/6  Creating the project"
# ---------------------------------------------------------------------------
# Generated here rather than chosen, so it is strong and ends up in the env
# block below rather than in someone's password manager as an afterthought.
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"

echo "Name:     $PROJECT_NAME"
echo "Region:   $REGION   (override with REGION=eu-west-2 ./scripts/provision-supabase.sh)"
echo "Password: $DB_PASSWORD"
echo
echo "SAVE THAT PASSWORD NOW. Supabase will not show it to you again."
read -r -p "Press enter to create the project… "

CREATE_JSON="$(
  $SUPABASE projects create "$PROJECT_NAME" \
    --org-id "$ORG_ID" \
    --db-password "$DB_PASSWORD" \
    --region "$REGION" \
    --output-format json
)"

PROJECT_REF="$(printf '%s' "$CREATE_JSON" | json_get 'data.id ?? data.ref ?? data.project_ref' 2>/dev/null || true)"

if [ -z "$PROJECT_REF" ]; then
  # Older CLIs printed a human table; fall back to listing and matching by name.
  for _ in $(seq 1 60); do
    LIST_JSON="$($SUPABASE projects list --output-format json 2>/dev/null || true)"
    PROJECT_REF="$(
      printf '%s' "$LIST_JSON" | node -e "
        const fs = require('fs');
        const name = process.argv[1];
        let raw = fs.readFileSync(0, 'utf8');
        if (!raw.trim()) process.exit(2);
        let data = JSON.parse(raw);
        // TS CLI wraps as { projects: [...] } or { data: [...] }; Go emitted an array.
        const list = Array.isArray(data) ? data
          : Array.isArray(data.projects) ? data.projects
          : Array.isArray(data.data) ? data.data
          : Array.isArray(data.result) ? data.result
          : [];
        const match = list.find((p) => p && (p.name === name || p.project_name === name));
        if (!match) process.exit(2);
        const ref = match.id || match.ref || match.project_ref;
        if (!ref) process.exit(2);
        process.stdout.write(String(ref));
      " "$PROJECT_NAME" 2>/dev/null || true
    )"
    [ -n "$PROJECT_REF" ] && break
    sleep 5
  done
fi

if [ -z "$PROJECT_REF" ]; then
  $SUPABASE projects list
  read -r -p "Could not detect the project ref automatically. Paste it here: " PROJECT_REF
fi
[ -n "$PROJECT_REF" ] || die "A project ref is required."

# ---------------------------------------------------------------------------
say "4/6  Waiting for the project to come up"
# ---------------------------------------------------------------------------
echo "Project ref: $PROJECT_REF"
echo "New projects take a couple of minutes to finish provisioning."

for i in $(seq 1 60); do
  if $SUPABASE projects api-keys --project-ref "$PROJECT_REF" >/dev/null 2>&1; then
    echo "Project is up."
    break
  fi
  if [ "$i" -eq 60 ]; then
    die "Timed out waiting for the project to become ready."
  fi
  printf '\r  still provisioning… %ss' "$((i * 10))"
  sleep 10
done
echo

# ---------------------------------------------------------------------------
say "5/6  Applying migrations"
# ---------------------------------------------------------------------------
cd "$ROOT"
$SUPABASE link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD" --yes

# --include-all: the migrations are numbered 0001.. rather than timestamped,
# so the CLI is told to apply all of them rather than only those newer than the
# last recorded version.
$SUPABASE db push --include-all --yes

# ---------------------------------------------------------------------------
say "6/6  Keys"
# ---------------------------------------------------------------------------
KEYS_JSON="$($SUPABASE projects api-keys --project-ref "$PROJECT_REF" --reveal --output-format json)"

# Prefer the modern publishable/secret names; fall back to legacy anon/service_role.
ANON_KEY="$(
  printf '%s' "$KEYS_JSON" | node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    const keys = Array.isArray(data) ? data
      : Array.isArray(data.keys) ? data.keys
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data.result) ? data.result
      : [];
    const pick = (...names) => {
      for (const name of names) {
        const hit = keys.find((k) => k && (k.name === name || k.api_key_name === name));
        const value = hit && (hit.api_key || hit.apiKey || hit.key);
        if (value) return value;
      }
      return '';
    };
    process.stdout.write(pick('anon', 'publishable'));
  "
)"

SERVICE_KEY="$(
  printf '%s' "$KEYS_JSON" | node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    const keys = Array.isArray(data) ? data
      : Array.isArray(data.keys) ? data.keys
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data.result) ? data.result
      : [];
    const pick = (...names) => {
      for (const name of names) {
        const hit = keys.find((k) => k && (k.name === name || k.api_key_name === name));
        const value = hit && (hit.api_key || hit.apiKey || hit.key);
        if (value) return value;
      }
      return '';
    };
    process.stdout.write(pick('service_role', 'secret'));
  "
)"

if [ -z "$ANON_KEY" ] || [ -z "$SERVICE_KEY" ]; then
  echo "Could not parse keys automatically. Raw output:"
  echo
  $SUPABASE projects api-keys --project-ref "$PROJECT_REF" --reveal
  echo
  ANON_KEY="${ANON_KEY:-<anon / publishable key>}"
  SERVICE_KEY="${SERVICE_KEY:-<service_role / secret key>}"
fi

TOKEN_KEY="$(openssl rand -base64 32)"

cat <<BLOCK

--------------------------------------------------------------------------
Paste EVERYTHING below into .env.local (replace the file contents, or merge
with any values you already have). Do not commit .env.local.
--------------------------------------------------------------------------

NEXT_PUBLIC_SUPABASE_URL=https://${PROJECT_REF}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
NEXT_PUBLIC_APP_URL=http://localhost:3000
TOKEN_ENCRYPTION_KEY=${TOKEN_KEY}

# Database password (also needed for the DATABASE_URL below):
#   ${DB_PASSWORD}
#
# DATABASE_URL is not needed yet -- only the service-role Drizzle client uses
# it, and that arrives with the Inngest jobs at build step 12. When you do need
# it, copy the Session pooler string from
#   Dashboard -> Project Settings -> Database -> Connection string
# and substitute the password above.
#
# Optional until later build steps:
# ANTHROPIC_API_KEY=
# GOOGLE_GMAIL_CLIENT_ID=
# GOOGLE_GMAIL_CLIENT_SECRET=

--------------------------------------------------------------------------
Redirect URI for Google sign-in (docs/SETUP.md, Tier 1):
  https://${PROJECT_REF}.supabase.co/auth/v1/callback
--------------------------------------------------------------------------

BLOCK

say "Done"
echo "The keys above are secrets. Send them over something private, and"
echo "note that anything pasted into a chat session is stored with it."
echo
echo "Next: copy the block into .env.local, then:"
echo "  npm install"
echo "  npm run dev"
echo "Sign up with email/password at http://localhost:3000/signup"
