'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmStep } from '@/components/ui/confirm-step';

/**
 * The address, and the one-click copy that is how it actually gets used.
 *
 * It is twenty-four random characters, so it is never typed: it is copied into
 * a newsletter's signup form. Shown in full rather than shortened, because a
 * shortened one cannot be checked against what was pasted.
 */
export function AddressCard({
  address,
  onReplace,
}: {
  address: string;
  /** Given on News settings, where the address can be swapped for a new one. */
  onReplace?: () => Promise<unknown>;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="break-all rounded-control bg-sunken px-3 py-2 text-ui text-ink">
        {address}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard.writeText(address);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? (
          <Check className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Copy className="size-3.5" strokeWidth={1.75} />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {onReplace && (
        <ConfirmStep
          action={onReplace}
          prompt="The address above stops working at once and anything sent to it is dropped, so sign newsletters up again with the new one. Nothing already here is deleted."
          confirmLabel="Yes, replace it"
          align="start"
        >
          Replace my address
        </ConfirmStep>
      )}
    </div>
  );
}
