import type postgres from 'postgres';
import {
  WIKIPEDIA_PROVIDER_SLUG,
  type WikipediaArticle,
} from '@/lib/learn/providers/wikipedia';

/**
 * Writing a fetched article into the catalogue.
 *
 * The catalogue tables belong to nobody -- no `user_id`, no RLS keyed to a
 * person, and no insert policy at all -- so the sweeps that fill them run as
 * `service_role`. That is why this takes a `postgres` connection rather than a
 * session client: the only caller today is scripts/learn-catalogue.ts, which
 * holds the service-role credentials, and every statement below is over
 * reference data with nobody's rows in it.
 *
 * Re-running is the normal case, not the exception. A sweep is re-run when an
 * article has changed, and the point of `(provider_id, external_id)` being
 * unique is that the second run updates the row rather than adding a second
 * one. Segments do the same on `(item_id, ordinal)`, and the sections the
 * article no longer has are deleted by ordinal afterwards, so the row count
 * follows the article rather than growing with every sweep.
 *
 * The one thing that is thrown away on a re-sweep is a stale embedding. If a
 * section's text changed, whatever vector was stored for it describes the old
 * text, and a retrieval index half of which points at text that is no longer
 * there is worse than one with a gap in it: the gap is visible in
 * `catalogue_segments_unembedded_idx` and the wrong vector is not.
 */

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * One row of `catalogue_segments`, before it has an id.
 *
 * Timed, anchored, or neither -- the three addresses the table allows, and
 * the constraint on it refuses a row that is half of two of them. A Wikipedia
 * section is anchored, a span of a lecture is timed, and one segment standing
 * for a whole video is neither.
 */
export type CatalogueSegmentInput = {
  ordinal: number;
  tStartSeconds: number | null;
  tEndSeconds: number | null;
  sectionAnchor: string | null;
  heading: string | null;
  text: string;
};

/** One row of `catalogue_items`, before it has an id. */
export type CatalogueItemInput = {
  externalId: string;
  title: string;
  kind: 'article' | 'video' | 'course';
  canonicalUrl: string;
  lengthChars: number | null;
  durationSeconds: number | null;
  /** An ISO date, or null. */
  publishedAt: string | null;
};

export type StoredArticle = {
  itemId: string;
  /** Segments written, which is every section the article has. */
  written: number;
  /** Segments deleted because the article no longer has that section. */
  removed: number;
};

/**
 * Look up the provider row and mark it swept.
 *
 * `enabled` goes true here rather than in the migration: the seed deliberately
 * leaves every provider off until its sweep exists, and this is that sweep.
 */
async function markProviderSwept(
  sql: Sql,
  slug: string,
  channelId: string | null = null,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    update learn.catalogue_providers
       set enabled = true,
           last_swept_at = now(),
           -- Filled from what the API answered, never from a value typed here.
           -- A channel id guessed from memory fails by quietly walking somebody
           -- else's playlists, which is what the column's comment refuses.
           youtube_channel_id = coalesce(${channelId}, youtube_channel_id)
     where slug = ${slug}
    returning id`;

  if (!row) {
    throw new Error(
      `No catalogue provider called ${slug}. Apply supabase/migrations-learn/0022_catalogue.sql.`,
    );
  }
  return row.id;
}

async function upsertItem(
  sql: Sql,
  providerId: string,
  item: CatalogueItemInput,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into learn.catalogue_items
      (provider_id, external_id, title, kind, canonical_url, length_chars,
       duration_seconds, published_at)
    values (${providerId}, ${item.externalId}, ${item.title}, ${item.kind},
            ${item.canonicalUrl}, ${item.lengthChars}, ${item.durationSeconds},
            ${item.publishedAt})
    on conflict (provider_id, external_id) do update
       set title = excluded.title,
           canonical_url = excluded.canonical_url,
           length_chars = excluded.length_chars,
           duration_seconds = excluded.duration_seconds,
           published_at = excluded.published_at
    returning id`;

  if (!row) throw new Error(`Storing ${item.title} wrote no item row.`);
  return row.id;
}

