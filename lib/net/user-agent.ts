/**
 * Who the app's own requests say they are from, for the sites that ask for a
 * contact (Wikimedia, BoardGameGeek): a product token and a URL to reach the
 * person running it. The URL is the app's own address (NEXT_PUBLIC_APP_URL),
 * else its repository on GitHub (lib/plan/github.ts), so no account is named
 * in the code.
 */
import { appRepo } from '@/lib/plan/github';

export function appContactUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const site = env.NEXT_PUBLIC_APP_URL?.trim();
  if (site && !/localhost|placeholder/.test(site)) return site.replace(/\/+$/, '');
  const { owner, repo } = appRepo(env);
  return owner && repo ? `https://github.com/${owner}/${repo}` : 'https://github.com';
}

/** `Product/1.0 (what it is; +contact)`, the form these sites ask for. */
export function appUserAgent(product: string, purpose: string): string {
  return `${product} (${purpose}; +${appContactUrl()})`;
}
