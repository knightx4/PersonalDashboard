import Link from '@/components/ui/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ImportForm } from './import-form';
import { StartForm } from './start-form';
import { SectionLabel, SectionHeading } from '@/components/ui/section-heading';

export const dynamic = 'force-dynamic';

/**
 * Two ways in, and the order matters.
 *
 * Writing down what you want to learn comes first because it is the more
 * common starting point and the cheaper act: you already know the subject, and
 * nothing has to be searched for. Pasting a list is second because it depends
 * on somebody having already told you what to read.
 */
export default function NewTrackPage() {
  return (
    <>
      <p className="mb-3">
        <Link
          href="/learn/lists"
          className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
          Reading lists
        </Link>
      </p>

      <PageHeader title="New reading list" />

      <div className="max-w-2xl space-y-8">
        <section>
          <SectionHeading title="Start a topic" className="mb-3" />
          <StartForm />
        </section>

        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <SectionLabel as="span">or</SectionLabel>
          <span className="h-px flex-1 bg-border" />
        </div>

        <section>
          <SectionHeading title="Paste a reading list" className="mb-3" />
          <ImportForm />
        </section>
      </div>
    </>
  );
}
