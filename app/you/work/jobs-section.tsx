'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { Briefcase } from 'lucide-react';
import { ActionMenu } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { SectionHeading } from '@/components/ui/section-heading';
import { useToast } from '@/components/ui/toast';
import { dateLabel, jobAnchor, jobDates, RESUMES_HREF, type Job } from '@/lib/you/work-history';
import { readResumeAction, removeJobAction, saveJobAction, type JobEditState } from './job-actions';

/**
 * Jobs on You's Work & school tab (plan #1991.4), above Education: the jobs
 * you have held, newest first, read by Dash from your default résumé in Jobs.
 * A row is corrected in place from its menu, a job the read missed is added
 * by hand, and both are kept through every later read. When the résumé has
 * changed since the last read, a note above the list offers to read it again.
 *
 * Drawn the same by the page and the gallery; `editing` opens one row's form,
 * for the gallery's drawing of it.
 */

const READ_ACTION = 'app/you/work/job-actions.ts#readResumeAction';

export type ResumeOnFile = { label: string } | null;

export function JobsSection({
  jobs,
  resume,
  changed,
  editing: startEditing = null,
}: {
  /** Newest first (sortJobs). */
  jobs: Job[];
  /** The résumé a read would take: the default in Jobs, or the newest with text. */
  resume: ResumeOnFile;
  /** Whether that résumé has changed since the rows were read from it. */
  changed: boolean;
  editing?: string | 'new' | null;
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(startEditing);
  const count = jobs.length;

  return (
    <section aria-labelledby="jobs" className="mb-8">
      <SectionHeading
        id="jobs"
        title="Jobs"
        count={count > 0 ? `${count} ${count === 1 ? 'job' : 'jobs'}` : undefined}
        className="mb-2"
      />

      {count === 0 && editing !== 'new' ? (
        <NoJobs resume={resume} onAdd={() => setEditing('new')} />
      ) : (
        <>
          {changed && resume && <ResumeChanged label={resume.label} />}
          {count > 0 && (
            <Card padding="dense" className="mb-2">
              <ul className="divide-y divide-border">
                {jobs.map((job) =>
                  editing === job.id ? (
                    <li key={job.id} id={jobAnchor(job.id)} className="scroll-mt-bar py-3">
                      <JobForm job={job} onClose={() => setEditing(null)} />
                    </li>
                  ) : (
                    <JobRow key={job.id} job={job} onEdit={() => setEditing(job.id)} />
                  ),
                )}
              </ul>
            </Card>
          )}
          {editing === 'new' ? (
            <Card padding="dense" className="mb-2">
              <JobForm job={null} onClose={() => setEditing(null)} />
            </Card>
          ) : (
            <AddTrigger label="Add a job" onClick={() => setEditing('new')} />
          )}
        </>
      )}
    </section>
  );
}

/** The first read, or where to get a résumé from when Jobs has none. */
function NoJobs({ resume, onAdd }: { resume: ResumeOnFile; onAdd: () => void }) {
  if (!resume) {
    return (
      <EmptyState
        size="box"
        icon={Briefcase}
        title="No jobs yet"
        description="Dash lists your jobs from your résumé in Jobs, and there is no résumé there yet. Add one in Jobs, or add your jobs here yourself."
        action={{ label: 'Add a résumé in Jobs', href: RESUMES_HREF }}
      >
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onAdd}>
          Add a job yourself
        </Button>
      </EmptyState>
    );
  }
  return (
    <EmptyState
      size="box"
      icon={Briefcase}
      title="No jobs yet"
      description={`Dash can list the jobs on your résumé “${resume.label}” from Jobs, with their dates. You can correct any of them afterwards, and add one it missed.`}
    >
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <ReadButton label="List my jobs" />
        <Button type="button" variant="ghost" onClick={onAdd}>
          Add one yourself
        </Button>
      </div>
    </EmptyState>
  );
}

function ResumeChanged({ label }: { label: string }) {
  return (
    <Note tone="accent" className="mb-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-64">
          Your résumé “{label}” has changed since Dash read it. Jobs you edited or added stay as they are.
        </p>
        <ReadButton label="Read it again" size="sm" />
      </div>
    </Note>
  );
}

