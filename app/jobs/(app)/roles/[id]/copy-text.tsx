'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';

/** How long the button says it copied. */
const COPIED_FOR_MS = 1800;

/**
 * Copies an answer or the cover letter as it reads, for pasting into the
 * application form (note 69abdbad). Says Copied for a moment, or says so when
 * the browser refused.
 */
export function CopyText({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const label = copied
    ? 'Copied'
    : failed
      ? `Could not copy. Select the ${what} instead.`
      : `Copy the ${what}`;

  return (
    <Tooltip label={label}>
      <IconButton
        size="sm"
        label={label}
        onClick={() => {
          setFailed(false);
          (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('No clipboard'))).then(
            () => setCopied(true),
            () => setFailed(true),
          );
        }}
      >
        {copied ? (
          <Check strokeWidth={1.75} aria-hidden />
        ) : (
          <Copy strokeWidth={1.75} aria-hidden />
        )}
      </IconButton>
    </Tooltip>
  );
}
