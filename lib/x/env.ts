import 'server-only';

import { z } from 'zod';

/**
 * The X app's keys (plan #1818). Optional: until the person has made the X
 * app and set both keys in Vercel (setup step #1816), the Posts tab says the
 * keys are not set and Connect X is not offered.
 *
 * TOKEN_ENCRYPTION_KEY is the one the Gmail connection already uses; X's
 * tokens are stored encrypted with it in the same way.
 */

const xSchema = z.object({
  X_CLIENT_ID: z.string().min(1),
  X_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
});

export type XOAuthEnv = z.infer<typeof xSchema>;

/** The setup step that sets the keys, linked from the tab while they are missing. */
export const X_SETUP_STEP = 1816;

export function isXOAuthConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.X_CLIENT_ID?.trim() && env.X_CLIENT_SECRET?.trim() && env.TOKEN_ENCRYPTION_KEY?.trim());
}

/** Throws when a key is missing; check `isXOAuthConfigured` first. */
export function xOAuthEnv(env: Record<string, string | undefined> = process.env): XOAuthEnv {
  if (typeof window !== 'undefined') throw new Error('xOAuthEnv is server-only');
  return xSchema.parse({
    X_CLIENT_ID: env.X_CLIENT_ID?.trim(),
    X_CLIENT_SECRET: env.X_CLIENT_SECRET?.trim(),
    TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY?.trim(),
  });
}

export function xClient(env: XOAuthEnv) {
  return { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET };
}