function ReadButton({ label, size }: { label: string; size?: 'sm' }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();
  const read = () =>
    start(async () => {
      setError(null);
      const result = await readResumeAction();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.read) {
        const { added, kept, resume } = result.read;
        const listed = `Listed ${added} ${added === 1 ? 'job' : 'jobs'} from “${resume}”`;
        toast({ text: kept > 0 ? `${listed}, and kept the ${kept} you edited.` : `${listed}.` });
      }
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <DashAction
        type="button"
        size={size}
        pending={reading}
        onClick={read}
        paid={READ_ACTION}
        what="Cost of reading the résumé"
      >
        {reading ? 'Reading…' : label}
      </DashAction>
      {error && (
        <span className="basis-full">
          <FieldError>{error}</FieldError>
        </span>
      )}
    </span>
  );
}

function JobRow({ job, onEdit }: { job: Job; onEdit: () => void }) {
  const dates = jobDates(job);
  const heading = job.title ?? job.employer;
  const mark = job.edited
    ? job.resume_hash || job.source
      ? 'Edited'
      : 'Added by you'
    : // Only a job the import added; a résumé row it filled in reads as it did.
      job.source === 'linkedin' && !job.resume_hash
      ? 'From LinkedIn'
      : null;
  const under = [job.title ? job.employer : null, job.place, mark].filter(Boolean).join(' · ');
  return (
    <li id={jobAnchor(job.id)} className="flex scroll-mt-bar items-start gap-3 py-2.5 target:bg-accent-tint">
      <div className="min-w-0 flex-1">
        {/* Only the title shares its line with the dates; what is under it runs the row's width. */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-body font-medium text-ink">{heading}</p>
          {dates && <p className="shrink-0 text-small tabular-nums text-ink">{dates}</p>}
        </div>
        {under && <p className="text-small text-ink-muted">{under}</p>}
        {job.note && <p className="mt-0.5 line-clamp-2 text-small text-ink-muted">{job.note}</p>}
      </div>
      <ActionMenu
        label={`Actions for ${heading}`}
        items={[
          { id: 'edit', label: 'Edit', onSelect: onEdit },
          {
            id: 'remove',
            label: 'Remove',
            destructive: true,
            confirm: job.resume_hash && !job.edited && !job.source
              ? 'Remove this job? A later read of your résumé lists it again.'
              : 'Remove this job?',
            formAction: removeJobAction,
            formFields: { id: job.id },
          },
        ]}
      />
    </li>
  );
}

function JobForm({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const id = useId();
  const [state, save, saving] = useActionState(async (prev: JobEditState, form: FormData) => {
    const result = await saveJobAction(prev, form);
    if (result.saved) onClose();
    return result;
  }, {});
  const error = (field: string) => (state.field === field ? state.error : undefined);
  const field = (
    name: 'employer' | 'title' | 'place' | 'started' | 'ended',
    label: string,
    value: string | null,
    extra: { className?: string; required?: boolean; max?: number; placeholder?: string; hint?: string } = {},
  ) => (
    <Field id={`${id}-${name}`} label={label} hint={extra.hint} error={error(name)} className={extra.className}>
      <Input
        id={`${id}-${name}`}
        name={name}
        defaultValue={value ?? ''}
        required={extra.required}
        maxLength={extra.max}
        placeholder={extra.placeholder}
        autoFocus={name === 'employer' && job === null}
      />
    </Field>
  );

  return (
    <form action={save} className="space-y-3" aria-label={job ? `Edit ${job.title ?? job.employer}` : 'Add a job'}>
      {job && <input type="hidden" name="id" value={job.id} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {field('title', 'Title', job?.title ?? null, { className: 'col-span-2 sm:col-span-3', max: 200 })}
        {field('employer', 'Employer', job?.employer ?? null, { className: 'col-span-2 sm:col-span-3', required: true, max: 200 })}
        {field('place', 'Place', job?.place ?? null, { className: 'col-span-2', max: 200 })}
        {field('started', 'Started', job?.started ? dateLabel(job.started) : null, { className: 'sm:col-span-2', placeholder: '2020 or May 2020' })}
        {field('ended', 'Ended', job?.ended ? dateLabel(job.ended) : null, { className: 'sm:col-span-2', placeholder: 'Empty if current' })}
        <Field id={`${id}-note`} label="Note" error={error('note')} className="col-span-2 sm:col-span-6">
          <Textarea id={`${id}-note`} name="note" defaultValue={job?.note ?? ''} rows={2} maxLength={4000} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={saving}>
          {saving ? 'Saving…' : job ? 'Save' : 'Add job'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
      {state.error && !state.field && <FieldError>{state.error}</FieldError>}
    </form>
  );
}
