import { publicEnv } from '@/lib/env';
import { requestOrigin } from '@/lib/auth/origin';

/**
 * Redirect URI sent to Google for the Gmail grant.
 *
 * Must match an Authorized redirect URI on the Gmail OAuth client exactly.
 * Prefer NEXT_PUBLIC_APP_URL in production so connect + callback always agree
 * with the URI registered in Google Cloud (not a vercel.app preview host).
 */
export async function gmailRedirectUri(): Promise<string> {
  const configured = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    return `${configured}/api/auth/gmail/callback`;
  }
  const origin = await requestOrigin();
  return `${origin.replace(/\/$/, '')}/api/auth/gmail/callback`;
}
