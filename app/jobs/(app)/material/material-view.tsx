'use client';

import { useActionState, useRef, useState, useTransition, type FormEvent } from 'react';
import { MessageSquareText, Trash2 } from 'lucide-react';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Group } from '@/components/ui/disclosure';
import { ChipSelect, Input, Label, Select, Textarea } from '@/components/ui/field';
import { AddTrigger } from '@/components/ui/add-trigger';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { EmptyState } from '@/components/ui/empty-state';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { cardVariants } from '@/components/ui/card';
import { segmentedFrame } from '@/components/ui/segmented';
import { PaidHint } from '@/components/ui/paid-hint';
import { createClient as createBrowserJobsClient } from '@/lib/jobs/auth/client';
import { APP_STORAGE_BUCKET } from '@/lib/jobs/db/schema-name';
import { resumeFileProblem, resumePath } from '@/lib/jobs/resume-file';
import { DEFAULT_BANNED_CONSTRUCTIONS } from '@/lib/jobs/evidence/draft-payload';
import { useCloseOnSuccess } from '@/lib/jobs/use-close-on-success';
import {
  MATERIAL_PARTS,
  QUESTION_KINDS,
  materialHref,
  type MaterialPart,
} from '@/lib/jobs/material';
import { AnswerBank } from './bank';
import { updateWritingVoice, type VoiceState } from './actions';
import {
  acceptEvidence,
  addEvidence,
  addResumeVersion,
  attachResumePdf,
  deleteEvidence,
  proposeEvidence,
} from './evidence-actions';

export type MaterialQuestion = {
  id: string;
  text: string;
  kind: string;
  canonicalAnswer: string | null;
  timesSeen: number;
  usedIn: number;
  approvedAnswer: string | null;
};

export type MaterialResume = {
  id: string;
  label: string;
  isDefault: boolean;
  notes: string | null;
  hasText: boolean;
  hasPdf: boolean;
};

export type MaterialEvidence = {
  id: string;
  title: string;
  body: string;
  context: string | null;
  skills: string[];
  metrics: string | null;
  strength: number;
  usedCount: number;
};

export type MaterialProps = {
  part: MaterialPart;
  /** The question kind the bank is filtered to, or null for all. */
  kind: string | null;
  questions: MaterialQuestion[];
  evidence: MaterialEvidence[];
  resumes: MaterialResume[];
  voice: { writingStyleNotes: string; bannedConstructions: string };
};

/**
 * Everything a draft draws on, in one place: the questions you have been
 * asked and your answers to them, the stories in your evidence bank, the
 * resume versions you send, and how you want to sound.
 *
 * One part at a time, chosen by a switch at the top rather than the left
 * rail: the rail is a Filters sheet below the laptop width, and these are the
 * page's parts, not filters on one list. The rail stays for what it was on the
 * old Answers page, the question kinds.
 */
