import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { BookOpen } from 'lucide-react';
import { loadSellAssistant } from '@/lib/sell/load';
import { formatMoney } from '@/lib/money';
import { SellPathGroup, SellSettingsForm } from './sell-ui';
import type { SellPath } from '@/lib/sell/route';

export const metadata = { title: 'Sell assistant' };

const PATH_ORDER: SellPath[] = [
  'list_individually',
  'buyback',
  'lot',
  'donate',
];

export default async function SellPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { rows, netFloorCents, effortCents, needsConfirmationCount } =
    await loadSellAssistant({ supabase, userId: user.id });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Sell assistant"
        description="Net-based routing for confirmed ISBN books. Drafts only — nothing posts without you."
        actions={
          <Link
            href="/inventory/add"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Add books
          </Link>
        }
      />

      <SellSettingsForm netFloorCents={netFloorCents} effortCents={effortCents} />

      <p className="text-sm text-ink-muted">
        Floor {formatMoney(netFloorCents)} · Effort {formatMoney(effortCents)}
        {needsConfirmationCount > 0
          ? ` · ${needsConfirmationCount} book(s) waiting on edition confirm`
          : ''}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No sell-ready books yet"
          description="Add books with an ISBN (scan or search), confirm any ambiguous editions, then come back for routing."
          action={{ label: 'Add owned books', href: '/inventory/add' }}
        />
      ) : (
        PATH_ORDER.map((path) => (
          <SellPathGroup
            key={path}
            path={path}
            rows={rows.filter((r) => r.path === path)}
          />
        ))
      )}
    </div>
  );
}
