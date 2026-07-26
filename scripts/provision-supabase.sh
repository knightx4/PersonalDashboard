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

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

command -v npx >/dev/null || die "Node and npx are required."

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

$SUPABASE projects create "$PROJECT_NAME" \
  --org-id "$ORG_ID" \
  --db-password "$DB_PASSWORD" \
  --region "$REGION"

# ---------------------------------------------------------------------------
say "4/6  Waiting for the project to come up"
# ---------------------------------------------------------------------------
PROJECT_REF=""
for _ in $(seq 1 60); do
  PROJECT_REF="$(
    $SUPABASE projects list --output json 2>/dev/null \
      | grep -o "\"id\":\"[^\"]*\"[^}]*\"name\":\"${PROJECT_NAME}\"" \
      | head -1 | sed 's/"id":"\([^"]*\)".*/\1/'
  )" || true

  if [ -z "$PROJECT_REF" ]; then
    # Fall back to asking, rather than guessing wrong.
    sleep 5
    continue
  fi
  break
done

if [ -z "$PROJECT_REF" ]; then
  $SUPABASE projects list
  read -r -p "Could not detect the project ref automatically. Paste it here: " PROJECT_REF
fi
[ -n "$PROJECT_REF" ] || die "A project ref is required."

echo "Project ref: $PROJECT_REF"
echo "New projects take a couple of minutes to finish provisioning."

for i in $(seq 1 60); do
  if $SUPABASE projects api-keys --project-ref "$PROJECT_REF" >/dev/null 2>&1; then
    echo "Project is up."
    break
  fi
  printf '\r  still provisioning… %ss' "$((i * 10))"
  sleep 10
done
echo

# ---------------------------------------------------------------------------
say "5/6  Applying migrations"
# ---------------------------------------------------------------------------
export SUPABASE_DB_PASSWORD="$DB_PASSWORD"
$SUPABASE link --project-ref "$PROJECT_REF"

# --include-all: the migrations are numbered 0001.. rather than timestamped,
# so the CLI is told to apply all of them rather than only those newer than the
# last recorded version.
$SUPABASE db push --include-all

# ---------------------------------------------------------------------------
say "6/6  Keys"
# ---------------------------------------------------------------------------
echo "Copy the anon / publishable key and the service_role / secret key:"
echo
$SUPABASE projects api-keys --project-ref "$PROJECT_REF" --reveal
echo
cat <<BLOCK

--------------------------------------------------------------------------
Paste this into .env.local, filling in the two keys from the table above.
--------------------------------------------------------------------------

NEXT_PUBLIC_SUPABASE_URL=https://${PROJECT_REF}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Database password (also needed for the DATABASE_URL below):
#   ${DB_PASSWORD}
#
# DATABASE_URL is not needed yet -- only the service-role Drizzle client uses
# it, and that arrives with the Inngest jobs at build step 12. When you do need
# it, copy the Session pooler string from
#   Dashboard -> Project Settings -> Database -> Connection string
# and substitute the password above.

--------------------------------------------------------------------------
Redirect URI for Google sign-in (docs/SETUP.md, Tier 1):
  https://${PROJECT_REF}.supabase.co/auth/v1/callback
--------------------------------------------------------------------------

BLOCK

say "Done"
echo "The two keys above are secrets. Send them over something private, and"
echo "note that anything pasted into a chat session is stored with it."
