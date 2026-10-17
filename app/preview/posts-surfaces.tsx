import { PostItem } from '@/app/dev/posts/post-item';
import { PostList, PostsScreen } from '@/app/dev/posts/posts-view';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { XPostList } from '@/app/dev/posts/x-posts';
import { SectionFold } from '@/components/ui/disclosure';
import { WritePost } from '@/app/dev/posts/write-post';
import { XConnection } from '@/app/dev/posts/x-connection';
import { xConnectNotice } from '@/lib/x/account';
import { socialPostFromRow } from '@/lib/dev/posts';
import { buildPostsPage, POST_WANTS_MAX, type PostWants, type XStoredPost } from '@/lib/dev/posts-page';
import { PostWantsLine } from '@/app/dev/posts/post-wants';
import { PageColumn } from '@/components/shell/page-width';

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
  x_post_id: null,
  x_candidate_id: null,
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
  {
    // A link the person added: X bills it at the URL rate, so its Post says $0.200.
    ...base,
    id: 'p5',
    angle: 'The gallery draws every screen before it is wired',
    status: 'suggested',
    draft: ['d'],
    body: [
      'Every screen in my app is drawn in a gallery from sample data and photographed on a phone and a laptop before it touches real data. Write-up here: https://example.com/gallery',
    ],
    source_plan_item_ids: [],
    created_at: '2026-10-02T07:00:00Z',
  },
];

/** Planned, the longest angle the tab allows and a source, so the section heads a full card. */
const PLANNED_ROW = {
  ...base,
  id: 'p6',
  angle: 'Planned for Thursday: a promoted draft sits above the suggestions until it is posted or demoted',
  status: 'planned',
  draft: ['d'],
  body: [
    'A draft I want to post this week gets a Promote button. It moves into a Planned section above the rest, and Demote sends it back if I change my mind.',
  ],
  source_plan_item_ids: ['s4'],
  created_at: '2026-10-01T09:00:00Z',
};

const STEPS = [
  { id: 's1', number: 917, title: 'Price every paid press in Learn', outline: '905.3' },
  { id: 's2', number: 918, title: 'Price the paid presses in the other workspaces', outline: '905.4' },
  { id: 's3', number: 1201, title: 'Run the gate before pushing to main', outline: '1188.2' },
  { id: 's4', number: 1330, title: 'Open every brief with its vision', outline: '1319.6' },
];

export function PostsSurface({
  wants,
  wantsPreview,
}: {
  wants?: PostWants;
  wantsPreview?: { open?: boolean; pending?: boolean; error?: string };
} = {}) {
  const page = buildPostsPage({
    posts: [...ROWS, PLANNED_ROW].map((row) => socialPostFromRow(row)),
    steps: STEPS,
    notes: [],
    run: { id: 'r1', status: 'finished', createdAt: '2026-10-02T07:55:00Z', error: null, note: null, drafts: 2 },
    now: NOW,
    wants,
  });
  return (
    <PostsScreen
      page={page}
      wantsPreview={wantsPreview}
      x={{ state: 'connected', handle: 'selveybuilds', lastSyncedAt: '2026-10-02T06:00:00Z', canPost: true }}
    />
  );
}

/* -------------------------------------------------------------------------
 * What I want from posts (plan #2227.2)
 * ---------------------------------------------------------------------- */

/** Saved text longer than one line, as a real preference gets. */
const WANTS: PostWants = {
  text:
    'Posts for people who build software with an AI, not for people who follow AI news. Say what broke and what I changed because of it, with the number when there is one. No hashtags, no emoji, no "excited to share", and never more than two posts in a thread.',
  updatedAt: '2026-10-01T18:30:00Z',
};

/** The tab with something saved: the line under the heading, collapsed. */
export function PostsWantsSurface() {
  return <PostsSurface wants={WANTS} />;
}

/** The line pressed: the box open on the saved text. */
export function PostsWantsEditSurface() {
  return <PostsSurface wants={WANTS} wantsPreview={{ open: true }} />;
}

/** Save pressed: the box mid-save, then one the action refused. */
export function PostsWantsSavingSurface() {
  return (
    <PageColumn className="space-y-6">
      <PostWantsLine text={WANTS.text} day="1 Oct" max={POST_WANTS_MAX} defaultOpen pendingPreview />
      <PostWantsLine
        text={WANTS.text}
        day="1 Oct"
        max={POST_WANTS_MAX}
        defaultOpen
        errorPreview="Keep it under 2,000 characters."
      />
    </PageColumn>
  );
}

/**
 * Post pressed once (plan #2072), the hidden part of each waiting draft: the
 * confirm saying where it goes and what X charges. The first holds a link,
 * so the warning about the URL rate shows. The second is a thread of three
 * whose first post went up before a send stopped, so Post sends the rest.
 */
