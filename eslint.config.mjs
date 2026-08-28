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

/**
 * Pages, components and the proxy render for a signed-in user, so they must go
 * through RLS. They also must not care which ATS a role came from.
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
    "no-restricted-imports": ["error", { patterns: [SERVICE_ROLE_PATTERN, ATS_PATTERN] }],
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
    "no-restricted-imports": ["error", { patterns: [ATS_PATTERN] }],
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
  // Override default ignores of eslint-config-next.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
