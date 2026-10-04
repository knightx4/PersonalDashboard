import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { SpecDoc } from '@/lib/specs/registry';
import type { LoadedSpec } from '@/lib/specs/load';
import type { LatestFindings } from '@/lib/specs/findings';
import type { RuleState } from '@/lib/specs/rule-states';
import { SpecSectionCard, SpecOrphan } from './spec-view';
import { SpecRules } from './spec-rules';
import { SpecFindings } from '../spec-findings';

/**
 * One spec's page apart from its reads, so the surface gallery can draw it:
 * the rules and where each stands, what the audit found, then the document
 * section by section with a thread under each.
 */
export function SpecDocView({
  doc,
  sections,
  orphans,
  states,
  audit,
}: {
  doc: SpecDoc;
  sections: LoadedSpec['sections'];
  orphans: LoadedSpec['orphans'];
  states: RuleState[];
  audit: LatestFindings;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p>
        <Link
          href="/dev/specs"
          className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Specs
        </Link>
      </p>

      <PageHeader title={doc.title} description={`docs/${doc.file}`} />

      <SpecRules states={states} />

      {/* What the weekly audit found when it compared the code with this
          spec (plan #1525), under the rules and above the text it was
          compared with. */}
      <SpecFindings auditAt={audit.auditAt} findings={audit.findings} />

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
