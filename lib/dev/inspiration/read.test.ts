import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { clearBeforeRead, readInspirationVideos, saveVideoTakeaways, type TakeawayStore, type UnreadVideo } from './read';
import type { TakeawayCandidate } from './takeaways';

const USER = 'user-1';
const NOW = new Date('2026-10-02T12:00:00Z');
const CUES = [
  { startSeconds: 0, endSeconds: 10, text: 'Write the acceptance criteria before the agent starts.' },
  { startSeconds: 40, endSeconds: 50, text: 'Keep a log of every decision the agent made.' },
];

type Takeaway = { id: string; userId: string; title: string; status: string };
type Link = { takeawayId: string; videoRowId: string; quote: string | null; startSeconds: number | null };
type Video = UnreadVideo & { processedAt: string | null; count: number | null; error: string | null };

/** The four tables, in memory, as far as reading touches them. */
function memoryStore(videos: Video[]) {
  const takeaways: Takeaway[] = [];
  const links: Link[] = [];
  let next = 0;
  const store: TakeawayStore = {
    async unreadVideos() {
      return videos.filter((video) => video.processedAt === null);
    },
    async visions() {
      return { app: 'One place for everything.', dev: 'Make working with an AI builder easy.' };
    },
    async earlierTakeaways(_userId, videoRowId) {
      return links
        .filter((link) => link.videoRowId === videoRowId)
        .map((link) => {
          const takeaway = takeaways.find((row) => row.id === link.takeawayId)!;
          return {
            takeawayId: takeaway.id,
            status: takeaway.status,
            videoCount: links.filter((other) => other.takeawayId === takeaway.id).length,
          };
        });
    },
    async deleteTakeaways(_userId, ids) {
      for (const id of ids) {
        takeaways.splice(takeaways.findIndex((row) => row.id === id), 1);
        for (let i = links.length - 1; i >= 0; i -= 1) if (links[i].takeawayId === id) links.splice(i, 1);
      }
    },
    async unlink(_userId, videoRowId, ids) {
      for (let i = links.length - 1; i >= 0; i -= 1) {
        if (links[i].videoRowId === videoRowId && ids.includes(links[i].takeawayId)) links.splice(i, 1);
      }
    },
    async insertTakeaway(userId, videoRowId, takeaway) {
      const id = `t${(next += 1)}`;
      takeaways.push({ id, userId, title: takeaway.title, status: 'open' });
      links.push({ takeawayId: id, videoRowId, quote: takeaway.quote, startSeconds: takeaway.startSeconds });
      return id;
    },
    async markRead(_userId, videoRowId, outcome) {
      const video = videos.find((row) => row.id === videoRowId)!;
      if (outcome.error === null) {
        video.processedAt = outcome.at;
        video.count = outcome.count;
        video.error = null;
      } else {
        video.error = outcome.error;
      }
    },
  };
  return { store, takeaways, links, videos };
}

const video = (id: string): Video => ({
  id,
  videoId: `${id.padEnd(11, 'x')}`,
  title: `Video ${id}`,
  channel: null,
  processedAt: null,
  count: null,
  error: null,
});

const candidate = (title: string, startSeconds = 0): TakeawayCandidate => ({
  title,
  body: `${title}, in this app.`,
  module: 'dev',
  quote: 'Write the acceptance criteria before the agent starts.',
  startSeconds,
});

