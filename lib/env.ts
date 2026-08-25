/**
 * Environment access, validated once at the boundary.
 *
 * Only NEXT_PUBLIC_* may reach the browser. The service role key and the token
 * encryption key are read through functions that throw if called from a client
 * bundle, so a bad import fails loudly at build time rather than shipping a
 * secret to users.
 */
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

/**
 * Safe in the browser. Referenced as literal `process.env.X` properties
 * because Next inlines NEXT_PUBLIC_* at build time only for static lookups.
 */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

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
      /** Optional. BookScouter (or similar) buyback aggregator. */
      BOOKSCOUTER_API_KEY: z.string().min(1).optional(),
      /** Optional. eBay Browse API (OAuth client credentials). */
      EBAY_CLIENT_ID: z.string().min(1).optional(),
      EBAY_CLIENT_SECRET: z.string().min(1).optional(),
      INNGEST_EVENT_KEY: z.string().optional(),
      INNGEST_SIGNING_KEY: z.string().optional(),
    })
    .parse(process.env);
}
