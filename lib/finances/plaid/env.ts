import { z } from 'zod';

/**
 * Plaid's keys (plan #2593.3). Optional: until the person has made the Plaid
 * team and set the keys in Vercel (setup step #2593.9), Finances settings says
 * the keys are not set and Link account is not offered.
 *
 * TOKEN_ENCRYPTION_KEY is the one the Gmail connection already uses; each
 * Item's access token is stored encrypted with it in the same way.
 */

const plaidSchema = z.object({
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_SECRET: z.string().min(1),
  PLAID_ENV: z.enum(['sandbox', 'production']),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
});

export type PlaidEnv = z.infer<typeof plaidSchema>;

/** The setup step that sets the keys, named on the page while they are missing. */
export const PLAID_SETUP_STEP = '2593.9';

function read(env: Record<string, string | undefined>) {
  return {
    PLAID_CLIENT_ID: env.PLAID_CLIENT_ID?.trim(),
    PLAID_SECRET: env.PLAID_SECRET?.trim(),
    // Production unless told otherwise: the Trial plan's keys are Production keys.
    PLAID_ENV: env.PLAID_ENV?.trim() || 'production',
    TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY?.trim(),
  };
}

export function isPlaidConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return plaidSchema.safeParse(read(env)).success;
}

/** Throws when a key is missing; check `isPlaidConfigured` first. */
export function plaidEnv(env: Record<string, string | undefined> = process.env): PlaidEnv {
  if (typeof window !== 'undefined') throw new Error('plaidEnv is server-only');
  return plaidSchema.parse(read(env));
}
