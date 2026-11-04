/**
 * Opening the music studio (knightx4/music-pipeline, studio-app) from Dash.
 *
 * The studio syncs songs through Supabase functions that check a token. Dash
 * makes one for the computer that asked (`studio_mint_key`, migration 0288)
 * and opens the studio with the project's URL, its public key and that token
 * in the address's fragment. The studio keeps them on that computer and takes
 * them out of the address bar. A fragment is never sent to a server.
 */

/** Where the studio app is served; STUDIO_APP_URL overrides it. */
export const STUDIO_APP_URL = 'https://map-studio-liard.vercel.app/app';

export interface StudioSettings {
  url: string;
  key: string;
  token: string;
}

/** The studio's address with the settings in its fragment, as the studio's `parseHandoff` reads it. */
export function studioHandoffUrl(base: string, settings: StudioSettings): string {
  const json = JSON.stringify({ url: settings.url.replace(/\/+$/, ''), key: settings.key, token: settings.token });
  const packed = Buffer.from(json, 'utf8').toString('base64url');
  return `${base.split('#')[0]}#studio=${packed}`;
}

/** A short name for the computer, from its browser's user agent, for the token's label. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'a browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${browser} on ${os}` : os;
}
