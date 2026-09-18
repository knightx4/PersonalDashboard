/**
 * Environment access, validated at the point of use.
 *
 * Only NEXT_PUBLIC_* may reach the browser. The service role key and the token
 * encryption key are read through functions that throw if called from a client
 * bundle, so a bad import fails loudly rather than shipping a secret to users.
 *
 * Validation is deliberately LAZY. `next build` collects page data by importing
 * every route, so validating at module scope makes the build itself require
 * production secrets -- and when they are missing it fails inside a compiled
 * chunk with a stack trace that names no route and no variable. A build should
 * only need to compile; the app should tell you what is missing when it tries
 * to use it, in words. Hence the message below.
 */
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/**
 * Read as literal `process.env.X` property lookups, because that is the only
 * form Next inlines into the client bundle at build time. A destructure or a
 * dynamic key here would leave these undefined in the browser.
 */
function rawPublicEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

let cached: PublicEnv | null = null;

/**
 * The public environment, validated on first use.
 *
 * Throws a message naming exactly which variables are missing and where to set
 * them, because the alternative -- a Zod dump inside a bundled chunk -- costs
 * an hour to work out the first time you meet it.
 */
export function publicEnv(): PublicEnv {
  if (cached) return cached;

  const parsed = publicSchema.safeParse(rawPublicEnv());
  if (!parsed.success) {
    const missing = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Missing or invalid environment variables: ${missing.join(', ')}. ` +
        'Set them in the Vercel project settings (Settings -> Environment Variables) ' +
        'for every environment you deploy, or in .env.local when running locally. ' +
        'The Supabase values come from `npx supabase projects api-keys`; see docs/SETUP.md.',
    );
  }

  cached = parsed.data;
  return cached;
}

function assertServer(name: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(`${name} is server-only and must never reach the browser bundle`);
  }
}

export function serverEnv() {
  assertServer('serverEnv');
  return z
    .object({
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
      DATABASE_URL: z.string().min(1),
      /** 32 bytes, base64. Deliberately NOT the anon or service key. */
      TOKEN_ENCRYPTION_KEY: z.string().min(1),
      ANTHROPIC_API_KEY: z.string().min(1).optional(),
      GOOGLE_GMAIL_CLIENT_ID: z.string().min(1).optional(),
      GOOGLE_GMAIL_CLIENT_SECRET: z.string().min(1).optional(),
      /** Optional. Raises Google Books quota above the shared courtesy limit. */
      GOOGLE_BOOKS_API_KEY: z.string().min(1).optional(),
      /** Optional. ISBNdb — the catalog that carries brand-new releases. */
      ISBNDB_API_KEY: z.string().min(1).optional(),
      /** Gate for in-app bug reports and feature requests. */
      FEEDBACK_CODE: z.string().min(1).optional(),
      /** Bearer token for firing the Claude Code routine that works the queue. */
      CLAUDE_API_KEY: z.string().min(1).optional(),
      /** Legacy: the one routine both queues used. Falls back to it below. */
      CLAUDE_FEATURE_ROUTINE_ID: z.string().min(1).optional(),
      /** The routine "Run Feature Routine" fires -- the notes queue. */
      CLAUDE_NOTES_ROUTINE_ID: z.string().min(1).optional(),
      /** The routine "Send to Dash" and "Shape into a plan" fire. */
      CLAUDE_PLAN_ROUTINE_ID: z.string().min(1).optional(),
      /** Bearer for the notes routine. Scoped to it, not to the account. */
      CLAUDE_NOTES_ROUTINE_TOKEN: z.string().min(1).optional(),
      /** Bearer for the plan routine. Scoped to it, not to the account. */
      CLAUDE_PLAN_ROUTINE_TOKEN: z.string().min(1).optional(),
      /** BoardGameGeek approved-application token (bearer). */
      BGG_API_TOKEN: z.string().min(1).optional(),
      /** Optional. UPCitemdb paid key; the trial endpoint works without it. */
      UPCITEMDB_API_KEY: z.string().min(1).optional(),
      /** Optional. BookScouter (or similar) buyback aggregator. */
      BOOKSCOUTER_API_KEY: z.string().min(1).optional(),
      /** Optional. eBay Browse API (OAuth client credentials). */
      EBAY_CLIENT_ID: z.string().min(1).optional(),
      EBAY_CLIENT_SECRET: z.string().min(1).optional(),
      /** 32-80 chars of [A-Za-z0-9_-]. Shared with eBay, hashed into the reply. */
      EBAY_VERIFICATION_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,80}$/).optional(),
      /** Only when the registered endpoint is not NEXT_PUBLIC_APP_URL's. */
      EBAY_DELETION_ENDPOINT_URL: z.string().url().optional(),
      INNGEST_EVENT_KEY: z.string().optional(),
      INNGEST_SIGNING_KEY: z.string().optional(),
      /**
       * Optional. The domain Mailgun receives newsletters on, e.g.
       * `in.example.com`. Without it the News workspace has no address to
       * show and nothing can be delivered. docs/SETUP.md has the DNS.
       */
      NEWS_MAIL_DOMAIN: z.string().min(3).optional(),
      /** Optional. Mailgun's HTTP webhook signing key. Not the API key. */
      MAILGUN_SIGNING_KEY: z.string().min(1).optional(),
    })
    .parse(process.env);
}
