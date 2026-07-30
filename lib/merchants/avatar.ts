/** Resolve a display domain for favicons from a merchant's domain list. */

const SKIP_PREFIXES = /^(mail|email|orders?|order-update|noreply|no-reply|notifications?|updates?|messaging|e\.|r\.)\./i;

export function primaryMerchantDomain(
  domains: readonly string[] | null | undefined,
): string | null {
  if (!domains?.length) return null;
  const cleaned = domains
    .map((domain) => domain.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean);
  if (cleaned.length === 0) return null;

  const preferred = cleaned.find((domain) => !SKIP_PREFIXES.test(domain) && domain.split('.').length <= 3);
  return preferred ?? cleaned[0] ?? null;
}

/** Public favicon URL (no API key). Falls back gracefully in the avatar UI. */
export function merchantFaviconUrl(domain: string, size = 128): string {
  const host = domain.trim().toLowerCase().replace(/^www\./, '');
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

export function merchantInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}
