import { describe, expect, it } from 'vitest';
import { checkDraft, sourceProblems } from './post-check';
import {
  angleFromPost,
  isUploadedPostImage,
  ownsPostImagePath,
  postImagePath,
  postImageSrc,
  POSTS_RUN_HOLD_MINUTES,
  postsRunState,
  postsRunText,
  socialPostFromRow,
  sortPosts,
  xLength,
  type PostsRun,
} from './posts';

const EXAMPLE =
  'Every button in my app that calls Claude has to show what it costs. Dash wrote a test that ' +
  'walks every server action and fails the pre-merge check when one calls the model without a ' +
  'cost hint, naming the file and the function.';

describe('xLength', () => {
  it('counts plain text by characters', () => {
    expect(xLength('hello world')).toBe(11);
    expect(xLength(EXAMPLE)).toBe(EXAMPLE.length);
  });

  it('counts a link as 23 whatever its length', () => {
    expect(xLength('see https://example.com/a/very/long/path/indeed')).toBe(4 + 23);
    expect(xLength('see example.com')).toBe(4 + 23);
  });

  it('counts emoji and CJK as two', () => {
    expect(xLength('🚀')).toBe(2);
    expect(xLength('👍🏽')).toBe(2);
    expect(xLength('日本')).toBe(4);
  });
});

describe('checkDraft', () => {
  it('passes one of the guide examples', () => {
    const result = checkDraft({ angle: 'Paid buttons must show their cost', posts: [EXAMPLE] });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.lengths).toEqual([EXAMPLE.length]);
  });

  it('fails the guide draft to reject on several counts', () => {
    const result = checkDraft({
      angle: 'Hype',
      posts: [
        "This isn't just a dashboard — it's an AI-native dev shop. 1,400+ steps. The future is here. 🚀 #buildinpublic",
      ],
    });
    expect(result.ok).toBe(false);
    const text = result.problems.join('\n');
    expect(text).toMatch(/hashtag/);
    expect(text).toMatch(/emoji/);
    expect(text).toMatch(/em dash/);
    expect(text).toMatch(/launch language/);
  });

  it('fails a post over 280 and warns inside the margin', () => {
    expect(checkDraft({ angle: 'a', posts: ['x'.repeat(281)] }).ok).toBe(false);
    const close = checkDraft({ angle: 'a', posts: ['x '.repeat(135)] });
    expect(close.ok).toBe(true);
    expect(close.warnings).toHaveLength(1);
  });

  it('fails a thread of six', () => {
    expect(checkDraft({ angle: 'a', posts: Array(6).fill('ok') }).ok).toBe(false);
  });

  it('refuses private details, identifiers and other workspaces', () => {
    const cases = [
      'Mail me at someone@example.org',
      'It cost $4.20 to run',
      'The session cse_014oQRvbBBfKriJ3vXwUdUjn did it',
      'Project asjztutnqxbecruvyrbj is the database',
      'It now tracks my loan payments',
      'The site at selveyknight is live',
      'Call 0161 496 0000 today',
    ];
    for (const post of cases) {
      expect(checkDraft({ angle: 'a', posts: [post] }).ok, post).toBe(false);
    }
  });

  it('refuses a term the caller passes in, as a whole word', () => {
    expect(checkDraft({ angle: 'a', posts: ['I told Acme about it'] }, ['Acme']).ok).toBe(false);
    expect(checkDraft({ angle: 'a', posts: ['Acmeish is fine'] }, ['Acme']).ok).toBe(true);
  });

  it('matches a one-word capitalised name only with its capital', () => {
    expect(checkDraft({ angle: 'a', posts: ['Dash runs a check first'] }, ['Check']).ok).toBe(true);
    expect(checkDraft({ angle: 'a', posts: ['I applied to Check'] }, ['Check']).ok).toBe(false);
    expect(checkDraft({ angle: 'a', posts: ['bank of america'] }, ['Bank of America']).ok).toBe(false);
  });
});

describe('sourceProblems', () => {
  it('allows a dev step and a null-module step', () => {
    expect(sourceProblems({ label: '#1', module: 'dev', text: 'Add a check' })).toEqual([]);
    expect(sourceProblems({ label: '#2', module: null, text: 'See https://x.dev/a' })).toEqual([]);
  });

  it('refuses another workspace and a step about its data', () => {
    expect(sourceProblems({ label: '#3', module: 'jobs', text: 'Add a column' })).toHaveLength(1);
    expect(sourceProblems({ label: '#4', module: null, text: 'Track debt payoff' }).length).toBe(1);
  });
});

