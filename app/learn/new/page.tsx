import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

export default function NewTrackPage() {
  return (
    <>
      <p className="mb-3">
        <Link
          href="/learn"
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Tracks
        </Link>
      </p>

      <PageHeader
        title="New track"
        description="Paste a reading list and each item gets found, priced and pointed at the part worth reading."
      />

      <div className="max-w-2xl">
        <ImportForm />
      </div>
    </>
  );
}