export function MaterialView(props: MaterialProps) {
  return (
    <div className="space-y-4">
      <nav aria-label="Material">
        <span className={segmentedFrame}>
          {MATERIAL_PARTS.map((entry) => {
            const on = entry.id === props.part;
            return (
              <Link
                key={entry.id}
                href={materialHref(entry.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'press inline-flex h-(--control-h) items-center px-2.5 text-ui font-medium',
                  'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
                  on
                    ? 'bg-accent-tint text-accent'
                    : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {entry.label}
              </Link>
            );
          })}
        </span>
      </nav>

      {props.part === 'answers' && <AnswersPart questions={props.questions} kind={props.kind} />}
      {props.part === 'evidence' && (
        <div className="max-w-3xl">
          <EvidenceSection evidence={props.evidence} resumes={props.resumes} />
        </div>
      )}
      {props.part === 'resumes' && (
        <div className="max-w-3xl">
          <ResumeSection resumes={props.resumes} />
        </div>
      )}
      {props.part === 'voice' && (
        <div className="max-w-3xl">
          <VoiceSection voice={props.voice} />
        </div>
      )}
    </div>
  );
}

/**
 * The question bank, as the Answers page had it.
 *
 * The reuse loop is the whole point: after twenty applications the common
 * questions are answered and the work per application drops to tailoring.
 */
function AnswersPart({ questions, kind }: { questions: MaterialQuestion[]; kind: string | null }) {
  if (questions.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="No questions captured yet"
        description="Use the bookmarklet on an application form, or paste the questions onto a role. Greenhouse postings bring their questions along automatically."
        action={{ label: 'Add a role', href: '/jobs/roles/new' }}
        secondaryAction={{ label: 'Get the bookmarklet', href: '/jobs/settings#bookmarklet' }}
      />
    );
  }

  const filtered = kind ? questions.filter((row) => row.kind === kind) : questions;
  const withCanonical = questions.filter((row) => row.canonicalAnswer).length;

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
      <LeftRail>
        <RailGroup label="Kind">
          <RailItem
            label="All"
            href={materialHref('answers')}
            active={!kind}
            count={questions.length}
          />
          {QUESTION_KINDS.filter((entry) => questions.some((row) => row.kind === entry)).map(
            (entry) => (
              <RailItem
                key={entry}
                label={entry}
                href={materialHref('answers', entry)}
                active={kind === entry}
                count={questions.filter((row) => row.kind === entry).length}
              />
            ),
          )}
        </RailGroup>
        <p className="px-1 text-small leading-relaxed text-ink-muted">
          Questions are deduped by fingerprint, so the same question asked in different words lands
          on one row.
        </p>
      </LeftRail>

      <div className="min-w-0 flex-1 space-y-3">
        <p className="tabular text-ui text-ink-muted">
          {withCanonical} of {questions.length} questions have a default answer. Each one you set
          makes the next application shorter.
        </p>
        <AnswerBank questions={filtered} />
      </div>
    </div>
  );
}

/**
 * How you want to sound, and the phrases no draft may use. Read first, like
 * the Settings card it came from: these change a few times in a search, so the
 * part shows them and editing is somewhere you go (law 14).
 */
