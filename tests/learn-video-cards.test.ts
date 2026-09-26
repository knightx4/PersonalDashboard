/**
 * Learn now cards written from videos on your playlist (plan #1067):
 * migrations-learn/0067_feed_card_from_video.sql.
 *
 * A video card names the video and the stretch it came from, one card per
 * stretch per person, and nothing but a video card carries a stretch. Two
 * stretches that start in one transcript segment are told apart by their
 * idea_index.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-learn';

const VIDEO = 'vidcards001';

let userA = '';
let userB = '';
let itemId = '';
let segmentId = '';

async function videoCard(userId: string, start: number, index: number, extra: { end?: number | null } = {}): Promise<void> {
  await admin`
    insert into feed_cards (user_id, reason, item_id, segment_id, idea_index, video_id, video_start_seconds, video_end_seconds)
    values (${userId}, 'video', ${itemId}, ${segmentId}, ${index}, ${VIDEO}, ${start}, ${extra.end === undefined ? start + 60 : extra.end})`;
}

beforeAll(async () => {
  await truncateAll();
  await admin`delete from catalogue_items where external_id = ${VIDEO}`;
  userA = await createUser('video-cards-a@example.com');
  userB = await createUser('video-cards-b@example.com');

  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('youtube-list-test', 'Your YouTube list', 'https://www.youtube.com', 'YouTube terms', 'Test')
    on conflict (slug) do update set name = excluded.name
    returning id`;
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${provider.id}, ${VIDEO}, 'Cash flow in ten minutes', 'video', ${'https://www.youtube.com/watch?v=' + VIDEO})
    returning id`;
  itemId = item.id;
  const [segment] = await admin<{ id: string }[]>`
    insert into catalogue_segments (item_id, ordinal, t_start_seconds, t_end_seconds, text)
    values (${itemId}, 0, 0, 600, 'The transcript.')
    returning id`;
  segmentId = segment.id;
});

afterAll(async () => {
  await truncateAll();
  await admin`delete from catalogue_items where external_id = ${VIDEO}`;
  await closeDb();
});

describe('video cards', () => {
  it('takes a card for each stretch, two in one segment apart by idea_index', async () => {
    await videoCard(userA, 30, 0);
    await videoCard(userA, 400, 1);
    const rows = await admin<{ video_start_seconds: number }[]>`
      select video_start_seconds from feed_cards where user_id = ${userA} order by video_start_seconds`;
    expect(rows.map((row) => row.video_start_seconds)).toEqual([30, 400]);
  });

  it('refuses a second card for one stretch, and allows the same stretch for someone else', async () => {
    await expect(videoCard(userA, 30, 2)).rejects.toThrow(/feed_cards_video_stretch_uq/);
    await videoCard(userB, 30, 0);
  });

  it('needs the video and where the stretch starts', async () => {
    await expect(
      admin`insert into feed_cards (user_id, reason, item_id, segment_id, idea_index)
            values (${userB}, 'video', ${itemId}, ${segmentId}, 5)`,
    ).rejects.toThrow(/feed_cards_target_ck/);
  });

  it('refuses a stretch that ends before it starts, and a stretch on any other card', async () => {
    await expect(videoCard(userB, 500, 3, { end: 400 })).rejects.toThrow(/feed_cards_video_ck/);
    await expect(
      admin`insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, idea_index, video_id, video_start_seconds)
            values (${userB}, 'interest', 'Cash', ${itemId}, ${segmentId}, 6, ${VIDEO}, 700)`,
    ).rejects.toThrow(/feed_cards_video_ck/);
  });
});
