import { headers } from 'next/headers';
import { publicEnv } from '@/lib/env';

/**
 * Origin of the request that triggered this server action / route.
 *
 * Prefer the live host over NEXT_PUBLIC_APP_URL so OAuth and email redirects
 * never send a production user to http://localhost:3000 just because the env
 * default (or an outdated Site URL fallback) still points there.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host || host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return publicEnv.NEXT_PUBLIC_APP_URL;
  }
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}
