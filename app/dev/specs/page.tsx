import Link from 'next/link';
import { MessageSquareText } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { createClient, requireUser } from '@/lib/auth/server';
import { SPECS } from '@/lib/specs/registry';
import { specCommentCounts } from '@/lib/specs/load';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Specs' };

/**
 * The documents that argue for what got built, with somewhere to argue back.
 *
 * They already existed in `docs/`, which is the right place for them: a
 * document making the case for a design belongs in the commit that makes the
 * design, reviewed in the same diff. What it could not do there is take a
 * comment — a reply to a paragraph went into a chat window and was gone by the
 * next session, so the reasoning and the objections to it lived in different
 * places and only one of them survived.
 *
 * So the text stays in the repository and is read from it, and only the
 * comments are stored. Nothing here can write a word of a spec, which is what
 * keeps the document and the code honest about each other.
 */
export default async function SpecsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const counts = await specCommentCounts(supabase, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Specs"
        description="The documents behind each module, read from the repository. Comment on any section; tag @dash in one to ask about it."
      />

      <ul className="space-y-2">
        {SPECS.map((spec) => {
          const count = counts[spec.slug] ?? 0;
          return (
            <li key={spec.slug}>
              <Link
                href={`/dev/specs/${spec.slug}`}
                className={cn(
                  cardVariants({ padding: 'dense' }),
                  'block transition-colors duration-150 hover:border-border-strong',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-body font-semibold text-ink">{spec.title}</h2>
                  {count > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-caption text-ink-muted">
                      <MessageSquareText className="size-3.5" strokeWidth={2} aria-hidden />
                      {count}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-ui text-ink-muted">{spec.blurb}</p>
                <p className="mt-2 text-caption text-ink-ghost">docs/{spec.file}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
