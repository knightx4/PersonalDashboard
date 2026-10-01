/**
 * A reading or a task can point at a story saved in News (plan #1367).
 *
 * The story's text stays in news.saved_stories, and learn.readings.news_story_id
 * (migrations-news/0017) and todo.task_links.saved_story_id
 * (migrations-goals/0065) point at it. What is checked here is what the keys
 * and news.unsave_story promise: a pointer cannot reach another account's
 * story, and unsaving a story something points at hides it from Saved while
 * the reading or the task still reaches it. Unsaving one nothing points at
 * deletes it as before.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-news';

let userA = '';
let userB = '';
let trackA = '';
let taskA = '';

async function saveStory(userId: string, headline: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into news.saved_stories (user_id, headline, summary, sender_name, received_at)
    values (${userId}, ${headline}, 'Cities are laying track again.', 'Letters From Work', now())
    returning id`;
  return row.id;
}

/** The ids on the Saved tab, read as the app reads it. */
async function savedTab(userId: string): Promise<string[]> {
  const rows = await asUser(userId, (tx) => tx<{ id: string }[]>`
    select id from news.saved_stories where unsaved_at is null`);
  return rows.map((r) => r.id);
}

async function unsave(userId: string, storyId: string): Promise<void> {
  await asUser(userId, (tx) => tx`select news.unsave_story(${storyId})`);
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('pointers-a@example.com');
  userB = await createUser('pointers-b@example.com');
  const [track] = await admin<{ id: string }[]>`
    insert into learn.tracks (user_id, title) values (${userA}, 'From News') returning id`;
  trackA = track.id;
  const [task] = await admin<{ id: string }[]>`
    insert into todo.tasks (user_id, title) values (${userA}, 'The quiet return of the tram')
    returning id`;
  taskA = task.id;
});

beforeEach(async () => {
  await admin`delete from todo.task_links`;
  await admin`delete from learn.readings`;
  await admin`delete from news.saved_stories`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a reading pointing at a saved story', () => {
  async function queue(userId: string, storyId: string): Promise<string> {
    const [row] = await asUser(userId, (tx) => tx<{ id: string }[]>`
      insert into learn.readings (user_id, track_id, locator_basis, title, news_story_id)
      values (${userId}, ${trackA}, 'sent from News', 'The quiet return of the tram', ${storyId})
      returning id`);
    return row.id;
  }

  it('points at the story, and still opens it once the story is unsaved', async () => {
    const story = await saveStory(userA, 'The quiet return of the tram');
    const reading = await queue(userA, story);

    await unsave(userA, story);

    expect(await savedTab(userA)).toEqual([]);
    const [opened] = await asUser(userA, (tx) => tx<{ headline: string }[]>`
      select s.headline from learn.readings r
      join news.saved_stories s on s.id = r.news_story_id
      where r.id = ${reading}`);
    expect(opened.headline).toBe('The quiet return of the tram');
  });

  it('cannot point at another account\'s story', async () => {
    const theirs = await saveStory(userB, 'Not yours');
    await expect(queue(userA, theirs)).rejects.toThrow(/readings_news_story_fk/);
  });
});

describe('a task link pointing at a saved story', () => {
  async function link(userId: string, storyId: string): Promise<void> {
    await asUser(userId, (tx) => tx`
      insert into todo.task_links (task_id, relation, saved_story_id)
      values (${taskA}, 'about', ${storyId})`);
  }

  it('points at the story, and keeps it once the story is unsaved', async () => {
    const story = await saveStory(userA, 'Rates held');
    await link(userA, story);

    await unsave(userA, story);

    expect(await savedTab(userA)).toEqual([]);
    const rows = await asUser(userA, (tx) => tx<{ headline: string }[]>`
      select s.headline from todo.task_links l
      join news.saved_stories s on s.id = l.saved_story_id
      where l.task_id = ${taskA}`);
    expect(rows.map((r) => r.headline)).toEqual(['Rates held']);
  });

  it('cannot point at another account\'s story', async () => {
    const theirs = await saveStory(userB, 'Not yours');
    await expect(link(userA, theirs)).rejects.toThrow(/owner owns/);
  });

  it('counts as the one target a link names', async () => {
    const story = await saveStory(userA, 'Rates held');
    const [reading] = await admin<{ id: string }[]>`
      insert into learn.readings (user_id, track_id, locator_basis, title)
      values (${userA}, ${trackA}, 'typed', 'Something else') returning id`;
    await expect(
      admin`insert into todo.task_links (task_id, relation, saved_story_id, reading_id)
            values (${taskA}, 'about', ${story}, ${reading.id})`,
    ).rejects.toThrow(/task_links_exactly_one_ck/);
  });
});

describe('news.unsave_story', () => {
  it('deletes a story nothing points at', async () => {
    const story = await saveStory(userA, 'Nobody sent this');
    await unsave(userA, story);
    const rows = await admin`select 1 from news.saved_stories where id = ${story}`;
    expect(rows).toHaveLength(0);
  });

  it('cannot unsave another account\'s story', async () => {
    const theirs = await saveStory(userB, 'Not yours');
    await unsave(userA, theirs);
    expect(await savedTab(userB)).toEqual([theirs]);
  });
});
