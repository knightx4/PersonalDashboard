import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Import and syntax boundaries for both halves of the app.
 *
 * The rules below are grouped by (rule, glob) rather than by subject, because
 * ESLint does not merge options for the same rule across config entries -- it
 * keeps the last one. Two entries setting `no-restricted-syntax` for
 * overlapping globs therefore means the first silently stops applying, with no
 * error anywhere. That is exactly the failure these rules exist to catch, so
 * tests/lint-boundaries.test.ts asserts they still fire.
 */

const SERVICE_ROLE_PATTERN = {
  group: [
    "**/db/admin",
    "@/lib/db/admin",
    "**/inngest/supabase-admin",
    "@/inngest/supabase-admin",
  ],
  message:
    "The service-role client bypasses RLS. Import it only from inngest/, scripts/, or a route handler that genuinely has no session -- and filter by user_id explicitly there. Use lib/auth/server.ts (or lib/jobs/auth/server.ts) here instead.",
};

const ATS_PATTERN = {
  group: [
    "**/jobs/ats/greenhouse",
    "**/jobs/ats/lever",
    "**/jobs/ats/ashby",
    "**/jobs/ats/generic",
  ],
  message:
    "Nothing outside lib/jobs/ats/ knows which ATS vendors exist. Go through lib/jobs/ats/index.ts.",
};

const VAULT_PROVIDER_PATTERN = {
  group: ["**/vault/providers/github", "@/lib/vault/providers/github"],
  message:
    "Nothing outside lib/vault/providers/ knows the vault lives in a git repository. Go through lib/vault/providers/index.ts.",
};

/**
 * The learn module is the only thing here that fetches a URL somebody else
 * chose, so the guard against reaching an internal address has to be
 * unavoidable. It is worth nothing if a second call site can be written beside
 * it without one.
 */
const LEARN_FETCH_PATTERN = {
  group: ["**/learn/providers/fetch", "@/lib/learn/providers/fetch"],
  message:
    "Nothing outside lib/learn/providers/ fetches an external URL. Go through lib/learn/providers/index.ts, which is where the address guard lives.",
};

/**
 * The shared link is a window, never an engine.
 *
 * A page an anonymous stranger can open must not be able to spend money, hit a
 * third party's rate limit, or queue work. Every module named here can do one
 * of those: lib/sell reaches eBay and, on the web-estimate path, a *billed*
 * Anthropic lookup; the game and book providers are rate-limited against
 * someone else's terms of service; lib/fx fetches Frankfurter; lib/email and
 * inngest are ingestion.
 *
 * The rule exists because "the price is missing, let's just fetch it" is a
 * reasonable-sounding change that would quietly turn every page view into an
 * outbound call, on a URL that can be forwarded to anyone. See
 * docs/SHARE-LINKS-SPEC.md.
 */
const SHARE_READ_NETWORK_PATTERN = {
  group: [
    "@/lib/sell/*", "**/lib/sell/*",
    "@/lib/games/providers/*", "**/games/providers/*",
    "@/lib/books/providers/*", "**/books/providers/*",
    "@/lib/email/*", "**/lib/email/*",
    "@/lib/fx/*", "**/lib/fx/*",
    "@/inngest/*", "**/inngest/*",
    "@anthropic-ai/sdk",
    "googleapis",
    "google-auth-library",
  ],
  message:
    "The shared link reads what is already in the database and does nothing else -- no lookup, no enrichment, no billed call, no job. A missing price renders blank; it is not a reason to go and find one. Enrichment belongs on the signed-in side, and lands in these tables before the link is ever opened.",
};

/**
 * Pages, components and the proxy render for a signed-in user, so they must go
 * through RLS. They also must not care which ATS a role came from, or where a
 * vault is stored.
 */
const renderBoundaries = {
  files: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "lib/auth/**/*.ts",
    "lib/jobs/auth/**/*.ts",
    "proxy.ts",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          SERVICE_ROLE_PATTERN,
          ATS_PATTERN,
          VAULT_PROVIDER_PATTERN,
          LEARN_FETCH_PATTERN,
        ],
      },
    ],
  },
};

/**
 * Both derived-number rules, in ONE entry.
 *
 * Money math lives in lib/money.ts and funnel math in lib/jobs/pipeline.ts.
 * They are unrelated rules over the same files, so they have to share a config
 * object -- split across two, the second would replace the first.
 */
const derivedNumberBoundaries = {
  files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
        message:
          "Format money through formatMoney() in lib/money.ts so cents, rounding and locale stay in one place.",
      },
      {
        selector: "BinaryExpression[operator='/'] MemberExpression[property.name='length']",
        message:
          "Compute funnel rates through lib/jobs/pipeline.ts so the denominator rules -- cohorting, the too-early window, per-source grouping -- stay in one tested place.",
      },
    ],
  },
};

/** The JD layer consumes the ATS interface; it never reaches past it either. */
const jdBoundary = {
  files: ["lib/jobs/jd/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [ATS_PATTERN] }],
  },
};

/**
 * The exceptions, listed one by one rather than left to a glob.
 *
 * These route handlers genuinely act without a session on someone's behalf:
 * Vercel Cron has no user, and removing an auth.users row is not something the
 * anon key can do. Each authenticates in its own way -- a shared secret for
 * cron, the session for deletion -- and each filters by user_id. The ATS rule
 * still applies to them.
 */
const serviceRoleExceptions = {
  files: ["app/api/cron/**/*.ts", "app/api/jobs/account/delete/route.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      { patterns: [ATS_PATTERN, VAULT_PROVIDER_PATTERN, LEARN_FETCH_PATTERN] },
    ],
  },
};

/**
 * The anonymous read path.
 *
 * NOTE the repeated pattern groups. `app/s/**` overlaps renderBoundaries'
 * glob, and ESLint keeps only the LAST entry setting a given rule for a file
 * rather than merging them -- so listing only the new group here would switch
 * the service-role, ATS and vault rules OFF for exactly the pages a stranger
 * can reach. That is the failure mode this file's header warns about, and the
 * one place it would hurt most.
 *
 * `no-restricted-globals` is safe to set alone: nothing else in this config
 * uses that rule, so there is nothing for it to replace. It bans bare fetch(),
 * which is the one way to reach the network without importing anything.
 */
const shareReadBoundaries = {
  files: ["app/s/**/*.{ts,tsx}", "app/api/s/**/*.ts", "lib/share/read/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          SERVICE_ROLE_PATTERN,
          ATS_PATTERN,
          VAULT_PROVIDER_PATTERN,
          SHARE_READ_NETWORK_PATTERN,
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      {
        name: "fetch",
        message:
          "The shared link never calls out. It reads cached rows and renders what is there -- see docs/SHARE-LINKS-SPEC.md.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  renderBoundaries,
  derivedNumberBoundaries,
  jdBoundary,
  // Must come after renderBoundaries: it narrows what that rule forbids.
  serviceRoleExceptions,
  // Must come after renderBoundaries too: it widens what that rule forbids,
  // and repeats its groups so nothing is lost in the replacement.
  shareReadBoundaries,
  // Override default ignores of eslint-config-next.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