export function PostsSendSurface() {
  const page = buildPostsPage({
    posts: [
      socialPostFromRow(ROWS[4]),
      socialPostFromRow({
        ...base,
        id: 'p6',
        angle: 'Posting from the dashboard, one confirmed press at a time',
        status: 'suggested',
        draft: ['d'],
        body: [
          'My dashboard can now post a draft to X itself. One press shows what it costs, a second sends it.',
          'A thread goes out one post at a time, each a reply to the one before, and the ids are kept as they come back.',
          'If X stops it halfway, the next press carries on from the last post that went up instead of starting again.',
        ],
        x_thread_ids: ['1845000000000000001'],
        source_plan_item_ids: [],
        created_at: '2026-10-02T10:00:00Z',
      }),
    ],
    steps: [],
    notes: [],
    run: null,
    now: NOW,
  });
  return (
    <PageColumn>
      <ul className={cn(cardVariants(), 'divide-y divide-border')}>
        {page.suggested.map((card) => (
          <PostItem key={card.post.id} card={card} postAs="selveybuilds" postArmed />
        ))}
      </ul>
    </PageColumn>
  );
}

/* -------------------------------------------------------------------------
 * Matched to X (plan #1820)
 * ---------------------------------------------------------------------- */

/** The post a near match asks about: the draft below, reworded on X. */
const CANDIDATE: XStoredPost = {
  xPostId: '1844000000000000001',
  text: 'Every button in my app that calls a model now shows what one press costs, based on what it cost before. A test walks each server action and fails the merge if one reaches a model with no hint by its button.',
  url: 'https://x.com/selveyknight/status/1844000000000000001',
  createdAt: '2026-10-01T17:20:00Z',
  threadPosts: 2,
};

/** Posts on X that match no draft: a thread, a long post past 280, a short one. */
const ON_X: XStoredPost[] = [
  {
    xPostId: '1844000000000000003',
    text: 'Spent the morning teaching the dashboard to read my own posts back from X. The first read pages through every post X will return, which is the latest 3,200, and costs about three dollars once.',
    url: 'https://x.com/selveyknight/status/1844000000000000003',
    createdAt: '2026-10-02T08:10:00Z',
    threadPosts: 3,
  },
  {
    xPostId: '1844000000000000002',
    text: 'A long one, the kind X keeps as a note: the dashboard now has a gate that runs the same checks CI runs before anything reaches main. Types, the build, lint, contrast, the design rules and the whole test suite against a local database. It takes about three minutes, and main has not stayed red since. The trick was making it the only way to push, so nobody has to remember it. Every session runs it after merging main into its branch, and pushes only when it ends with all clear. When another session broke main, the next one to merge finds out first and fixes it, because what it pushes is main. Seven failures in fourteen hours was the day that made it worth the three minutes, and it has paid for itself many times over since then. https://example.com/gate',
    url: 'https://x.com/selveyknight/status/1844000000000000002',
    createdAt: '2026-09-28T19:45:00Z',
    threadPosts: 1,
  },
  {
    xPostId: '1843000000000000009',
    text: 'Shipped.',
    url: 'https://x.com/selveyknight/status/1843000000000000009',
    createdAt: '2026-09-12T10:00:00Z',
    threadPosts: 1,
  },
];

/**
 * The tab once X has been read: a waiting draft asking "Is this it?" about a
 * post that reads close to it, one marked posted by the match, and the
 * posts on X that match no draft, with more to show than are listed. The
 * Posted and Posted on X folds are drawn open, as the tab draws them when
 * nothing is waiting, so their rows can be seen.
 */
export function PostsMatchedSurface() {
  const page = buildPostsPage({
    posts: [
      socialPostFromRow({ ...ROWS[0], x_candidate_id: CANDIDATE.xPostId, image_paths: [] }),
      socialPostFromRow({
        ...ROWS[2],
        x_post_id: '1843000000000000100',
        posted_url: 'https://x.com/selveyknight/status/1843000000000000100',
      }),
    ],
    steps: STEPS,
    notes: [],
    run: { id: 'r1', status: 'finished', createdAt: '2026-10-02T07:55:00Z', error: null, note: null, drafts: 2 },
    now: NOW,
    x: { candidates: [CANDIDATE], listed: ON_X, total: 212 },
  });
  return (
    <div className="space-y-6">
      {/* The two folds are drawn below, open, in the place the tab draws them closed. */}
      <PostsScreen
        page={{ ...page, posted: [], onX: { posts: [], total: 0 } }}
        x={{ state: 'connected', handle: 'selveyknight', lastSyncedAt: '2026-10-02T12:00:00Z' }}
      />
      <PageColumn className="space-y-6">
        <SectionFold title="Posted" count={page.posted.length}>
          <PostList cards={page.posted} />
        </SectionFold>
        <SectionFold title="Posted on X" count={page.onX.total}>
          <XPostList posts={page.onX.posts} total={page.onX.total} />
        </SectionFold>
      </PageColumn>
    </div>
  );
}

