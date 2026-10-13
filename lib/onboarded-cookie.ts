/**
 * pt_onboarded: set once an account has finished onboarding, read by proxy.ts
 * so that opening the app from its icon goes to Home in one redirect instead
 * of passing through /onboarding first (plan #1920, docs/ONE-INTERFACE-SPEC.md
 * R11). It is a shortcut and not a record: profiles.onboarding_completed_at
 * stays the truth, and an account without the cookie takes the old path,
 * which sets it.
 *
 * Kept free of server-only imports so the proxy can read the name.
 */
export const ONBOARDED_COOKIE = 'pt_onboarded';

export const ONBOARDED_COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};
