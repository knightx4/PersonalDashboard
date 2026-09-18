import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadSpec } from '@/lib/specs/load';
import { specBySlug } from '@/lib/specs/registry';
import { cn } from '@/lib/cn';
import { SpecSectionCard, SpecOrphan } from './spec-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: specBySlug(slug)?.title ?? 'Spec' };
}

/**
 * One specification, section by section, each with a thread under it.
 *
 * The document is cut on its top-level headings and nothing else. A comment on
 * 650 lines is a comment on nothing; a comment on "What an edge is" is a
 * comment on a decision, and the `##` sections of these documents are the
 * things somebody actually disagrees with.
 *
 * The prose renders through the vault's markdown pipeline, raw HTML disabled,
 * which is the same sanitizer for the same reason -- and here the content is
 * the repository's own, so the only thing it guards against is a document that
 * happens to contain markup.
 */
export default async function SpecPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = specBySlug(slug);
  if (!doc) notFound();

  const user = await requireUser();
  const supabase = await createClient();
  const { sections, orphans } = await loadSpec(supabase, user.id, doc);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p>
        <Link
          href="/dev/specs"
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Specs
        </Link>
      </p>

      <PageHeader title={doc.title} description={`docs/${doc.file}`} />

      {sections === null ? (
        // The file is gone from the repository. Said plainly, with whatever was
        // written about it still readable, because the conversation outlives
        // the heading it was filed under.
        <p className={cn(cardVariants(), 'border-dashed px-4 py-6 text-body text-ink-muted')}>
          <code>docs/{doc.file}</code> is not in the repository any more. Anything written about it
          is below.
        </p>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <SpecSectionCard key={section.anchor} section={section} />
          ))}
        </div>
      )}

      {orphans.length > 0 && (
        <section className="space-y-3 border-t border-border pt-5">
          <div>
            <h2 className="text-body font-semibold text-ink">Written about sections that have gone</h2>
            <p className="mt-1 text-ui text-ink-muted">
              These headings were rewritten or removed after somebody commented on them. The threads
              are kept: what was said about a decision is worth more than the heading it was said
              under.
            </p>
          </div>
          {orphans.map((orphan) => (
            <SpecOrphan key={orphan.id} orphan={orphan} />
          ))}
        </section>
      )}
    </div>
  );
}
