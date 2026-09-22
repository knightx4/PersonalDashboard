import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ImportForm } from './import-form';
import { StartForm } from './start-form';

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
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Reading lists
        </Link>
      </p>

      <PageHeader
        title="New track"
        description="Start with a topic you want to learn about, or paste a reading list somebody gave you."
      />

      <div className="max-w-2xl space-y-8">
        <section>
          <h2 className="mb-3 text-body font-semibold text-ink">Start a topic</h2>
          <StartForm />
        </section>

        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="text-small uppercase tracking-wide text-ink-muted">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <section>
          <h2 className="mb-1 text-body font-semibold text-ink">Paste a reading list</h2>
          <p className="mb-3 text-body text-ink-muted">
            Each item gets found, priced and pointed at the part worth reading.
          </p>
          <ImportForm />
        </section>
      </div>
    </>
  );
}