function stubClient(replies: unknown[]) {
  const create = vi.fn();
  for (const input of replies) {
    create.mockResolvedValueOnce({
      content: [{ type: 'tool_use', name: 'report_takeaways', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1_000, output_tokens: 100 },
    });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('clearBeforeRead', () => {
  it('removes open takeaways only this video makes and unlinks shared ones, leaving acted-on ones alone', () => {
    expect(
      clearBeforeRead([
        { takeawayId: 'a', status: 'open', videoCount: 1 },
        { takeawayId: 'b', status: 'open', videoCount: 2 },
        { takeawayId: 'c', status: 'crafted', videoCount: 1 },
        { takeawayId: 'd', status: 'dismissed', videoCount: 3 },
      ]),
    ).toEqual({ remove: ['a'], unlink: ['b'] });
  });
});

describe('saveVideoTakeaways', () => {
  it('stores one row per takeaway, linked to the video with its moment, and marks the video read', async () => {
    const { store, takeaways, links, videos } = memoryStore([video('v1')]);
    expect(await saveVideoTakeaways(store, USER, 'v1', [candidate('One', 0), candidate('Two', 40)], NOW)).toBe(2);
    expect(takeaways.map((row) => row.title)).toEqual(['One', 'Two']);
    expect(links.map((link) => [link.videoRowId, link.startSeconds])).toEqual([
      ['v1', 0],
      ['v1', 40],
    ]);
    expect(videos[0]).toMatchObject({ processedAt: NOW.toISOString(), count: 2, error: null });
  });

  it('does not add a video’s takeaways twice when it is stored again', async () => {
    const { store, takeaways, links } = memoryStore([video('v1'), video('v2')]);
    await saveVideoTakeaways(store, USER, 'v1', [candidate('One'), candidate('Two')], NOW);
    // Another video makes "Two" as well, as a merge would leave it.
    links.push({ takeawayId: 't2', videoRowId: 'v2', quote: null, startSeconds: 5 });
    // The person crafted "One" into a plan.
    takeaways[0].status = 'crafted';

    await saveVideoTakeaways(store, USER, 'v1', [candidate('Two')], NOW);
    await saveVideoTakeaways(store, USER, 'v1', [candidate('Two')], NOW);

    expect(takeaways.map((row) => [row.title, row.status])).toEqual([
      ['One', 'crafted'],
      ['Two', 'open'],
      ['Two', 'open'],
    ]);
    // v1's link to the shared takeaway moved to its own new row, once.
    expect(links.filter((link) => link.videoRowId === 'v1').map((link) => link.takeawayId)).toEqual(['t1', 't4']);
    expect(links.filter((link) => link.videoRowId === 'v2').map((link) => link.takeawayId)).toEqual(['t2']);
  });

  it('marks a video with nothing that applies as read with none', async () => {
    const { store, takeaways, videos } = memoryStore([video('v1')]);
    expect(await saveVideoTakeaways(store, USER, 'v1', [], NOW)).toBe(0);
    expect(takeaways).toEqual([]);
    expect(videos[0]).toMatchObject({ processedAt: NOW.toISOString(), count: 0 });
  });
});

describe('readInspirationVideos', () => {
  const reply = {
    takeaways: [
      {
        title: 'Keep a decision log',
        body: 'Sessions would write down what they chose.',
        module: 'dev',
        quote: 'Keep a log of every decision the agent made.',
        at: '0:40',
      },
    ],
  };

  it('reads each unread video once, and a second run reads nothing', async () => {
    const { store, takeaways, links, videos } = memoryStore([video('v1'), video('v2')]);
    const { client, create } = stubClient([reply, { takeaways: [] }]);
    const loadCues = vi.fn().mockResolvedValue({ language: 'en', cues: CUES });
    const onSpend = vi.fn();

    const first = await readInspirationVideos(store, loadCues, USER, { anthropicApiKey: 'k', client, onSpend, now: () => NOW });
    expect(first).toEqual({ userId: USER, read: 2, takeaways: 1, failed: 0, stopped: null });
    expect(takeaways.map((row) => row.title)).toEqual(['Keep a decision log']);
    expect(links).toEqual([{ takeawayId: 't1', videoRowId: 'v1', quote: reply.takeaways[0].quote, startSeconds: 40 }]);
    expect(videos.map((row) => row.count)).toEqual([1, 0]);
    expect(onSpend).toHaveBeenCalledTimes(2);
    expect(onSpend.mock.calls[0][0]).toBe(USER);

    const second = await readInspirationVideos(store, loadCues, USER, { anthropicApiKey: 'k', client, now: () => NOW });
    expect(second).toEqual({ userId: USER, read: 0, takeaways: 0, failed: 0, stopped: null });
    expect(create).toHaveBeenCalledTimes(2);
    expect(takeaways).toHaveLength(1);
  });

  it('leaves a failed video unread with the reason, to be tried again', async () => {
    const { store, videos } = memoryStore([video('v1')]);
    const { client } = stubClient([{ takeaways: 'none' }]);
    const loadCues = vi.fn().mockResolvedValue({ language: 'en', cues: CUES });
    const result = await readInspirationVideos(store, loadCues, USER, { anthropicApiKey: 'k', client, now: () => NOW });
    expect(result.failed).toBe(1);
    expect(videos[0]).toMatchObject({ processedAt: null, error: 'The takeaways came back malformed.' });
  });

  it('fails a video whose transcript is missing from the cache without calling the model', async () => {
    const { store, videos } = memoryStore([video('v1')]);
    const { client, create } = stubClient([]);
    const result = await readInspirationVideos(store, vi.fn().mockResolvedValue(null), USER, { anthropicApiKey: 'k', client });
    expect(result.failed).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(videos[0].error).toBe('The transcript is not in the cache.');
  });

  it('stops at the deadline and leaves the rest for the next run', async () => {
    const { store } = memoryStore([video('v1')]);
    const { client } = stubClient([]);
    const result = await readInspirationVideos(store, vi.fn(), USER, { anthropicApiKey: 'k', client, deadline: 0 });
    expect(result.stopped).toMatch(/out of time/);
    expect(result.read).toBe(0);
  });
});
