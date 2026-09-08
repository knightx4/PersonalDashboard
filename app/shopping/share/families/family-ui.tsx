'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { PendingSuggestion } from '@/lib/share/families-store';
import { acceptFamily, dismissFamily } from './actions';

const ROLE_LABEL: Record<string, string> = {
  base: 'base game',
  expansion: 'expansion',
  edition: 'edition',
  accessory: 'accessory',
  member: 'in the family',
};

export function FamilySuggestionCard({ family }: { family: PendingSuggestion }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  if (done) return <p className="text-ui text-ink-muted">{done}</p>;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ui font-semibold text-ink">{family.name}</h2>
          <p className="text-ui text-ink-muted">{family.members.length} games</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await acceptFamily({
                  slug: family.slug,
                  name: family.name,
                  members: family.members.map((m) => ({
                    inventoryItemId: m.inventoryItemId,
                    role: m.role,
                    confidence: m.confidence,
                  })),
                });
                setDone(result.error ?? result.message ?? null);
              })
            }
          >
            Group them
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await dismissFamily({
                  slug: family.slug,
                  name: family.name,
                  inventoryItemIds: family.members.map((m) => m.inventoryItemId),
                });
                setDone(result.error ?? result.message ?? null);
              })
            }
          >
            Not related
          </Button>
        </div>
      </div>

      <ul className="mt-3 space-y-1">
        {family.members.map((member) => (
          <li key={member.inventoryItemId} className="text-ui text-ink">
            {member.name}
            <span className="text-ink-muted"> — {ROLE_LABEL[member.role] ?? member.role}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
