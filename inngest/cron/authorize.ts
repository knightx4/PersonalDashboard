import type { NextRequest } from 'next/server';

/**
 * Cron authorization and origin resolution, in one place.
 *
 * Both workspaces' scheduled work now runs behind a single route, but the
 * individual routes remain callable for a manual run, so this stayed a shared
 * helper rather than being inlined into the one caller.
 */
export function authorizeCron(request: NextRequest): boolean {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured.
  // TOKEN_ENCRYPTION_KEY is accepted as a fallback so a cron-less local deploy
  // can still be curled (the same pattern the continue tokens use).
  const secret = process.env.CRON_SECRET?.trim() || process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) return false;
  const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return header === secret;
}

export function requestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return new URL(request.url).origin;
}
