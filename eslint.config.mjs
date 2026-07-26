import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The service-role client bypasses RLS entirely, so the boundary around it is
 * enforced mechanically rather than by convention. Only inngest/ and scripts/
 * may import it -- see the header comment in lib/db/admin.ts.
 */
const serviceRoleBoundary = {
  files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/auth/**/*.ts", "proxy.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/db/admin", "@/lib/db/admin"],
            message:
              "The service-role client bypasses RLS. Import it only from inngest/ or scripts/, and filter by user_id explicitly there. Use lib/auth/server.ts here instead.",
          },
        ],
      },
    ],
  },
};

/** Money math lives in lib/money.ts. Nowhere else formats currency. */
const moneyBoundary = {
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
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  serviceRoleBoundary,
  moneyBoundary,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
