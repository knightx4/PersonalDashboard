/** Pure line-matching helpers for in-place order reparse. */

export type ExistingOrderItemMatch = {
  id: string;
  name: string;
  variant: string | null;
  fingerprint_strict: string | null;
  fingerprint_loose: string | null;
};

export type BuiltLineMatch = {
  name: string;
  variant: string | null;
  fingerprintStrict: string;
  fingerprintLoose: string;
};

/**
 * Prefer fingerprint identity, then exact name, then the single-line fallback
 * used when a parser upgrade replaces a generic "Shopify order" stub.
 */
export function matchExistingOrderItem(
  existing: readonly ExistingOrderItemMatch[],
  built: BuiltLineMatch,
  used: ReadonlySet<string>,
  opts?: { allowSingleLineFallback?: boolean; builtCount?: number },
): ExistingOrderItemMatch | null {
  const available = existing.filter((item) => !used.has(item.id));
  if (available.length === 0) return null;

  const byStrict = available.find(
    (item) =>
      item.fingerprint_strict &&
      built.fingerprintStrict &&
      item.fingerprint_strict === built.fingerprintStrict,
  );
  if (byStrict) return byStrict;

  const byLoose = available.find(
    (item) =>
      item.fingerprint_loose &&
      built.fingerprintLoose &&
      item.fingerprint_loose === built.fingerprintLoose,
  );
  if (byLoose) return byLoose;

  const wantName = built.name.trim().toLowerCase();
  const byName = available.find((item) => item.name.trim().toLowerCase() === wantName);
  if (byName) return byName;

  if (
    opts?.allowSingleLineFallback !== false &&
    available.length === 1 &&
    (opts?.builtCount ?? 1) === 1
  ) {
    return available[0] ?? null;
  }

  return null;
}
