import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import { cardVariants } from '@/components/ui/card';
import { Markdown } from '@/components/ui/markdown';
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
 * The markdown goes through the shared renderer (components/ui/markdown.tsx),
 * so embedded HTML is not rendered here any more than in the vault.
 */

/**
 * A link to a repository file with no page of its own keeps its text and
 * loses the link, which says what it points at without offering a click that
 * 404s. That is what `specLinkHref` returning null means.
 */
function Prose({ markdown }: { markdown: string }) {
  return <Markdown markdown={markdown} className="vault-prose" resolveHref={specLinkHref} />;
}

export function SpecSectionCard({ section }: { section: SpecSectionWithThread }) {
  return (
    <section id={section.anchor} className={cn(cardVariants(), 'scroll-mt-bar px-4 py-4')}>
      <h2 className="mb-3 text-body font-semibold text-ink">{section.heading}</h2>

      {section.body ? (
        <Prose markdown={section.body} />
      ) : (
        <p className="text-ui text-ink-ghost">Nothing under this heading.</p>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <Thread
          subject={threadRef('spec', section.id)}
          turns={section.thread}
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
      <Thread
        subject={threadRef('spec', orphan.id)}
        turns={orphan.thread}
        label="Thread"
        placeholder="Add to this."
      />
    </div>
  );
}
