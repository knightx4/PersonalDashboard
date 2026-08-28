/**
 * Only same-origin relative paths; used for Gmail OAuth return and ?next=.
 *
 * The fallback is required rather than defaulted. Both halves of the app have
 * a settings page now, so there is no single sensible destination to fall back
 * to -- and a default would silently send someone to the other workspace.
 */
export function safeAppPath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || value.includes('\n') || value.includes('\r')) return fallback;
  return value;
}
