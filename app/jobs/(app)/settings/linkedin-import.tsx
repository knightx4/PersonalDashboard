'use client';

import { useId, useState, useTransition } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { SectionHeading } from '@/components/ui/section-heading';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/money';
import type { Counts } from '@/lib/imports/types';
import {
  IMPORT_MAX_BYTES,
  IMPORTS_BUCKET,
  OUTCOMES,
  countsSentence,
  importUploadPath,
  type KindCountsView,
  type LinkedInPlanView,
  type LinkedInRunView,
  type SkippedFileView,
} from '@/lib/jobs/linkedin-import';
import { applyLinkedInImport, planLinkedInImport } from './linkedin-actions';

/**
 * The LinkedIn tab of Jobs settings (plan #2432.9): choose the export zip,
 * see what importing it would add, change, leave the same, keep of your edits
 * and skip for each kind of record, then press Import. Below, the imports
 * already applied, each with its counts and the files it left out.
 *
 * The zip goes from the browser straight into your folder of the imports
 * bucket, so an export of any size never passes through a server action's
 * body; the actions read it back from there.
 */

export type LinkedInImportPhase =
  | { step: 'choose' }
  | { step: 'reading'; fileName: string }
  | { step: 'planned'; plan: LinkedInPlanView }
  | { step: 'applying'; plan: LinkedInPlanView }
  | { step: 'error'; message: string };

export function LinkedInImportSection({
  runs,
  initial = { step: 'choose' },
}: {
  runs: LinkedInRunView[];
  /** The gallery's: the phase to draw. */
  initial?: LinkedInImportPhase;
}) {
  const [phase, setPhase] = useState<LinkedInImportPhase>(initial);
  const [, startTransition] = useTransition();
  const toast = useToast();

  function choose(file: File) {
    setPhase({ step: 'reading', fileName: file.name });
    startTransition(async () => {
      const uploaded = await upload(file);
      if ('error' in uploaded) return setPhase({ step: 'error', message: uploaded.error });
      const result = await planLinkedInImport({ path: uploaded.path, fileName: file.name });
      setPhase('error' in result ? { step: 'error', message: result.error } : { step: 'planned', plan: result.plan });
    });
  }

  function apply(plan: LinkedInPlanView) {
    setPhase({ step: 'applying', plan });
    startTransition(async () => {
      const result = await applyLinkedInImport({ path: plan.path, fileName: plan.fileName });
      if ('error' in result) return setPhase({ step: 'error', message: result.error });
      toast({ text: `Imported: ${countsSentence(plan.totals, 'done').toLowerCase()}.` });
      setPhase({ step: 'choose' });
    });
  }

  return (
    <div className="space-y-6">
      {phase.step === 'planned' || phase.step === 'applying' ? (
        <PlanPreview
          plan={phase.plan}
          applying={phase.step === 'applying'}
          onImport={() => apply(phase.plan)}
          onCancel={() => setPhase({ step: 'choose' })}
        />
      ) : (
        <ChooseExport
          reading={phase.step === 'reading' ? phase.fileName : null}
          error={phase.step === 'error' ? phase.message : null}
          onChoose={choose}
        />
      )}
      <RunHistory runs={runs} />
    </div>
  );
}

/** Put the zip in your folder of the imports bucket, under a fresh name. */
async function upload(file: File): Promise<{ path: string } | { error: string }> {
  if (!/\.zip$/i.test(file.name)) {
    return { error: `${file.name} is not a zip file. Choose the zip LinkedIn emailed you, without unpacking it.` };
  }
  if (file.size > IMPORT_MAX_BYTES) return { error: `${file.name} is over 200 MB, the most one upload can hold.` };
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'You are signed out. Sign in again to upload.' };
  const path = importUploadPath(data.user.id, crypto.randomUUID(), file.name);
  const { error } = await supabase.storage
    .from(IMPORTS_BUCKET)
    .upload(path, file, { contentType: 'application/zip', upsert: false });
  if (error) return { error: `${file.name} could not be uploaded: ${error.message}` };
  return { path };
}

function ChooseExport({
  reading,
  error,
  onChoose,
}: {
  reading: string | null;
  error: string | null;
  onChoose: (file: File) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      {error && <Banner tone="bad">{error}</Banner>}
      <Field
        id={`${id}-zip`}
        label="Your LinkedIn export"
        hint="The zip LinkedIn emails you from Settings, Data privacy, Get a copy of your data. Nothing is written until you press Import."
      >
        {/* A file input keeps its native control; only the label is ours. */}
        <input
          id={`${id}-zip`}
          type="file"
          accept=".zip,application/zip"
          disabled={reading !== null}
          className={cn(
            'block w-full text-body text-ink-muted',
            'file:mr-3 file:h-(--control-h) file:cursor-pointer file:rounded-control file:border file:border-control',
            'file:bg-surface file:px-3 file:text-ui file:font-medium file:text-ink hover:file:bg-sunken',
          )}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChoose(file);
            e.target.value = '';
          }}
        />
      </Field>
      {reading && (
        <p className="text-small text-ink-muted" role="status">
          Reading {reading}…
        </p>
      )}
    </div>
  );
}

