/**
 * The new-role form, opened with this company already in it.
 *
 * Its own module because the company page (a server component) and the roles
 * list (a client one) both link here, and a server component cannot call a
 * function exported from a 'use client' file.
 */
export function newRoleHref(companyName: string): string {
  return `/jobs/roles/new?company=${encodeURIComponent(companyName)}`;
}
