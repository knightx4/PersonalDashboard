/**
 * Drawn pictures on a plan row: the options a proposal or a decision shows
 * before anything is built (migration 0189).
 *
 * The page holds only each picture's id and caption. The drawing itself, an
 * SVG kept as text, loads through /dev/plan/picture as an image when the row
 * is opened, so a page of a hundred rows fetches no drawings until one is
 * looked at, and an SVG shown as an image cannot run a script.
 */

/** One picture as the opened row draws it. */
export type PlanPicture = {
  id: string;
  caption: string;
  /** Where the image loads from. */
  src: string;
};

export type PlanPictureRow = {
  id: string;
  item_id: string;
  caption: string;
  position: number;
  created_at: string;
};

/** Where a picture loads from. */
export function pictureHref(id: string): string {
  return `/dev/plan/picture?id=${encodeURIComponent(id)}`;
}

/** The rows grouped by the plan item they sit on, each group in its own order. */
export function picturesByItem(rows: readonly PlanPictureRow[]): Record<string, PlanPicture[]> {
  const sorted = [...rows].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
  );
  const out: Record<string, PlanPicture[]> = {};
  for (const row of sorted) {
    (out[row.item_id] ??= []).push({ id: row.id, caption: row.caption, src: pictureHref(row.id) });
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a picture id from a query string is worth asking the database about. */
export function isPictureId(id: string): boolean {
  return UUID.test(id);
}

/**
 * The policy a picture is sent with. It is only ever meant to be an image,
 * where nothing in it runs, but the route can also be opened on its own, so
 * the policy refuses scripts, fetches and frames there as well. Inline styles
 * stay, because that is where a drawing keeps its animation.
 */
export const PICTURE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