describe('postsRunState', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const run = (over: Partial<PostsRun>): PostsRun => ({
    id: 'r',
    status: 'started',
    createdAt: new Date(now - 5 * 60_000).toISOString(),
    error: null,
    drafts: 0,
    ...over,
  });

  it('is idle with no run', () => expect(postsRunState(null, now)).toBe('idle'));
  it('is going while a fresh run has written nothing', () =>
    expect(postsRunState(run({}), now)).toBe('going'));
  it('is finished once drafts carry the run, whatever the row says', () => {
    expect(postsRunState(run({ drafts: 3 }), now)).toBe('finished');
    expect(postsRunState(run({ status: 'failed', error: 'quiet', drafts: 3 }), now)).toBe('finished');
    expect(postsRunState(run({ status: 'finished' }), now)).toBe('finished');
  });
  it('is failed past the hold with nothing written', () => {
    const old = new Date(now - (POSTS_RUN_HOLD_MINUTES + 1) * 60_000).toISOString();
    expect(postsRunState(run({ createdAt: old }), now)).toBe('failed');
    expect(postsRunState(run({ status: 'failed', error: 'x' }), now)).toBe('failed');
  });
});

describe('postsRunText', () => {
  it('names the account, the skill and the guide', () => {
    const text = postsRunText({ userId: 'u-1' });
    expect(text).toContain('user_id u-1');
    expect(text).toContain('.claude/skills/posts/SKILL.md');
    expect(text).toContain('docs/X-POSTS.md');
    expect(text).toContain('3 to 5 drafts');
  });

  it('allows the screenshot commit and nothing else', () => {
    expect(postsRunText({ userId: 'u' })).toContain('screenshots under public/posts/');
  });

  it('asks for one draft when a step is named', () => {
    expect(postsRunText({ userId: 'u', focus: { number: 639 } })).toContain('#639 only');
  });

  it('quotes what the person asked for, line by line', () => {
    const text = postsRunText({ userId: 'u', focus: { ask: 'The gate\nand why it exists' } });
    expect(text).toContain('one draft about what the person asked for');
    expect(text).toContain('> The gate\n> and why it exists');
    expect(text).not.toContain('3 to 5 drafts');
  });
});

describe('socialPostFromRow and sortPosts', () => {
  it('reads a row and puts suggested ones first', () => {
    const base = {
      platform: 'x',
      angle: 'a',
      draft: ['d'],
      body: ['b'],
      source_plan_item_ids: ['s'],
      source_feedback_ids: null,
      image_paths: [],
      created_at: '2026-10-01T00:00:00Z',
    };
    const posted = socialPostFromRow({ ...base, id: '1', status: 'posted' });
    const suggested = socialPostFromRow({ ...base, id: '2', status: 'suggested' });
    expect(posted.sourceFeedbackIds).toEqual([]);
    expect(sortPosts([posted, suggested]).map((p) => p.id)).toEqual(['2', '1']);
  });
});

describe('angleFromPost', () => {
  it('takes the first sentence of a post the person wrote', () => {
    expect(angleFromPost('Todo is one list. It has a calendar too.')).toBe('Todo is one list.');
  });

  it('keeps a post with no full stop whole, on one line', () => {
    expect(angleFromPost('  a quick note\nabout the plan  ')).toBe('a quick note about the plan');
  });

  it('cuts a long first sentence at a word, under 120 characters', () => {
    const long = EXAMPLE.replace('. ', ', and ');
    const angle = angleFromPost(long);
    expect(angle.length).toBeLessThanOrEqual(121);
    expect(angle.endsWith('…')).toBe(true);
    expect(long.startsWith(angle.slice(0, -1))).toBe(true);
  });
});

describe('post image paths', () => {
  const user = '0b1c2d3e-0000-4000-8000-000000000001';
  const id = '9f8e7d6c-0000-4000-8000-000000000002';

  it('keeps an upload in your own folder under a fresh id', () => {
    const path = postImagePath(user, id, 'My screen shot (1).PNG');
    expect(path).toBe(`${user}/${id}-My-screen-shot-1-.PNG`);
    expect(ownsPostImagePath(user, path)).toBe(true);
    expect(ownsPostImagePath('someone-else', path)).toBe(false);
    expect(isUploadedPostImage(path)).toBe(true);
  });

  it('draws an upload through the signing route and a committed shot as it is', () => {
    const path = postImagePath(user, id, 'shot.png');
    expect(postImageSrc(path)).toBe(`/dev/posts/image?path=${encodeURIComponent(path)}`);
    expect(postImageSrc('/posts/2026-10-09-home-page.png')).toBe('/posts/2026-10-09-home-page.png');
    expect(postImageSrc('//elsewhere.example/x.png')).toBeNull();
    expect(isUploadedPostImage('/posts/2026-10-09-home-page.png')).toBe(false);
  });
});
