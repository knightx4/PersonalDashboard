'use client';

import { UserMinus, UserPlus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { updateContact } from '@/app/jobs/(app)/contacts/actions';

/**
 * Marking someone a potential lead, or taking the mark off, from their line
 * in the list (note e5b6bad0). The page reloads with them in their new
 * section; a failed write puts the mark back and says why in the tooltip.
 */
export function LeadToggle({ contactId, lead: initial, name }: { contactId: string; lead: boolean; name: string }) {
  const [lead, setLead] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = error ?? (lead ? `Remove ${name} as a lead` : `Add ${name} as a lead to reach out to`);

  return (
    <IconButton
      label={label}
      size="sm"
      pending={pending}
      className={error ? 'text-danger' : undefined}
      onClick={() => {
        const next = !lead;
        setLead(next);
        setError(null);
        startTransition(async () => {
          const result = await updateContact(contactId, { potentialLead: next });
          if (result.error) {
            setLead(!next);
            setError(result.error);
          }
        });
      }}
    >
      {lead ? <UserMinus strokeWidth={1.75} aria-hidden /> : <UserPlus strokeWidth={1.75} aria-hidden />}
    </IconButton>
  );
}