/**
 * The one segment write, for every kind of work.
 *
 * An article's sections and a lecture's clips are the same rows with different
 * columns filled, so there is one statement rather than two, and in particular
 * one copy of the three `case when` arms below. A second copy that dropped one
 * of them would pass every test and break a re-sweep.
 */
async function upsertSegments(
  sql: Sql,
  itemId: string,
  segments: CatalogueSegmentInput[],
): Promise<void> {
  if (segments.length === 0) return;

  const rows = segments.map((segment) => ({
    item_id: itemId,
    ordinal: segment.ordinal,
    t_start_seconds: segment.tStartSeconds,
    t_end_seconds: segment.tEndSeconds,
    section_anchor: segment.sectionAnchor,
    heading: segment.heading,
    text: segment.text,
  }));

  await sql`
    insert into learn.catalogue_segments
      ${sql(rows, 'item_id', 'ordinal', 't_start_seconds', 't_end_seconds',
            'section_anchor', 'heading', 'text')}
    on conflict (item_id, ordinal) do update
       set t_start_seconds = excluded.t_start_seconds,
           t_end_seconds = excluded.t_end_seconds,
           section_anchor = excluded.section_anchor,
           heading = excluded.heading,
           text = excluded.text,
           embedding = case when catalogue_segments.text is distinct from excluded.text
                            then null else catalogue_segments.embedding end,
           embedding_model = case when catalogue_segments.text is distinct from excluded.text
                                  then null else catalogue_segments.embedding_model end,
           -- Goes null with the vector, which the check constraint requires and
           -- the repeat press relies on: the next embedding pass stamps a new
           -- time, and a rewritten section is offered again to claims searched
           -- before it changed.
           embedded_at = case when catalogue_segments.text is distinct from excluded.text
                              then null else catalogue_segments.embedded_at end`;
}

async function deleteTrailingSegments(sql: Sql, itemId: string, kept: number): Promise<number> {
  const removed = await sql<{ id: string }[]>`
    delete from learn.catalogue_segments
     where item_id = ${itemId} and ordinal >= ${kept}
    returning id`;
  return removed.length;
}

/** Write one article and its sections, replacing whatever was there before. */
export async function storeArticle(
  sql: postgres.Sql,
  article: WikipediaArticle,
): Promise<StoredArticle> {
  return sql.begin(async (tx) => {
    const providerId = await markProviderSwept(tx, WIKIPEDIA_PROVIDER_SLUG);
    const itemId = await upsertItem(tx, providerId, {
      externalId: article.externalId,
      title: article.title,
      kind: 'article',
      canonicalUrl: article.canonicalUrl,
      lengthChars: article.lengthChars,
      durationSeconds: null,
      publishedAt: null,
    });
    await upsertSegments(
      tx,
      itemId,
      article.sections.map((section) => ({
        ordinal: section.ordinal,
        tStartSeconds: null,
        tEndSeconds: null,
        sectionAnchor: section.anchor,
        heading: section.heading,
        text: section.text,
      })),
    );
    await tx`
      update learn.catalogue_items
         set image_url = ${article.image?.url ?? null},
             image_file = ${article.image?.file ?? null},
             image_checked_at = now()
       where id = ${itemId}`;
    const removed = await deleteTrailingSegments(tx, itemId, article.sections.length);
    return { itemId, written: article.sections.length, removed };
  }) as Promise<StoredArticle>;
}

/**
 * Writing a fetched course into the catalogue.
 *
 * A course is not a table. It is a `catalogue_items` row of kind `course`,
 * whose members are ordinary items of kind `video` and whose order lives in
 * `catalogue_course_items` -- one fewer table, and a course gets segments and
 * links like anything else. The course row itself carries no segments: nothing
 * ranks a whole term against one claim, and the spec says so.
 *
 * The ordering rows are deleted and rewritten rather than upserted. They carry
 * nothing but the order, and two unique constraints apply to them -- one per
 * position and one per member -- so a lecture that moved from seventh to sixth
 * collides with whichever of the two the upsert is keyed on. Rewriting inside
 * the transaction is both shorter and correct, and the items themselves are
 * untouched by it, so nothing anybody queued is disturbed.
 *
 * A lecture that has left the playlist keeps its item row and loses its place
 * in the order. Deleting the item would take its segments, its links and
 * anybody's queued reading of it with it, and a lecture MIT re-cut is not a
 * lecture nobody watched.
 */