export function PostsDraftingSurface() {
  const page = buildPostsPage({
    posts: [],
    steps: [],
    notes: [],
    run: { id: 'r2', status: 'started', createdAt: '2026-10-02T11:50:00Z', error: null, note: null, drafts: 0 },
    now: NOW,
  });
  return <PostsScreen page={page} x={{ state: 'none' }} />;
}

/** An ask Dash declined: the run finished, wrote nothing, and left a note. */
export function PostsNoDraftSurface() {
  const page = buildPostsPage({
    posts: [],
    steps: [],
    notes: [],
    run: {
      id: 'r3',
      status: 'finished',
      createdAt: '2026-10-02T11:50:00Z',
      error: null,
      note: 'Nothing that shipped since the last post is about the gate, so there is nothing to cite.',
      drafts: 0,
    },
    now: NOW,
  });
  return <PostsScreen page={page} x={{ state: 'none' }} />;
}

/**
 * The X connection (plan #1818) in each of its states, one under another:
 * keys not set (pointing at setup step #1816), not connected, X stopped
 * accepting the sign-in, and connected with a fifteen-character handle, the
 * longest X allows. The lines a cancelled and a refused sign-in leave sit in
 * the second and third. Connected, the row offers Check X now (plan #1819);
 * the last one shows the line a read X stopped at its rate limit leaves.
 * The first connected row is a sign-in from before posting was added (plan
 * #2072), which says to disconnect and connect once more.
 */
export function PostsXSurface() {
  return (
    <PageColumn className="space-y-6">
      <XConnection view={{ state: 'unconfigured', setupStep: 1816 }} />
      <XConnection view={{ state: 'none' }} notice={xConnectNotice('denied')} />
      <XConnection view={{ state: 'disconnected', handle: 'selveyknight' }} notice={xConnectNotice('exchange')} />
      <XConnection view={{ state: 'connected', handle: 'selveyknightdev', lastSyncedAt: null, canPost: false }} />
      <XConnection
        view={{
          state: 'connected',
          handle: 'selveybuilds',
          canPost: true,
          lastSyncedAt: '2026-10-11T12:00:00Z',
          problem:
            'X’s rate limit was reached, so the read stopped. The next read picks up where this one stopped.',
        }}
      />
    </PageColumn>
  );
}

/** Write your own, opened: the compose box a post the person writes goes in. */
export function PostsWriteSurface() {
  return (
    <PageColumn>
      <WritePost defaultOpen />
    </PageColumn>
  );
}

/* -------------------------------------------------------------------------
 * Comments on a draft (plan #2202.2)
 * ---------------------------------------------------------------------- */

/**
 * A draft's comment thread: a waiting draft Dash shortened when asked, with
 * a note under it that has no tag and so stays a note, and a posted one
 * whose tagged comment Dash read and marked seen without replying.
 */
export function PostsThreadSurface() {
  const threads = new Map([
    [
      'public.social_posts:p2',
      [
        { id: 't1', author: 'me' as const, body: '@dash make this shorter', createdAt: '2026-10-02T10:02:00Z' },
        {
          id: 't2',
          author: 'claude' as const,
          body: 'Cut the thread to one post. I kept the fourteen hours and the seven failures, and took out how the gate runs.',
          createdAt: '2026-10-02T10:02:40Z',
        },
        { id: 't3', author: 'me' as const, body: 'Better. Post this one on Monday.', createdAt: '2026-10-02T10:05:00Z' },
      ],
    ],
    [
      'public.social_posts:p3',
      [
        {
          id: 't4',
          author: 'me' as const,
          body: '@dash this one did well, keep the next ones this short',
          createdAt: '2026-10-01T09:00:00Z',
          acknowledgedAt: '2026-10-01T09:00:30Z',
        },
      ],
    ],
  ]);
  const page = buildPostsPage({
    posts: [
      socialPostFromRow({
        ...ROWS[1],
        body: [
          'Several Dash sessions merge to main in my app each day. One day main stayed red for fourteen hours through seven failures, and a local check would have caught every one. Now every session runs that check before it pushes.',
        ],
      }),
      socialPostFromRow(ROWS[2]),
    ],
    steps: STEPS,
    notes: [],
    run: null,
    now: NOW,
    threads,
  });
  return (
    <PageColumn>
      <PostList cards={[...page.suggested, ...page.posted]} />
    </PageColumn>
  );
}

/** Add a comment pressed on a draft with no thread yet: the box, open and empty. */
export function PostsCommentSurface() {
  const page = buildPostsPage({
    posts: [socialPostFromRow({ ...ROWS[0], image_paths: [] })],
    steps: STEPS,
    notes: [],
    run: null,
    now: NOW,
  });
  return (
    <PageColumn>
      <ul className={cn(cardVariants(), 'divide-y divide-border')}>
        {page.suggested.map((card) => (
          <PostItem key={card.post.id} card={card} postAs="selveybuilds" commentOpen />
        ))}
      </ul>
    </PageColumn>
  );
}
