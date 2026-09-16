'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The address, and the one-click copy that is how it actually gets used.
 *
 * It is twenty-four random characters, so it is never typed: it is copied into
 * a newsletter's signup form. Shown in full rather than shortened, because a
 * shortened one cannot be checked against what was pasted.
 */
export function AddressCard({ address }: { address: string }) {
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
    </div>
  );
}