function PlanPreview({
  plan,
  applying,
  onImport,
  onCancel,
}: {
  plan: LinkedInPlanView;
  applying: boolean;
  onImport: () => void;
  onCancel: () => void;
}) {
  const writes = plan.totals.added + plan.totals.updated;
  // The file and Import come first, so the press is in reach on a phone with
  // the counts under it.
  return (
    <div className="space-y-3">
      <div>
        <p className="break-all text-ui font-semibold text-ink">{plan.fileName}</p>
        <p className="text-small text-ink-muted">
          {plan.exportDate ? `Made ${plan.exportDate} · ` : ''}
          {plan.files} {plan.files === 1 ? 'file' : 'files'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onImport} pending={applying} disabled={applying}>
          {applying ? 'Importing…' : 'Import'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={applying}>
          Choose another file
        </Button>
      </div>
      {applying && (
        <p className="text-small text-ink-muted" role="status">
          Writing {formatNumber(writes)} {writes === 1 ? 'record' : 'records'}. Keep this page open; it can take
          a minute.
        </p>
      )}
      <CountsTable kinds={plan.kinds} totals={plan.totals} />
      {plan.totals.kept > 0 && (
        <p className="text-small text-ink-muted">
          Kept means a row you edited or removed since an earlier import; it stays as you left it.
        </p>
      )}
      {plan.skipped.length > 0 && <SkippedFiles files={plan.skipped} of={plan.files} />}
    </div>
  );
}

/**
 * Each kind of record and its count for each outcome, with a total row. An
 * outcome nothing came to is left out. On a phone the cells tighten and step
 * down a size, so all five columns fit the card at 390.
 */
function CountsTable({ kinds, totals }: { kinds: KindCountsView[]; totals: Counts }) {
  if (kinds.length === 0) {
    return <p className="text-body text-ink-muted">No kind of record in this export is imported yet.</p>;
  }
  const shown = OUTCOMES.filter(({ outcome }) => totals[outcome] > 0);
  return (
    <Table stack={false} fit flush className="max-md:text-small max-md:[&_td]:px-1.5 max-md:[&_th]:px-1.5">
      <THead>
        <tr>
          <TH>Records</TH>
          {shown.map(({ outcome, label }) => (
            <TH key={outcome} num>
              {label}
            </TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {kinds.map((kind) => (
          <TR key={kind.kind}>
            <TD primary>{kind.label}</TD>
            {shown.map(({ outcome }) => (
              <TD key={outcome} num muted={kind.counts[outcome] === 0}>
                {formatNumber(kind.counts[outcome])}
              </TD>
            ))}
          </TR>
        ))}
        {kinds.length > 1 && (
          <TR>
            <TD primary>Total</TD>
            {shown.map(({ outcome }) => (
              <TD key={outcome} num className="font-semibold">
                {formatNumber(totals[outcome])}
              </TD>
            ))}
          </TR>
        )}
      </TBody>
    </Table>
  );
}

function SkippedFiles({ files, of }: { files: SkippedFileView[]; of?: number }) {
  return (
    <Disclosure
      title="Files left out"
      meta={of ? `${files.length} of ${of}` : String(files.length)}
    >
      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file.path} className="text-small">
            <span className="break-all text-ink">{file.path}</span>
            <span className="block text-ink-muted">{file.reason}</span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function RunHistory({ runs }: { runs: LinkedInRunView[] }) {
  return (
    <section className="space-y-2" aria-labelledby="linkedin-runs">
      <SectionHeading as="h3" id="linkedin-runs" title="Earlier imports" count={runs.length || undefined} />
      {runs.length === 0 ? (
        <EmptyState
          size="inline"
          title="No imports yet. Each one you apply is listed here with what it added and changed."
        />
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((run) => (
            <li key={run.id} className="py-1">
              <Disclosure
                title={
                  <span className="block">
                    <span className="whitespace-nowrap">{run.ranOn}</span>
                    {run.exportDate && (
                      <span className="whitespace-nowrap text-ink-muted"> · export of {run.exportDate}</span>
                    )}
                    <span className="block text-small font-normal text-ink-muted">
                      {run.status === 'applied'
                        ? countsSentence(run.totals, 'done')
                        : run.status === 'failed'
                          ? 'Stopped before it finished'
                          : 'Still running'}
                    </span>
                  </span>
                }
              >
                <div className="space-y-3 pb-2">
                  {run.status === 'failed' && run.error && <Banner tone="bad">{run.error}</Banner>}
                  <CountsTable kinds={run.kinds} totals={run.totals} />
                  {run.skipped.length > 0 && <SkippedFiles files={run.skipped} />}
                </div>
              </Disclosure>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
