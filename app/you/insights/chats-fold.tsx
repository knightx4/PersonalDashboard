'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SectionFold } from '@/components/ui/disclosure';
import { FieldError } from '@/components/ui/field';
import { formatDateInline } from '@/lib/jobs/applications/load';
import { formatNumber } from '@/lib/money';
import { chatBatches, readClaudeExport, type ChatLine, type ChatStats } from '@/lib/you/claude-chats';

export type ChatsActions = {
  importBatch: (batch: ChatLine[]) => Promise<{ error: string | null; added?: number }>;
  refresh: () => Promise<void>;
};

/**
 * Their chats with Claude (you 0019): how many of their messages the
 * insights runs can read, and the import of the claude.ai export. The file
 * is read here in the browser; only their own messages are sent, in batches.
 */
export function ChatsFold({
  stats,
  timezone,
  actions,
  defaultOpen = false,
}: {
  stats: ChatStats;
  timezone: string;
  actions: ChatsActions;
  defaultOpen?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const date = (iso: string | null) => (iso ? formatDateInline(iso, timezone) : '');

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setProgress('Reading the export…');
    try {
      const lines = readClaudeExport(new Uint8Array(await file.arrayBuffer()));
      if (lines.length === 0) {
        setProgress(null);
        setError('There are none of your messages in this file.');
        return;
      }
      const batches = chatBatches(lines);
      let added = 0;
      for (const [index, batch] of batches.entries()) {
        setProgress(`Saving ${index + 1} of ${batches.length}…`);
        const result = await actions.importBatch(batch);
        if (result.error) {
          setError(`${result.error} ${formatNumber(added)} new messages were saved before this.`);
          setProgress(null);
          return;
        }
        added += result.added ?? 0;
      }
      setProgress(
        `Read ${formatNumber(lines.length)} of your messages; ${formatNumber(added)} were new.`,
      );
      await actions.refresh();
    } catch (failure) {
      setProgress(null);
      setError(failure instanceof Error ? failure.message : 'This file could not be read.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const hint =
    stats.imported > 0
      ? `${formatNumber(stats.imported)} messages${stats.lastImportedAt ? `, imported ${date(stats.lastImportedAt)}` : ''}`
      : 'None imported yet';

  return (
    <SectionFold title="Your chats with Claude" hint={hint} defaultOpen={defaultOpen}>
      <div className="mt-2 space-y-3">
        <p className="text-ui text-ink-muted">
          Dash reads what you wrote in your claude.ai chats, never Claude&rsquo;s replies, to find what your notes
          leave out.
          {stats.imported > 0 && stats.firstSaidAt && stats.lastSaidAt
            ? ` It has your messages from ${date(stats.firstSaidAt)} to ${date(stats.lastSaidAt)}.`
            : ''}
          {stats.saved > 0 ? ` ${formatNumber(stats.saved)} more were saved during chats.` : ''}
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-ui text-ink-muted">
          <li>On claude.ai, open Settings, then Privacy, and choose Export data.</li>
          <li>When the email arrives, download the zip.</li>
          <li>Choose it here. A newer export adds only what is new.</li>
        </ol>
        <input
          ref={input}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          className="sr-only"
          id="claude-export"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
        <Button type="button" size="sm" variant="secondary" pending={busy} onClick={() => input.current?.click()}>
          {busy ? 'Importing…' : 'Import export'}
        </Button>
        {progress && (
          <p className="text-ui text-ink-muted" role="status">
            {progress}
          </p>
        )}
        <FieldError>{error}</FieldError>
      </div>
    </SectionFold>
  );
}