export type CourseVideoInput = CatalogueItemInput & {
  /** The provider's own numbering, verbatim: `Lecture 7`. Null when it has none. */
  providerLabel: string | null;
  /**
   * Null keeps the segments already stored for this lecture, untouched. A
   * press from the app passes null for a lecture it already cut from a
   * transcript, so a second press spends its time on the lectures the first
   * did not reach instead of fetching the same captions again.
   */
  segments: CatalogueSegmentInput[] | null;
};

export type CatalogueCourseInput = {
  providerSlug: string;
  /** From the API, to fill the provider's `youtube_channel_id`. */
  channelId: string | null;
  externalId: string;
  title: string;
  canonicalUrl: string;
  videos: CourseVideoInput[];
};

export type StoredCourse = {
  courseItemId: string;
  videos: number;
  /** Segments written across every lecture. */
  written: number;
  /** Segments dropped because a lecture is now cut into fewer of them. */
  removed: number;
  /** Lectures whose stored segments were kept as they were. */
  kept: number;
};

export async function storeCourse(
  sql: postgres.Sql,
  course: CatalogueCourseInput,
): Promise<StoredCourse> {
  return sql.begin(async (tx) => {
    const providerId = await markProviderSwept(tx, course.providerSlug, course.channelId);

    const courseItemId = await upsertItem(tx, providerId, {
      externalId: course.externalId,
      title: course.title,
      kind: 'course',
      canonicalUrl: course.canonicalUrl,
      lengthChars: null,
      durationSeconds: null,
      publishedAt: null,
    });

    let written = 0;
    let removed = 0;
    let kept = 0;
    const members: { course_item_id: string; member_item_id: string; position: number; provider_label: string | null }[] = [];

    for (const [position, video] of course.videos.entries()) {
      const memberItemId = await upsertItem(tx, providerId, video);
      if (video.segments === null) {
        kept += 1;
      } else {
        await upsertSegments(tx, memberItemId, video.segments);
        removed += await deleteTrailingSegments(tx, memberItemId, video.segments.length);
        written += video.segments.length;
      }
      members.push({
        course_item_id: courseItemId,
        member_item_id: memberItemId,
        position,
        provider_label: video.providerLabel,
      });
    }

    await tx`delete from learn.catalogue_course_items where course_item_id = ${courseItemId}`;
    if (members.length > 0) {
      await tx`
        insert into learn.catalogue_course_items
          ${tx(members, 'course_item_id', 'member_item_id', 'position', 'provider_label')}`;
    }

    return { courseItemId, videos: course.videos.length, written, removed, kept };
  }) as Promise<StoredCourse>;
}

/**
 * The lectures of a provider already cut from a transcript, out of the ones
 * named.
 *
 * Read from the segments' shape, because no column records how a lecture was
 * cut: a transcript span is timed and has no heading, a chapter always has
 * one, and a whole-video segment has no time. So any timed segment with a
 * null heading means the lecture was cut from its transcript.
 */
export async function transcriptCutVideos(
  sql: postgres.Sql,
  providerSlug: string,
  videoIds: string[],
): Promise<Set<string>> {
  if (videoIds.length === 0) return new Set();
  const rows = await sql<{ external_id: string }[]>`
    select i.external_id
      from learn.catalogue_items i
      join learn.catalogue_providers p on p.id = i.provider_id
     where p.slug = ${providerSlug}
       and i.kind = 'video'
       and i.external_id in ${sql(videoIds)}
       and exists (
         select 1 from learn.catalogue_segments s
          where s.item_id = i.id
            and s.t_start_seconds is not null
            and s.heading is null
       )`;
  return new Set(rows.map((row) => row.external_id));
}
