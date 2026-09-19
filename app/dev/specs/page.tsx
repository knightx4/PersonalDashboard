import Link from 'next/link';
import { MessageSquareText } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Disclosure } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { createClient, requireUser } from '@/lib/auth/server';
import { SPECS, groupSpecs, type SpecDoc } from '@/lib/specs/registry';
import { specCommentCounts } from '@/lib/specs/load';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Specs' };

/**
 * The documents that argue for what got built, with somewhere to argue back.
 *
 * They already existed in `docs/`, which is the right place for them: a
 * document making the case for a design belongs in the commit that makes the
 * design, reviewed in the same diff. What it could not do there is take a
 * comment. A reply to a paragraph went into a chat window and was gone by the
 * next session, so the reasoning and the objections to it lived in different
 * places and only one of them survived.
 *
 * So the text stays in the repository and is read from it, and only the
 * comments are stored. Nothing here can write a word of a spec, which is what
 * keeps the document and the code honest about each other.
 */

function SpecRow({ spec, comments }: { spec: SpecDoc; comments: number }) {
  return (
    <li>
      <Link
        href={`/dev/specs/${spec.slug}`}
        className={cn(
          cardVariants({ padding: 'dense' }),
          'block transition-colors duration-150 hover:border-border-strong',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-body font-semibold text-ink">{spec.title}</h3>
          {comments > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-caption text-ink-muted">
              <MessageSquareText className="size-3.5" strokeWidth={2} aria-hidden />
              {comments}
            </span>
          )}
        </div>
        <p className="mt-1 text-ui text-ink-muted">{spec.blurb}</p>
        <p className="mt-2 text-caption text-ink-ghost">docs/{spec.file}</p>
      </Link>
    </li>
  );
}

export default async function SpecsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const counts = await specCommentCounts(supabase, user.id);
  const groups = groupSpecs(SPECS, counts);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Specs"
        description="The documents behind each workspace, read from the repository. Comment on any section; tag @dash in one to ask about it."
      />

      <div className="space-y-2">
        {groups.map((group) => (
          /*
            Open by default, and not an accordion. There are seven groups of
            one to three documents, so the whole page fits on a screen either
            way, and the fold is for putting a workspace you are not working on
            out of sight rather than for making the page fit.

            The count on the folded row is the number of documents and the
            number of comments on them, which is what decides whether a closed
            group is worth opening. A fold that hides its own count has moved
            the work rather than saved it.
          */
          <Disclosure
            key={group.module ?? 'app'}
            title={group.label}
            defaultOpen
            meta={
              <span className="flex items-center gap-3">
                <span>
                  {group.specs.length} {group.specs.length === 1 ? 'document' : 'documents'}
                </span>
                {group.comments > 0 && (
                  <span className="flex items-center gap-1">
                    <MessageSquareText className="size-3.5" strokeWidth={2} aria-hidden />
                    {group.comments}
                  </span>
                )}
              </span>
            }
          >
            <ul className="space-y-2 pt-2">
              {group.specs.map((spec) => (
                <SpecRow key={spec.slug} spec={spec} comments={counts[spec.slug] ?? 0} />
              ))}
            </ul>
          </Disclosure>
        ))}
      </div>
    </div>
  );
}
