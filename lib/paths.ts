/** Only same-origin relative paths; used for Gmail OAuth return and ?next=. */
export function safeAppPath(value: string | null | undefined, fallback = '/settings'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || value.includes('\n') || value.includes('\r')) return fallback;
  return value;
}
