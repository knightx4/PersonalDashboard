import 'server-only';

import { z } from 'zod';

function assertServer(name: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(`${name} is server-only`);
  }
}

const gmailSchema = z.object({
  GOOGLE_GMAIL_CLIENT_ID: z.string().min(1),
  GOOGLE_GMAIL_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
});

export function isGmailOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_GMAIL_CLIENT_ID &&
      process.env.GOOGLE_GMAIL_CLIENT_SECRET &&
      process.env.TOKEN_ENCRYPTION_KEY,
  );
}

/** Gmail OAuth + token encryption env. Does not require DATABASE_URL. */
export function gmailOAuthEnv() {
  assertServer('gmailOAuthEnv');
  return gmailSchema.parse(process.env);
}
