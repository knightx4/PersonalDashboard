import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CommentThread } from '@/components/dev/comment-thread';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { DevComment } from '@/lib/comments/load';
import type { SpecSectionWithThread } from '@/lib/specs/load';
import { specLinkHref } from '@/lib/specs/links';

/**
 * One section of a spec, and the thread under it.
 *
 * Server components: the prose is static and the only interactive part is the
 * thread, which is a client component already. Rendering markdown on the server
 * keeps react-markdown and its plugins out of the browser bundle entirely,
 * which matters on a document with eleven of these on one page.
 *
 * `rehype-raw` is deliberately absent here as it is in the vault, so embedded
 * HTML is not rendered. These documents are the repository's own, so this is
 * belt rather than braces -- but the rule is worth keeping uniform, because the
 * next thing rendered through this component might not be.
 */

function Prose({ markdown }: { markdown: string }) {
  return (
    <div className="vault-prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            const resolved = specLinkHref(href);
            // A link to a repository file with no page of its own. The text is
            // kept and the link is not, which says what it points at without
            // offering a click that 404s.
            if (resolved === null) return <span className="text-ink-muted">{children}</span>;

            const external = /^https?:\/\//i.test(resolved);
            return (
              <a
                href={resolved}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}

export function SpecSectionCard({ section }: { section: SpecSectionWithThread }) {
  return (
    <section id={section.anchor} className={cn(cardVariants(), 'scroll-mt-20 px-4 py-4')}>
      <h2 className="mb-3 text-body font-semibold text-ink">{section.heading}</h2>

      {section.body ? (
        <Prose markdown={section.body} />
      ) : (
        <p className="text-ui text-ink-ghost">Nothing under this heading.</p>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <CommentThread
          target="spec"
          id={section.id}
          thread={section.thread}
          label="Comment on this section"
          placeholder="What is wrong with this, or a question for Dash about it."
        />
      </div>
    </section>
  );
}

export function SpecOrphan({
  orphan,
}: {
  orphan: { id: string; heading: string; thread: DevComment[] };
}) {
  return (
    <div className={cn(cardVariants({ padding: 'dense' }), 'border-dashed')}>
      <h3 className="mb-2 text-ui font-semibold text-ink-muted">{orphan.heading}</h3>
      <CommentThread
        target="spec"
        id={orphan.id}
        thread={orphan.thread}
        label="Thread"
        placeholder="Add to this."
      />
    </div>
  );
}
