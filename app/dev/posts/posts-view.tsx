import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { POST_WANTS_MAX, type PostCard, type PostsPage } from '@/lib/dev/posts-page';
import { PostWantsLine } from './post-wants';
import { PostItem } from './post-item';
import { AskForPost, SuggestPosts } from './suggest-posts';
import type { XConnectionView, XConnectNotice } from '@/lib/x/account';
import { WritePost } from './write-post';
import { XConnection } from './x-connection';
import { XPostList } from './x-posts';
import { PageColumn } from '@/components/shell/page-width';
import { sectionSubject } from '@/lib/core/section-path';

/**
 * The Posts tab in Dev (plan #1419): X posts Dash drafted about building this
 * app, waiting ones first, then the posted ones, the posts on X that match no
 * draft (plan #1820) and the dropped ones, folded beneath.
 *
 * Apart from the route so the surface gallery draws the same thing from
 * fixtures (app/preview/posts-surfaces.tsx).
 */

export function PostList({ cards, postAs = null }: { cards: PostCard[]; postAs?: string | null }) {
  return (
    <ul className={cn(cardVariants(), 'divide-y divide-border')}>
      {cards.map((card) => (
        <PostItem key={card.post.id} card={card} postAs={postAs} />
      ))}
    </ul>
  );
}

/**
 * Where the last run stands, said when it is going, did not finish, or
 * finished without a draft, in which case the run's note says why.
 */
function RunLine({ page }: { page: PostsPage }) {
  // On a panel of its own, like the X row, rather than bare on the page.
  if (page.runState === 'going') {
    return (
      <p role="status" className={cn(cardVariants({ padding: 'dense' }), 'text-small text-ink-muted')}>
        Dash is drafting posts. They show here when it is done.
      </p>
    );
  }
  if (page.runState === 'failed') {
    return (
      <p role="alert" className={cn(cardVariants({ padding: 'dense' }), 'text-small text-caution')}>
        The last run did not finish{page.run?.error ? `: ${page.run.error}` : '.'}
      </p>
    );
  }
  if (page.runState === 'finished' && page.run?.drafts === 0) {
    return (
      <p role="status" className={cn(cardVariants({ padding: 'dense' }), 'text-small text-ink-muted')}>
        {page.run.note ? `Dash wrote no draft. ${page.run.note}` : 'The last run finished without a draft.'}
      </p>
    );
  }
  return null;
}

export function PostsScreen({
  page,
  x,
  xNotice,
  wantsPreview,
}: {
  page: PostsPage;
  /** The X connection (plan #1818); left out where a surface draws only the drafts. */
  x?: XConnectionView;
  xNotice?: XConnectNotice | null;
  /** The surface gallery's way to draw the wants box open, mid-save or refused. */
  wantsPreview?: { open?: boolean; pending?: boolean; error?: string };
}) {
  const none = page.planned.length + page.suggested.length + page.posted.length + page.dropped.length === 0;
  // Who a draft is posted as from the tab: only a sign-in that carries
  // tweet.write (plan #2072). Without it the X row says how to get one.
  const postAs = x?.state === 'connected' && x.canPost ? x.handle : null;
  return (
    <PageColumn className="space-y-6">
      <div>
        <PageHeader
          subject={sectionSubject('/dev/posts', 'Posts')}
          title="Posts"
          description="Drafts for X about building this app. Nothing goes to X until you press Post on one."
          actions={<SuggestPosts runState={page.runState} />}
        />
        <div className="-mt-3 space-y-1">
          <RunLine page={page} />
          <PostWantsLine
            text={page.wants.text}
            day={page.wantsDay}
            max={POST_WANTS_MAX}
            defaultOpen={wantsPreview?.open}
            pendingPreview={wantsPreview?.pending}
            errorPreview={wantsPreview?.error}
          />
          <AskForPost runState={page.runState} />
          <WritePost />
        </div>
      </div>

      {x && <XConnection view={x} notice={xNotice} />}

      {none ? (
        <EmptyState
          icon={Megaphone}
          title="No drafts yet"
          description="Suggest posts asks Dash for three to five X posts about building this app: what shipped lately, older work, how it is built, and things near it. Or write your own. Click a post to edit it, then press Post to send it to X, or post it yourself and paste the link back here."
        />
      ) : (
        <>
          {page.planned.length > 0 && (
            <SectionFold title="Planned" count={page.planned.length} defaultOpen>
              <PostList cards={page.planned} postAs={postAs} />
            </SectionFold>
          )}
          {page.suggested.length > 0 &&
            (page.planned.length > 0 ? (
              <SectionFold title="Suggested" count={page.suggested.length} defaultOpen>
                <PostList cards={page.suggested} postAs={postAs} />
              </SectionFold>
            ) : (
              <PostList cards={page.suggested} postAs={postAs} />
            ))}
        </>
      )}

      {page.posted.length > 0 && (
        <SectionFold title="Posted" count={page.posted.length} defaultOpen={page.suggested.length + page.planned.length === 0}>
          <PostList cards={page.posted} />
        </SectionFold>
      )}

      {page.onX.total > 0 && (
        <div id="posted-on-x" className="scroll-mt-bar">
          <SectionFold
            title="Posted on X"
            count={page.onX.total}
            defaultOpen={page.suggested.length + page.planned.length === 0}
          >
            <XPostList posts={page.onX.posts} total={page.onX.total} />
          </SectionFold>
        </div>
      )}

      {page.dropped.length > 0 && (
        <SectionFold title="Dropped" count={page.dropped.length} defaultOpen={false}>
          <PostList cards={page.dropped} />
        </SectionFold>
      )}
    </PageColumn>
  );
}
