import Link, { linkVariants } from '@/components/ui/link';
import { cardVariants } from '@/components/ui/card';
import { LinkedText } from '@/components/ui/linked-text';
import { cn } from '@/lib/cn';
import { X_POSTS_PAGE, type XPostView } from '@/lib/dev/posts-page';

/**
 * Posted on X (plan #1820): the posts read from the person's X account that
 * match no draft, newest first, each linking to the post. A thread is listed
 * by its first post with how many posts it has. A long post is cut at six
 * lines; Open on X has the rest.
 *
 * The list starts at fifty and Show more adds fifty a press through `?onx=`,
 * since X returns up to 3,200.
 */
export function XPostList({ posts, total }: { posts: XPostView[]; total: number }) {
  const more = Math.min(total - posts.length, X_POSTS_PAGE);
  return (
    <div className="space-y-2">
      <ul className={cn(cardVariants(), 'divide-y divide-border')}>
        {posts.map((post) => (
          <li key={post.xPostId} className="flex flex-col gap-1.5 px-4 py-3">
            <p className="line-clamp-6 whitespace-pre-wrap break-words text-body text-ink">
              <LinkedText text={post.text} />
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
              <span className="tabular">{post.day}</span>
              {post.threadPosts > 1 && <span className="tabular">Thread of {post.threadPosts}</span>}
              <a
                href={post.url}
                target="_blank"
                rel="noreferrer"
                className={cn('press-area font-medium', linkVariants())}
              >
                Open on X
              </a>
            </p>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 text-small text-ink-muted">
          <span className="tabular">
            Showing {posts.length} of {total}
          </span>
          <Link
            href={`?onx=${posts.length + more}#posted-on-x`}
            scroll={false}
            className={cn('press-area font-medium', linkVariants())}
          >
            Show {more} more
          </Link>
        </p>
      )}
    </div>
  );
}