function VoiceSection({
  voice,
}: {
  voice: { writingStyleNotes: string; bannedConstructions: string };
}) {
  const [state, action] = useActionState<VoiceState, FormData>(updateWritingVoice, {});
  const [editing, setEditing] = useCloseOnSuccess(state);

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Writing voice</h2>
      <p className="mt-0.5 text-ui text-ink-muted">Every draft Dash writes for you reads these.</p>

      {!editing ? (
        <div className="mt-4 space-y-2">
          <ValueList>
            <ValueRow label="How you want to sound" value={voice.writingStyleNotes} />
            <ValueRow
              label="Never write these"
              value={voice.bannedConstructions || DEFAULT_BANNED_CONSTRUCTIONS.join('\n')}
            />
          </ValueList>
          {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      ) : (
        <form action={action} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="writingStyleNotes">How you want to sound</Label>
            <Textarea
              id="writingStyleNotes"
              name="writingStyleNotes"
              rows={3}
              defaultValue={voice.writingStyleNotes}
              placeholder="Direct. Specific numbers. No throat-clearing. British spelling."
            />
            <p className="mt-1 text-small text-ink-muted">
              Revise it whenever a draft comes back wrong.
            </p>
          </div>

          <div>
            <Label htmlFor="bannedConstructions">Never write these</Label>
            <Textarea
              id="bannedConstructions"
              name="bannedConstructions"
              rows={4}
              defaultValue={voice.bannedConstructions}
              placeholder={DEFAULT_BANNED_CONSTRUCTIONS.join('\n')}
            />
            <p className="mt-1 text-micro leading-relaxed text-ink-muted">
              One per line. Each draft is checked against the list after it is written, so a phrase
              here never reaches you. Leave it empty and the list shown here is used.
            </p>
          </div>

          {state.error && (
            <p role="alert" className="text-ui text-danger">
              {state.error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ResumeSection({
  resumes,
}: {
  resumes: Array<{
    id: string;
    label: string;
    notes: string | null;
    isDefault: boolean;
    hasText: boolean;
    hasPdf: boolean;
  }>;
}) {
  const [state, action] = useActionState(addResumeVersion, {});
  const [adding, setAdding] = useCloseOnSuccess(state);
  const [uploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);

  // The PDF goes to storage from the browser before the form is sent, so the
  // file never rides in the server action's one-megabyte body. The action
  // only receives the path.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get('pdf');
    formData.delete('pdf');
    setUploadError(null);
    startUpload(async () => {
      if (file instanceof File && file.size > 0) {
        const uploaded = await uploadResumePdf(file);
        if ('error' in uploaded) {
          setUploadError(uploaded.error);
          return;
        }
        formData.set('storagePath', uploaded.path);
      }
      action(formData);
    });
  };

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Resume versions</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        The versions you send. Paste a version&rsquo;s text and the evidence bank can read it for
        stories.
      </p>

      {resumes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {resumes.map((resume) => (
            <ResumeRow key={resume.id} resume={resume} />
          ))}
        </ul>
      )}

      {/* The section is the versions you have. The form that adds one used to
          stand open beneath them -- two fields, a four-row paste box and two
          captions, on a page you came to read (law 14). */}
      {adding ? (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" required autoFocus placeholder="C" />
            </div>
            <div className="min-w-48 flex-1">
              <Label htmlFor="notes">What is different about it</Label>
              <Input id="notes" name="notes" placeholder="Fintech-leaning, metrics up top" />
            </div>
          </div>
          <div>
            <Label htmlFor="pdf">The PDF</Label>
            <Input id="pdf" name="pdf" type="file" accept="application/pdf,.pdf" />
            <p className="mt-1 text-small text-ink-muted">
              Kept as the file you send, so you can open exactly what went out.
            </p>
          </div>
          <div>
            <Label htmlFor="textContent">Paste the text</Label>
            <Textarea
              id="textContent"
              name="textContent"
              rows={4}
              placeholder="Paste the whole resume. Formatting does not matter."
            />
            <p className="mt-1 text-small text-ink-muted">
              Optional, but it is what the evidence bank reads to propose your stories.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" pending={uploading}>
              {uploading ? 'Uploading…' : 'Add'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <AddTrigger label="Add a version" onClick={() => setAdding(true)} className="mt-3" />
      )}
      {(uploadError ?? state.error) && (
        <p className="mt-2 text-ui text-danger">{uploadError ?? state.error}</p>
      )}
      {state.message && <p className="mt-2 text-ui text-ink-muted">{state.message}</p>}
    </section>
  );
}

/** One version: its label, a link to its PDF, and a way to attach or replace it. */
function ResumeRow({
  resume,
}: {
  resume: {
    id: string;
    label: string;
    notes: string | null;
    isDefault: boolean;
    hasText: boolean;
    hasPdf: boolean;
  };
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, startAttach] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const attach = (file: File) => {
    setError(null);
    startAttach(async () => {
      const uploaded = await uploadResumePdf(file);
      if ('error' in uploaded) {
        setError(uploaded.error);
        return;
      }
      const result = await attachResumePdf(resume.id, uploaded.path);
      if (result.error) setError(result.error);
    });
  };

  return (
    <li className="text-ui">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-ink">{resume.label}</span>
        {resume.isDefault && <span className="text-micro text-accent">default</span>}
        {resume.hasPdf && (
          <a
            href={`/jobs/resume/${resume.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            Open PDF
          </a>
        )}
        {!resume.hasText && <span className="text-small text-ink-muted">no text pasted</span>}
        {resume.notes && <span className="text-ink-muted">{resume.notes}</span>}
        <button
          type="button"
          className="text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Uploading…' : resume.hasPdf ? 'Replace PDF' : 'Attach PDF'}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label={`PDF for ${resume.label}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) attach(file);
          }}
        />
      </div>
      {error && <p className="mt-1 text-small text-danger">{error}</p>}
    </li>
  );
}

/** Put a resume PDF in your folder of the bucket, under a fresh name. */
async function uploadResumePdf(file: File): Promise<{ path: string } | { error: string }> {
  const problem = resumeFileProblem(file);
  if (problem) return { error: problem };
  const supabase = createBrowserJobsClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'You are signed out. Sign in again to upload.' };
  const path = resumePath(data.user.id, crypto.randomUUID());
  const { error } = await supabase.storage
    .from(APP_STORAGE_BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (error) return { error: 'That PDF could not be uploaded. Try again.' };
  return { path };
}

function EvidenceSection({
  evidence,
  resumes,
}: {
  resumes: Array<{ id: string; label: string; hasText: boolean }>;
  evidence: Array<{
    id: string;
    title: string;
    body: string;
    context: string | null;
    skills: string[];
    metrics: string | null;
    strength: number;
    usedCount: number;
  }>;
}) {
  const [state, action] = useActionState(addEvidence, {});
  const [adding, setAdding] = useCloseOnSuccess(state);
  const [, startTransition] = useTransition();

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Evidence bank</h2>
      {/* Why the bank matters is said once, while it is empty. With entries in
          it, the count under the heading is the useful line (law 15). */}
      {evidence.length === 0 && (
        <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
          Your actual experience, in your own words. Twenty to thirty entries is the target. Every
          draft Dash writes quotes from here, so an empty bank means drafts with nothing true in
          them.
        </p>
      )}

      <p className="tabular mt-2 text-ui text-ink">
        {evidence.length} stored
        {evidence.length < 20 && (
          <span className="ml-2 text-caution">{20 - evidence.length} short of a useful bank</span>
        )}
      </p>

      {evidence.length > 0 && (
        // Same call as the inboxes above: a list inside the card, marked by its
        // divides rather than by twenty small frames stacked down the page.
        <ul className="mt-3 divide-y divide-border">
          {evidence.map((item) => (
            // Anchored, so a prep note's story links back to the item it came
            // from rather than to the top of a page of twenty-five.
            <li key={item.id} id={`evidence-${item.id}`} className="row-pad">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-ui font-medium text-ink">{item.title}</span>
                <span className="tabular text-small text-ink-muted">
                  {'★'.repeat(item.strength)}
                </span>
                {item.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-canvas px-1.5 py-0.5 text-small text-ink-muted"
                  >
                    {skill.replace(/_/g, ' ')}
                  </span>
                ))}
                <button
                  type="button"
                  className="ml-auto text-ink-muted hover:text-danger"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteEvidence(item.id);
                    })
                  }
                  aria-label={`Delete ${item.title}`}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <p className="mt-1 line-clamp-3 text-small text-ink-muted">{item.body}</p>
              {item.metrics && <p className="tabular mt-1 text-small text-ink">{item.metrics}</p>}
            </li>
          ))}
        </ul>
      )}

      <SeedFromWriting resumes={resumes} />

      {/* Six fields, open on arrival, under the bank they are meant to fill.
          The comment on SeedFromWriting below already says nobody fills this
          in twenty times; it should not also be the first thing on the
          section every time you come to read what is in the bank (law 14). */}
      {!adding ? (
        <AddTrigger label="Write one by hand" onClick={() => setAdding(true)} className="mt-3" />
      ) : (
        <form action={action} className="mt-4 space-y-3 border-t border-border pt-4">
          <div>
            <Label htmlFor="title">Short handle</Label>
            <Input
              id="title"
              name="title"
              required
              autoFocus
              placeholder="Rebuilt the close process"
            />
          </div>
          <div>
            <Label htmlFor="body">The story</Label>
            <Textarea
              id="body"
              name="body"
              rows={4}
              required
              placeholder="What the situation was, what you did, what happened. Your words, not a template."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="context">Where and when</Label>
              <Input id="context" name="context" placeholder="Acme, 2024" />
            </div>
            <div>
              <Label htmlFor="metrics">The number</Label>
              <Input id="metrics" name="metrics" placeholder="Close went from 9 days to 4" />
            </div>
            <div>
              <Label htmlFor="strength">How strong is it</Label>
              <Select id="strength" name="strength" defaultValue="3">
                {[5, 4, 3, 2, 1].map((level) => (
                  <option key={level} value={level}>
                    {'★'.repeat(level)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="skills">Tags</Label>
            <Input
              id="skills"
              name="skills"
              placeholder="financial modeling, stakeholder management, automation"
            />
          </div>

          {state.error && <p className="text-ui text-danger">{state.error}</p>}
          {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Add to the bank
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Seeding the bank from writing that already exists in the account.
 *
 * The one-at-a-time form below is why the bank is empty: nobody fills in six
 * fields twenty times. A resume, the answers you have approved and the
 * debriefs you wrote are all stories in your own words already, so the model
 * only has to split them up. It proposes; you tick and edit. Nothing lands
 * unread, because a bad item in the bank is invisible after the fact and
 * degrades every match built on top of it.
 */
type EvidenceDraft = {
  title: string;
  body: string;
  context: string | null;
  metrics: string | null;
  strength: number;
  /** Kept as typed text, so a half-finished tag is not lost on every keystroke. */
  skillsText: string;
  picked: boolean;
};

function SeedFromWriting({
  resumes,
}: {
  resumes: Array<{ id: string; label: string; hasText: boolean }>;
}) {
  const readable = resumes.filter((resume) => resume.hasText);

  const [, startTransition] = useTransition();

  const [kind, setKind] = useState<'resume' | 'answers' | 'debriefs'>('resume');
  const [resumeVersionId, setResumeVersionId] = useState(readable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<EvidenceDraft[] | null>(null);

  const sources: Array<{ value: typeof kind; label: string }> = [
    { value: 'resume', label: 'A resume' },
    { value: 'answers', label: 'Approved answers' },
    { value: 'debriefs', label: 'Interview debriefs' },
  ];

  function patch(index: number, changes: Partial<EvidenceDraft>) {
    setDrafts((current) =>
      (current ?? []).map((draft, i) => (i === index ? { ...draft, ...changes } : draft)),
    );
  }

  const picked = (drafts ?? []).filter((draft) => draft.picked);

  return (
    // A heading and space where a second box used to be. It is the last thing
    // in the Evidence card and it belongs to it, so the frame around it was the
    // card's frame said twice. Law 11.
    <Group title="Seed it from what you have written" className="mt-4 border-t border-border pt-3">
      <p className="text-small leading-relaxed text-ink-muted">
        Read a resume, your approved behavioural answers, or your interview debriefs, and propose
        the stories in them. Nothing is added until you tick it.
      </p>

      {/* Chips rather than labelled selects: the chosen value says what each
          one is, and at 390 the two sit on one row instead of four (law 9). */}
      <div className="flex flex-wrap items-center gap-2">
        <ChipSelect
          aria-label="What to read"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as typeof kind);
            setDrafts(null);
            setError(null);
            setMessage(null);
          }}
        >
          {sources.map((source) => (
            <option key={source.value} value={source.value}>
              {source.label}
            </option>
          ))}
        </ChipSelect>

        {kind === 'resume' && (
          <ChipSelect
            aria-label="Which version"
            value={resumeVersionId}
            disabled={readable.length === 0}
            onChange={(event) => setResumeVersionId(event.target.value)}
          >
            {readable.length === 0 ? (
              <option value="">No version has text pasted</option>
            ) : (
              readable.map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.label}
                </option>
              ))
            )}
          </ChipSelect>
        )}

        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || (kind === 'resume' && !resumeVersionId)}
          onClick={() => {
            setBusy(true);
            setError(null);
            setMessage(null);
            setDrafts(null);
            startTransition(async () => {
              const result = await proposeEvidence({
                kind,
                resumeVersionId: kind === 'resume' ? resumeVersionId : undefined,
              });
              setBusy(false);
              if (result.error || !result.proposal) {
                setError(result.error ?? 'Nothing came back.');
                return;
              }
              setDrafts(
                result.proposal.candidates.map((candidate) => ({
                  ...candidate,
                  picked: true,
                  skillsText: candidate.skills.join(', '),
                })),
              );
            });
          }}
        >
          {busy ? 'Reading…' : 'Propose'}
        </Button>
        <PaidHint
          action="app/jobs/(app)/material/evidence-actions.ts#proposeEvidence"
          what="Cost of proposing evidence"
        />

        {error && <span className="text-small text-danger">{error}</span>}
        {message && <span className="text-small text-ink-muted">{message}</span>}
      </div>

      {drafts && drafts.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-small text-ink-muted">
            {drafts.length} proposed. Edit anything that is not how you would put it — this is the
            text every future draft quotes.
          </p>

          {/* Third frame in from the page, so no frame at all: divides between
           * the proposals, and the dimming that was already carrying "this one
           * is not going in" carries it on its own now. A box per proposal
           * made eight suggestions read as eight forms. */}
          <div className="divide-y divide-border">
            {drafts.map((draft, index) => (
              <div key={index} className={cn('row-pad', !draft.picked && 'opacity-60')}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-2"
                    checked={draft.picked}
                    onChange={(event) => patch(index, { picked: event.target.checked })}
                    aria-label={`Add ${draft.title}`}
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      value={draft.title}
                      aria-label="Short handle"
                      onChange={(event) => patch(index, { title: event.target.value })}
                    />
                    <Textarea
                      rows={3}
                      value={draft.body}
                      aria-label="The story"
                      onChange={(event) => patch(index, { body: event.target.value })}
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input
                        value={draft.context ?? ''}
                        placeholder="Where and when"
                        aria-label="Where and when"
                        onChange={(event) => patch(index, { context: event.target.value })}
                      />
                      <Input
                        value={draft.metrics ?? ''}
                        placeholder="The number"
                        aria-label="The number"
                        onChange={(event) => patch(index, { metrics: event.target.value })}
                      />
                      <Select
                        value={String(draft.strength)}
                        aria-label="How strong is it"
                        onChange={(event) => patch(index, { strength: Number(event.target.value) })}
                      >
                        {[5, 4, 3, 2, 1].map((level) => (
                          <option key={level} value={level}>
                            {'★'.repeat(level)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Input
                      value={draft.skillsText}
                      placeholder="Tags"
                      aria-label="Tags"
                      onChange={(event) => patch(index, { skillsText: event.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || picked.length === 0}
              onClick={() => {
                setBusy(true);
                setError(null);
                startTransition(async () => {
                  const result = await acceptEvidence({
                    items: picked.map((draft) => ({
                      title: draft.title.trim(),
                      body: draft.body.trim(),
                      context: draft.context?.trim() || null,
                      metrics: draft.metrics?.trim() || null,
                      strength: draft.strength,
                      skills: draft.skillsText
                        .split(/[,\n]/)
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    })),
                  });
                  setBusy(false);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setDrafts(null);
                  setMessage(`Added ${result.added} to the bank.`);
                });
              }}
            >
              Add {picked.length} to the bank
            </Button>
            <button
              type="button"
              className="text-small text-ink-muted hover:text-ink"
              onClick={() => {
                setDrafts(null);
                setMessage(null);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </Group>
  );
}
