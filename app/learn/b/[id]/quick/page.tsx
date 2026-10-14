import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuickRead } from '@/lib/learn/briefs/quick-read';
import { QuickRead } from './quick-read';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function read(id: string) {
  if (!UUID.test(id)) return null;
  const supabase = await createLearnClient();
  return loadQuickRead(supabase, id);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const page = await read((await params).id);
  return { title: page ? `Quick read: ${page.brief.question}` : 'Quick read' };
}

/** The quick read of one brief's sources (plan #2023.6); quick-read.tsx draws it. */
export default async function BriefQuickReadPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await read((await params).id);
  if (!page) notFound();
  return (
    <PageColumn className="max-w-2xl">
      <PageHeader
        crumbs={[
          { label: 'Learn', href: '/learn' },
          { label: page.brief.question, href: `/learn/b/${page.brief.id}` },
          { label: 'Quick read', href: `/learn/b/${page.brief.id}/quick` },
        ]}
        title="Quick read"
      />
      <QuickRead briefId={page.brief.id} status={page.brief.status} cards={page.cards} />
    </PageColumn>
  );
}
