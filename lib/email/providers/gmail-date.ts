/**
 * Gmail's `internalDate`, as a Date or null.
 *
 * Gmail sends it as a string of epoch milliseconds. A message it has no date
 * for comes back as "0", which is truthy, so a plain truthiness check turned
 * it into 1 January 1970 and the message sorted to the bottom of every list
 * and fell outside every date window. Zero, a negative, anything that is not a
 * number, and a value Date cannot hold all read as null, which is what every
 * reader of the field already handles.
 */
export function gmailInternalDate(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const ms = Number(trimmed);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}
