import { PostsScreen } from '@/app/dev/posts/posts-view';
import { socialPostFromRow } from '@/lib/dev/posts';
import { buildPostsPage } from '@/lib/dev/posts-page';

/**
 * Dev's Posts tab (plan #1419) in the surface gallery: two drafts waiting,
 * the first with a screenshot (#1418) and the second a thread with a post
 * past 280, one posted and one dropped; then the tab while Dash is drafting
 * the first batch. Fixtures run through the same builder the page uses.
 */

const NOW = Date.parse('2026-10-02T12:00:00Z');

const base = {
  platform: 'x',
  source_feedback_ids: [],
  image_paths: [],
  posted_url: null,
  posted_at: null,
  dropped_at: null,
  run_id: 'r1',
};

const ROWS = [
  {
    ...base,
    id: 'p1',
    angle: 'Every button that calls a model shows what a press costs, and a test keeps it that way',
    status: 'suggested',
    draft: ['d'],
    body: [
      'Every button in my app that calls a model shows what one press costs, from what that press cost before. A test walks every server action and fails the merge when one reaches a model with no hint beside its button.',
    ],
    source_plan_item_ids: ['s1', 's2'],
    // A screenshot committed by a posts run (#1418): a Surfaces gallery shot,
    // so sample data only. Any file under public/posts/ draws the same way.
    image_paths: ['/posts/2026-10-02-dev-plan-tree.png'],
    created_at: '2026-10-02T09:00:00Z',
  },
  {
    ...base,
    id: 'p2',
    angle: 'Several sessions merge to main a day, and one script keeps it green',
    status: 'suggested',
    draft: ['d'],
    body: [
      'Several Dash sessions merge to main in my app each day. On one day main stayed red for fourteen hours through seven failures, every one of which a local check would have caught.',
      'So every session now runs the same checks CI runs before it pushes: types, build, lint, contrast, the design rules and the whole test suite against a local database. It takes about three minutes. Main has not stayed red since, and when it does go red the session that broke it is the one that finds out first, because the next session to merge runs the gate on top of it and refuses to push.',
    ],
    source_plan_item_ids: ['s3'],
    created_at: '2026-10-02T08:00:00Z',
  },
  {
    ...base,
    id: 'p3',
    angle: 'The plan page reads the vision for each part of the app first',
    status: 'posted',
    draft: ['d'],
    body: ['Each part of my app has a short written vision, and every step Dash builds opens with it.'],
    source_plan_item_ids: ['s4'],
    posted_url: 'https://x.com/example/status/1',
    posted_at: '2026-09-30T15:00:00Z',
    created_at: '2026-09-30T09:00:00Z',
  },
  {
    ...base,
    id: 'p4',
    angle: 'Duplicate ideas are caught by their first line',
    status: 'dropped',
    draft: ['d'],
    body: ['An idea is refused when its first line is close to one already filed.'],
    source_plan_item_ids: [],
    dropped_at: '2026-09-29T10:00:00Z',
    created_at: '2026-09-29T09:00:00Z',
  },
];

const STEPS = [
  { id: 's1', number: 917, title: 'Price every paid press in Learn' },
  { id: 's2', number: 918, title: 'Price the paid presses in the other workspaces' },
  { id: 's3', number: 1201, title: 'Run the gate before pushing to main' },
  { id: 's4', number: 1330, title: 'Open every brief with its vision' },
];

export function PostsSurface() {
  const page = buildPostsPage({
    posts: ROWS.map((row) => socialPostFromRow(row)),
    steps: STEPS,
    notes: [],
    run: { id: 'r1', status: 'finished', createdAt: '2026-10-02T07:55:00Z', error: null, drafts: 2 },
    now: NOW,
  });
  return <PostsScreen page={page} />;
}

export function PostsDraftingSurface() {
  const page = buildPostsPage({
    posts: [],
    steps: [],
    notes: [],
    run: { id: 'r2', status: 'started', createdAt: '2026-10-02T11:50:00Z', error: null, drafts: 0 },
    now: NOW,
  });
  return <PostsScreen page={page} />;
}
