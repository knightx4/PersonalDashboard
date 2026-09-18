'use server';

import { cookies } from 'next/headers';
import { DENSITY_COOKIE, DENSITY_COOKIE_MAX_AGE, isDensity } from '@/lib/density';

/**
 * Remember the density for this device.
 *
 * Cookie only -- see lib/density.ts for why it is not on the account. The
 * client has already put the attribute on <html>; this is what makes the next
 * page load agree with it.
 */
// latency: instant -- the dial is applied on the client; the cookie write is not waited on
export async function setDensity(next: string): Promise<void> {
  const jar = await cookies();
  if (isDensity(next) && next !== 'comfortable') {
    jar.set(DENSITY_COOKIE, next, {
      maxAge: DENSITY_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
    });
  } else {
    jar.delete(DENSITY_COOKIE);
  }
}
