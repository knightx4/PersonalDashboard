import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import type { PostCard, PostsPage } from '@/lib/dev/posts-page';
import { PostItem } from './post-item';
import { AskForPost, SuggestPosts } from './suggest-posts';
import { WritePost } from './write-post';

/**
 * The Posts tab in Dev (plan #1419): X posts Dash drafted about building this
 * app, waiting ones first, then the posted and dropped ones folded beneath.
 *
 * Apart from the route so the surface gallery draws the same thing from
 * fixtures (app/preview/posts-surfaces.tsx).
 */

function PostList({ cards }: { cards: PostCard[] }) {
  return (
    <ul className={cn(cardVariants(), 'divide-y divide-border')}>
      {cards.map((card) => (
        <PostItem key={card.post.id} card={card} />
      ))}
    </ul>
  );
}

/** Where the last run stands, said only when it is going or did not finish. */
function RunLine({ page }: { page: PostsPage }) {
  if (page.runState === 'going') {
    return (
      <p role="status" className="text-small text-ink-muted">
        Dash is drafting posts. They show here when it is done.
      </p>
    );
  }
  if (page.runState === 'failed') {
    return (
      <p role="alert" className="text-small text-caution">
        The last run did not finish{page.run?.error ? `: ${page.run.error}` : '.'}
      </p>
    );
  }
  return null;
}

export function PostsScreen({ page }: { page: PostsPage }) {
  const none = page.suggested.length + page.posted.length + page.dropped.length === 0;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <PageHeader
          title="Posts"
          description="Drafts for X about building this app. Dash never posts; you do."
          actions={<SuggestPosts runState={page.runState} />}
        />
        <div className="-mt-3 space-y-1">
          <RunLine page={page} />
          <AskForPost runState={page.runState} />
          <WritePost />
        </div>
      </div>

      {none ? (
        <EmptyState
          icon={Megaphone}
          title="No drafts yet"
          description="Suggest posts asks Dash for three to five X posts about what shipped since the last one you posted, each citing the steps it came from. Or write your own. Click a post to edit it, copy it, post it on X yourself, then paste the link back here."
        />
      ) : (
        page.suggested.length > 0 && <PostList cards={page.suggested} />
      )}

      {page.posted.length > 0 && (
        <SectionFold title="Posted" count={page.posted.length} defaultOpen={page.suggested.length === 0}>
          <PostList cards={page.posted} />
        </SectionFold>
      )}

      {page.dropped.length > 0 && (
        <SectionFold title="Dropped" count={page.dropped.length} defaultOpen={false}>
          <PostList cards={page.dropped} />
        </SectionFold>
      )}
    </div>
  );
}
