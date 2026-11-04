'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { letterheadAction } from '@/app/you/details/actions';

/**
 * Downloads the cover letter as a PDF laid out like the Word letters: today's
 * date and the company above it, the contact line at the foot. Built in the
 * browser, so nothing is stored; pdf-lib loads only when it is pressed. The
 * name it is signed with and the contact line are read from the person's
 * Details tab at that moment.
 */
export function LetterPdf({ text, company }: { text: string; company: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const [{ coverLetterPdf, letterFileName }, { deviceTimeZone }, letterhead] =
        await Promise.all([
          import('@/lib/jobs/cover-letter-pdf'),
          import('@/lib/core/when'),
          letterheadAction(),
        ]);
      const bytes = await coverLetterPdf({
        letter: text,
        company,
        timeZone: deviceTimeZone() ?? 'UTC',
        letterhead,
      });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = letterFileName(company, letterhead.signer);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('The PDF could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => void download()}
      >
        <Download strokeWidth={1.75} aria-hidden />
        {busy ? 'Making PDF…' : 'Download PDF'}
      </Button>
      {error && (
        <span role="alert" className="text-small text-danger">
          {error}
        </span>
      )}
    </>
  );
}
