import { InspirationScreen } from '@/app/dev/inspiration/inspiration-view';
import { buildInspirationPage, type LinkRow, type TakeawayRowData, type VideoRow } from '@/lib/dev/inspiration/view';

/**
 * Dev's Inspiration tab (plan #1412) in the surface gallery: three videos, one
 * point two of them made, one already in the plan, one dismissed, and a video
 * with no transcript; then the page before the playlist has been read.
 * Fixtures run through the same builder the page uses, so the merge and the
 * cover rules are the real ones.
 */

const base = {
  channel_title: 'AI Engineer',
  thumbnail_url: null,
  left_playlist_at: null,
  transcript_state: 'fetched',
  transcript_error: null,
  processed_at: '2026-10-02T09:00:00Z',
  process_error: null,
};

const VIDEOS: VideoRow[] = [
  {
    ...base,
    id: 'v1',
    video_id: 'aircAruvnKk',
    title: 'How we ship agents to production without losing the plot',
    duration_seconds: 1834,
    playlist_position: 0,
    added_at: '2026-09-28T12:00:00Z',
    takeaway_count: 2,
  },
  {
    ...base,
    id: 'v2',
    video_id: 'TSdXJw83kyA',
    title: 'Evals are the product: a year of building with Claude',
    channel_title: 'Latent Space',
    duration_seconds: 3120,
    playlist_position: 1,
    added_at: '2026-09-30T12:00:00Z',
    takeaway_count: 2,
  },
  {
    ...base,
    id: 'v3',
    video_id: 'ZK3O402wf1c',
    title: 'Live coding a terminal UI',
    duration_seconds: 2410,
    playlist_position: 2,
    added_at: '2026-10-01T12:00:00Z',
    transcript_state: 'none',
    processed_at: null,
    takeaway_count: null,
  },
];

const TAKEAWAYS: TakeawayRowData[] = [
  {
    id: 't1',
    title: 'Run the evals before every merge',
    body: 'Keep a small set of fixed prompts for Ask Dash and run them in the gate, so a change that makes the answers worse is caught before main.',
    module: null,
    status: 'open',
    idea_id: null,
    plan_item_id: null,
    created_at: '2026-10-02T09:01:00Z',
  },
  {
    id: 't2',
    title: 'Show what a run cost beside what it did',
    body: 'Put the spend for each plan run next to its result on the Dash page, so an expensive run that did little stands out.',
    module: 'dev',
    status: 'covered',
    idea_id: null,
    plan_item_id: 'p1',
    created_at: '2026-10-02T09:02:00Z',
  },
  {
    id: 't3',
    title: 'Let the agent ask before it guesses',
    body: 'When a step is unclear, have the session write a question rather than pick an answer.',
    module: 'dev',
    status: 'dismissed',
    idea_id: null,
    plan_item_id: null,
    created_at: '2026-10-02T09:03:00Z',
  },
];

const LINKS: LinkRow[] = [
  {
    takeaway_id: 't1',
    video_id: 'v1',
    said: 'Run a fixed set of Ask Dash prompts on every change, so a worse answer is caught before it ships.',
    quote: 'If you are not running your evals on every PR, you are finding out from users.',
    start_seconds: 754,
  },
  {
    takeaway_id: 't1',
    video_id: 'v2',
    said: 'Treat the eval set as part of the code: it lives in the repository and the gate runs it.',
    quote: 'The eval suite is the spec. We review changes to it the way we review code.',
    start_seconds: 1312,
  },
  {
    takeaway_id: 't2',
    video_id: 'v2',
    said: null,
    quote: 'Every trace shows the token bill right next to the outcome.',
    start_seconds: 2045,
  },
  { takeaway_id: 't3', video_id: 'v1', said: null, quote: null, start_seconds: 301 },
];

const PAGE = buildInspirationPage({
  settings: {
    youtube_playlist_id: 'PLIBpAG8AqHoE',
    playlist_read_at: '2026-10-02T09:00:00Z',
    playlist_error: null,
  },
  videos: VIDEOS,
  takeaways: TAKEAWAYS,
  links: LINKS,
  planNumbers: new Map([['p1', 1288]]),
  ideaPlanItems: new Map(),
});

export function InspirationByVideoSurface() {
  return <InspirationScreen page={PAGE} view="videos" />;
}

export function InspirationListSurface() {
  return <InspirationScreen page={PAGE} view="list" />;
}

export function InspirationUnreadSurface() {
  return (
    <InspirationScreen
      page={buildInspirationPage({
        settings: { youtube_playlist_id: 'PLIBpAG8AqHoE', playlist_read_at: null, playlist_error: null },
        videos: [],
        takeaways: [],
        links: [],
        planNumbers: new Map(),
        ideaPlanItems: new Map(),
      })}
      view="videos"
    />
  );
}
