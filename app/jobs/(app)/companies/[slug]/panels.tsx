'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { useSearchParams } from 'next/navigation';
import { useActionState, useState, useTransition, type ReactNode } from 'react';
import { Briefcase, Building2, Compass, MessagesSquare, Send, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Note } from '@/components/ui/note';
import { Field, FieldError, Input, Select, Textarea } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { AddTrigger } from '@/components/ui/add-trigger';
import { EditableProse } from '@/components/ui/editable-prose';
import { FoldingMarkdown } from '@/components/ui/folding-markdown';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { formatDate } from '@/lib/jobs/applications/load';
import { addNote } from '@/app/jobs/(app)/roles/[id]/actions';
import { createContact } from '@/app/jobs/(app)/contacts/actions';
import { RELATIONSHIPS } from '@/app/jobs/(app)/contacts/view';
import {
  applyAiCompanyEnrichment,
  applyCompanyEnrichment,
  proposeAiCompanyEnrichment,
  proposeCompanyEnrichment,
  type AiEnrichmentProposal,
  type EnrichmentProposal,
} from '../actions';
import { updateCompany } from '../actions';
import { DashAction } from '@/components/ui/dash-action';
import { TabbedSections } from '@/components/patterns/tabbed-sections';
import type { Tab } from '@/lib/tabs';
import { companyTabFrom, type CompanyTab } from './tabs';
import { ResearchPanel } from './research-panel';
import type { CompanyResearch } from '@/lib/jobs/companies/research';
import {
  answeredCount,
  PERSPECTIVE_QUESTIONS,
  type Perspective,
  type PerspectiveKey,
} from '@/lib/jobs/companies/perspective';

const PRIORITY_OPTIONS = [
  { value: 'target', label: 'Target' },
  { value: 'interested', label: 'Interested' },
  { value: 'backup', label: 'Backup' },
  { value: 'passed', label: 'Passed' },
] as const;

type Priority = (typeof PRIORITY_OPTIONS)[number]['value'];

const TABS: readonly (Tab & { id: CompanyTab })[] = [
  { id: 'roles', label: 'Roles', icon: Briefcase },
  { id: 'perspective', label: 'Perspective', icon: Compass },
  { id: 'about', label: 'About', icon: Building2 },
  { id: 'people', label: 'People', icon: Users },
  { id: 'outreach', label: 'Outreach', icon: Send },
  { id: 'notes', label: 'Notes', icon: MessagesSquare },
];

/**
 * A company's page below its header, one section at a time behind tabs (the
 * tabbed sections pattern, plan #1628), in the role page's shape since the
 * two are reached from each other. Roles holds the roles pursued here and
 * what is outstanding on them; Perspective your own view of the company;
 * About what you know about the place and its details; then People, Outreach
 * and Notes.
 */
export function CompanyPanels(props: {
  /** The Roles tab, drawn on the server: the roles here and what is outstanding. */
  roles: ReactNode;
  roleCount: number;
  /** The gallery's: the tab to open on when the address names none. */
  opensOn?: CompanyTab;
  companyId: string;
  research: string;
  perspective: Perspective;
  /** When an answer on the Perspective tab last changed, if one ever has. */
  perspectiveUpdatedAt: string | null;
  /** The newest research run in any state, and the newest finished one. */
  researchLatest: CompanyResearch | null;
  researchShown: CompanyResearch | null;
  /** Whether Research can be started on this deployment. */
  researchAvailable: boolean;
  domains: string;
  industry: string;
  hqLocation: string;
  careersUrl: string;
  linkedinUrl: string;
  website: string;
  priority: string;
  timezone: string;
  contacts: Array<{
    id: string;
    fullName: string;
    title: string | null;
    relationship: string;
    status: string;
    linkedinUrl: string | null;
    email: string | null;
    howWeConnect: string | null;
  }>;
  touches: Array<{
    id: string;
    channel: string;
    direction: string;
    sentAt: string;
    respondedAt: string | null;
    message: string | null;
    contactName: string;
  }>;
  notes: Array<{ id: string; body: string; createdAt: string }>;
  /** The surface gallery's: draw People with its add form open. */
  addingPerson?: boolean;
}) {
  const tab = companyTabFrom(useSearchParams().get('tab'), props.opensOn);
  const counts: Partial<Record<CompanyTab, number>> = {
    roles: props.roleCount,
    people: props.contacts.length,
    outreach: props.touches.length,
    notes: props.notes.length,
  };
  const tabs = TABS.map((entry) => ({ ...entry, count: counts[entry.id] }));

  return (
    // Shallow: the page reads every tab's data at once for the counts, so a
    // switch writes the address without loading the company again.
    <TabbedSections tabs={tabs} label="Company" address={{ opensOn: props.opensOn }} shallow>
      {tab === 'roles' && props.roles}
      {tab === 'perspective' && <PerspectivePanel {...props} />}
      {tab === 'about' && (
        // One column at every width: the details first, then the long text
        // (taste one-column-detail).
        <div className="space-y-4">
          <Details {...props} />
          <Research {...props} />
        </div>
      )}
      {tab === 'people' && <Contacts {...props} />}
      {tab === 'outreach' && <Touches {...props} />}
      {tab === 'notes' && <Notes {...props} />}
    </TabbedSections>
  );
}

/**
 * Form state that the server is allowed to move underneath it.
 *
 * These inputs are seeded from the company row, and the row changes without a
 * navigation: an enrichment fills the blanks in place and the revalidated page
 * arrives while this component is still mounted, so `useState`'s initial value
 * never runs again and the field goes on showing the blank it was born with —
 * which is why filling a company in used to need a manual reload.
 *
 * The fix is React's documented one: notice during render that a prop moved
 * and re-seed. Only the fields that actually changed are re-seeded, so typing
 * in progress elsewhere in the form is not thrown away by someone else's write.
 */
function useServerSeeded<T extends Record<string, string>>(
  incoming: T,
): [T, (updater: (current: T) => T) => void] {
  const [form, setForm] = useState(incoming);
  const [seed, setSeed] = useState(incoming);

  const moved = (Object.keys(incoming) as Array<keyof T>).filter(
    (key) => incoming[key] !== seed[key],
  );
  if (moved.length > 0) {
    setSeed(incoming);
    setForm((current) => {
      const next = { ...current };
      for (const key of moved) next[key] = incoming[key];
      return next;
    });
  }

  return [form, setForm];
}

/**
 * The person's own view of a company they want to focus on: how much they
 * want it, then six short answers (lib/jobs/companies/perspective.ts). Each
 * answer is read until it is clicked, as the research note is, and saved on
 * its own, because they are written a few at a time over weeks.
 */
function PerspectivePanel({
  companyId,
  priority,
  perspective,
  perspectiveUpdatedAt,
  researchLatest,
  researchShown,
  researchAvailable,
  contacts,
  timezone,
}: {
  companyId: string;
  priority: string;
  perspective: Perspective;
  perspectiveUpdatedAt: string | null;
  researchLatest: CompanyResearch | null;
  researchShown: CompanyResearch | null;
  researchAvailable: boolean;
  contacts: Array<{ id: string }>;
  timezone: string;
}) {
  const drafts = researchShown?.drafts ?? {};
  const [answers, setAnswers] = useServerSeeded(perspective);
  const [focus, setFocus] = useServerSeeded({ priority });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const answered = answeredCount(answers);

  const save = async (key: PerspectiveKey, next: string) => {
    const result = await updateCompany({ companyId, perspective: { [key]: next } });
    if (result.error) return result.error;
    setAnswers((current) => ({ ...current, [key]: next }));
  };

  return (
    <div className="space-y-4">
      <CardSection
        title="Focus"
        hint="Mark the handful of companies you most want as Target. They lead the Companies list, with how far each view has got."
      >
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Segmented<Priority>
            label="How much you want to work here"
            value={focus.priority as Priority}
            options={PRIORITY_OPTIONS}
            disabled={pending}
            onChange={(next) => {
              const was = focus.priority;
              setFocus(() => ({ priority: next }));
              startTransition(async () => {
                const result = await updateCompany({ companyId, priority: next });
                setError(result.error);
                if (result.error) setFocus(() => ({ priority: was }));
              });
            }}
          />
          <FieldError>{error}</FieldError>
        </div>
      </CardSection>

      <ResearchPanel
        companyId={companyId}
        latest={researchLatest}
        shown={researchShown}
        timezone={timezone}
        available={researchAvailable}
      />

      <CardSection
        title="Your view"
        meta={`${answered} of ${PERSPECTIVE_QUESTIONS.length} answered${
          perspectiveUpdatedAt ? ` · updated ${formatDate(perspectiveUpdatedAt, timezone)}` : ''
        }`}
      >
        <dl className="mt-2 space-y-4">
          {PERSPECTIVE_QUESTIONS.map((question) => (
            <div key={question.key}>
              <dt className="text-ui font-medium text-ink">{question.label}</dt>
              <dd className="mt-1">
                <EditableProse
                  label={question.label}
                  value={answers[question.key]}
                  markdown
                  empty={question.prompt}
                  editLabel={`Answer ${question.label.toLowerCase()}`}
                  placeholder={question.prompt}
                  onSave={(next) => save(question.key, next)}
                />
                {!answers[question.key].trim() && drafts[question.key] && (
                  <DraftAnswer
                    draft={drafts[question.key] as string}
                    onUse={() => save(question.key, drafts[question.key] as string)}
                  />
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-small text-ink-muted">
          {contacts.length === 0
            ? 'Nobody here yet. '
            : `${contacts.length === 1 ? 'One person' : `${contacts.length} people`} here. `}
          <Link href="?tab=people">
            {contacts.length === 0 ? 'Add who you know or could be introduced to' : 'See People'}
          </Link>
        </p>
      </CardSection>
    </div>
  );
}

/**
 * What the research run suggested for an unanswered question, with a button
 * that makes it the answer. Shown only while the question is blank: once
 * there is an answer it is the person's, and a suggestion beside it is noise.
 */
function DraftAnswer({ draft, onUse }: { draft: string; onUse: () => Promise<string | null | void> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Note className="mt-2">
      <p className="text-small font-medium text-ink-muted">Suggested from the research</p>
      <FoldingMarkdown markdown={draft} className="mt-1 text-ui text-ink" />
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError((await onUse()) ?? null);
            })
          }
        >
          {pending ? 'Saving…' : 'Use this'}
        </Button>
        <FieldError>{error}</FieldError>
      </div>
    </Note>
  );
}

function Research({ companyId, research }: { companyId: string; research: string }) {
  const [form, setForm] = useServerSeeded({ research });
  const text = form.research;

  // The longest thing anybody writes in this app, and it used to be an
  // eight-row textarea sitting open on arrival: never once shown as the
  // writing it is, and hard to read because a textarea has no measure and no
  // leading. Read by default now, and expandable, because a column inside a
  // card is the wrong shape for something this long (laws 14 and 12).
  return (
    <CardSection title="What you know about this place">
      <div className="mt-2">
        <EditableProse
          label="What you know about this place"
          value={text}
          expandable
          markdown
          empty="Nothing on this company yet."
          placeholder="Funding, who runs the team, what the last two people you spoke to said, why you would or would not go."
          onSave={async (next) => {
            const result = await updateCompany({ companyId, research: next });
            if (result.error) return result.error;
            setForm(() => ({ research: next }));
          }}
        />
      </div>
    </CardSection>
  );
}

function Details({
  companyId,
  domains,
  industry,
  hqLocation,
  careersUrl,
  linkedinUrl,
  website,
  priority,
}: {
  companyId: string;
  domains: string;
  industry: string;
  hqLocation: string;
  careersUrl: string;
  linkedinUrl: string;
  website: string;
  priority: string;
}) {
  const [form, setForm] = useServerSeeded({
    domains,
    industry,
    hqLocation,
    careersUrl,
    linkedinUrl,
    website,
    priority,
  });
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Read first. Seven labelled boxes and a Save, stacked down the side of a
  // page you come to to read what you know about a company -- the same law the
  // research note above was breaking, in the same column (law 14). The
  // captions are teaching and go with the form; the panel is the answers.
  if (!editing) {
    return (
      <CardSection title="Details">
        <ValueList className="mt-3">
          <ValueRow label="Email domains" value={form.domains} />
          <ValueRow label="Priority" value={form.priority} />
          <ValueRow label="Industry" value={form.industry} />
          <ValueRow label="HQ" value={form.hqLocation} />
          <ValueRow
            label="Homepage"
            value={
              form.website ? (
                <a
                  href={form.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(linkVariants(), 'press-area')}
                >
                  {form.website}
                </a>
              ) : null
            }
          />
          <ValueRow
            label="Careers page"
            value={
              form.careersUrl ? (
                <a
                  href={form.careersUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(linkVariants(), 'press-area')}
                >
                  {form.careersUrl}
                </a>
              ) : null
            }
          />
          <ValueRow
            label="LinkedIn"
            value={
              form.linkedinUrl ? (
                <a
                  href={form.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(linkVariants(), 'press-area')}
                >
                  {form.linkedinUrl}
                </a>
              ) : null
            }
          />
        </ValueList>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {saved && <span className="text-small text-ink-muted">{saved}</span>}
        </div>

        <Enrichment companyId={companyId} />
        <AiEnrichment companyId={companyId} />
      </CardSection>
    );
  }

  return (
    <CardSection title="Details">
      <div className="mt-3 space-y-3">
        <Field
          id="domains"
          label="Email domains"
          hint="This is what lets a recruiter’s personal work address find this company. It is also the list the second inbox query searches, which is how direct outreach gets caught at all."
        >
          <Input
            id="domains"
            value={form.domains}
            onChange={(event) => set('domains')(event.target.value)}
            placeholder="ramp.com, ramp.co"
          />
        </Field>

        <Field id="priority" label="Priority">
          <Select
            id="priority"
            value={form.priority}
            onChange={(event) => set('priority')(event.target.value)}
          >
            {['target', 'interested', 'backup', 'passed'].map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="industry" label="Industry">
          <Input
            id="industry"
            value={form.industry}
            onChange={(event) => set('industry')(event.target.value)}
          />
        </Field>

        <Field id="hqLocation" label="HQ">
          <Input
            id="hqLocation"
            value={form.hqLocation}
            onChange={(event) => set('hqLocation')(event.target.value)}
          />
        </Field>

        <div>
          <Field id="website" label="Homepage">
            <Input
              id="website"
              value={form.website}
              onChange={(event) => set('website')(event.target.value)}
              placeholder="https://"
            />
          </Field>
          {form.website && (
            <a
              href={form.website}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(linkVariants(), 'mt-1 inline-block text-small')}
            >
              Open
            </a>
          )}
        </div>

        <Field id="careersUrl" label="Careers page">
          <Input
            id="careersUrl"
            value={form.careersUrl}
            onChange={(event) => set('careersUrl')(event.target.value)}
          />
        </Field>

        <Field id="linkedinUrl" label="LinkedIn">
          <Input
            id="linkedinUrl"
            value={form.linkedinUrl}
            onChange={(event) => set('linkedinUrl')(event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateCompany({
                companyId,
                domains: form.domains,
                industry: form.industry,
                hqLocation: form.hqLocation,
                careersUrl: form.careersUrl,
                linkedinUrl: form.linkedinUrl,
                website: form.website,
                priority: form.priority as 'target' | 'interested' | 'backup' | 'passed',
              });
              setSaved(result.error ?? 'Saved.');
            })
          }
        >
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
      </div>

      <Enrichment companyId={companyId} />
      <AiEnrichment companyId={companyId} />
    </CardSection>
  );
}

/**
 * Look the company up on Wikidata and offer to fill in the blanks.
 *
 * Two steps rather than one button that writes. A name search finds the wrong
 * company often enough that the match is worth showing before it lands, and
 * the alternative -- silently correct most of the time -- is the version you
 * cannot audit afterwards, because you never typed any of it.
 */
function Enrichment({ companyId }: { companyId: string }) {
  const [proposal, setProposal] = useState<EnrichmentProposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lookUp = () =>
    startTransition(async () => {
      setMessage(null);
      setProposal(null);
      const result = await proposeCompanyEnrichment({ companyId });
      if (result.error) setMessage(result.error);
      else if (result.proposal && !result.proposal.hasChanges) {
        setMessage(
          `Found ${result.proposal.label}, but every field it knows is already filled in.`,
        );
      } else setProposal(result.proposal);
    });

  const apply = (wikidataId: string) =>
    startTransition(async () => {
      const result = await applyCompanyEnrichment({ companyId, wikidataId });
      setProposal(null);
      setMessage(
        result.error ??
          (result.applied.length
            ? `Filled in ${result.applied.length} field(s).`
            : 'Nothing to fill in.'),
      );
    });

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="secondary" pending={pending} onClick={lookUp}>
          {pending ? 'Looking up…' : 'Look up on Wikidata'}
        </Button>
        {message && <span className="text-small text-ink-muted">{message}</span>}
      </div>

      <p className="mt-1 text-small leading-relaxed text-ink-muted">
        Fills blank fields only — anything you have typed is left exactly as it is.
      </p>

      {proposal && (
        // A well, not a frame. What is in here is an encyclopedia's answer and
        // not yet yours -- a recessed ground says that, where a border inside
        // the company card would only be the card's edge drawn twice. Law 11:
        // a shared ground groups.
        <Note className="mt-3 p-3">
          <p className="text-ui font-medium text-ink">{proposal.label}</p>
          {proposal.description && (
            <p className="text-small text-ink-muted">{proposal.description}</p>
          )}

          <p className="mt-1 text-small text-ink-muted">
            {proposal.verified
              ? 'Matched on the company’s own website, so this is the right one.'
              : 'Matched on name only — no website on the record to check it against. Have a look before applying.'}
          </p>

          <ul className="mt-2 space-y-0.5">
            {proposal.changes.map((change) => (
              <li key={change} className="text-small text-ink-muted">
                {change}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => apply(proposal.wikidataId)}
            >
              Fill these in
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setProposal(null)}
            >
              Not this company
            </Button>
          </div>
        </Note>
      )}
    </div>
  );
}

/**
 * The AI counterpart to Wikidata, for companies too small or too new to have
 * an encyclopedia entry -- which is most of them. Same propose-then-apply
 * shape: a search result is shown before it lands, and it only ever fills
 * the homepage and research notes when they are still blank.
 */
function AiEnrichment({ companyId }: { companyId: string }) {
  const [proposal, setProposal] = useState<AiEnrichmentProposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lookUp = () =>
    startTransition(async () => {
      setMessage(null);
      setProposal(null);
      const result = await proposeAiCompanyEnrichment({ companyId });
      if (result.error) setMessage(result.error);
      else if (result.proposal && !result.proposal.hasChanges) {
        setMessage('Found it, but the homepage and research notes are already filled in.');
      } else setProposal(result.proposal);
    });

  const apply = () => {
    if (!proposal) return;
    startTransition(async () => {
      const result = await applyAiCompanyEnrichment({
        companyId,
        website: proposal.website,
        summary: proposal.summary,
      });
      setProposal(null);
      setMessage(
        result.error ??
          (result.applied.length
            ? `Filled in ${result.applied.join(' and ')}.`
            : 'Nothing to fill in.'),
      );
    });
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-3">
        <DashAction
          type="button"
          size="sm"
          variant="secondary"
          pending={pending}
          onClick={lookUp}
          paid="app/jobs/(app)/companies/actions.ts#proposeAiCompanyEnrichment"
          what="Cost of the search"
        >
          {pending ? 'Looking it up…' : 'Look up this company'}
        </DashAction>
        {message && <span className="text-small text-ink-muted">{message}</span>}
      </div>

      <p className="mt-1 text-small leading-relaxed text-ink-muted">
        For the companies Wikidata has never heard of. Reads the web for a homepage and a plain
        summary; fills blank fields only.
      </p>

      {proposal && (
        // Same well as the Wikidata proposal above, for the same reason: this
        // is a search result waiting on your yes, not a fact about the company.
        <Note className="mt-3 p-3">
          {proposal.website && (
            <a
              href={proposal.website}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(linkVariants(), 'text-ui font-medium')}
            >
              {proposal.website}
            </a>
          )}
          {proposal.summary && <p className="mt-1 text-small text-ink-muted">{proposal.summary}</p>}

          {proposal.changes.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {proposal.changes.map((change) => (
                <li key={change} className="text-small text-ink-muted">
                  {change}
                </li>
              ))}
            </ul>
          )}

          {proposal.sources.length > 0 && (
            <p className="mt-2 text-small text-ink-muted">
              Sources:{' '}
              {proposal.sources.map((source, index) => (
                <span key={source.url}>
                  {index > 0 && ', '}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={linkVariants({ tone: 'quiet' })}
                  >
                    {source.title ?? new URL(source.url).hostname}
                  </a>
                </span>
              ))}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !proposal.hasChanges}
              onClick={apply}
            >
              Fill these in
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setProposal(null)}
            >
              Not this company
            </Button>
          </div>
        </Note>
      )}
    </div>
  );
}

/**
 * The people at this company, and a way to add one without going over to
 * Contacts (note 4323ee10). The form opens from a line, as Notes' does
 * (law 14), and the person it adds is attached to this company.
 */
function Contacts({
  companyId,
  contacts,
  addingPerson = false,
}: {
  companyId: string;
  contacts: CompanyContact[];
  addingPerson?: boolean;
}) {
  const [adding, setAdding] = useState(addingPerson);
  const [more, setMore] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: { error?: string; message?: string }, formData: FormData) => {
      const result = await createContact(prev, formData);
      if (!result.error) setAdding(false);
      return result;
    },
    {},
  );

  return (
    // No heading of its own: the People tab above already names it (law 9).
    <Card padding="dense" data-slot="section">
      {adding ? (
        // Placeholders name the fields rather than labels above them, and the
        // short fields share rows at every width, with the two links folded
        // behind More, so the open form is three rows at 390 (law 9).
        <form action={action} className="mb-4 space-y-2">
          <input type="hidden" name="companyId" value={companyId} />
          <div className="grid grid-cols-2 gap-2">
            <Input name="fullName" aria-label="Name" placeholder="Name" required autoFocus className={phoneTall} />
            <Input name="title" aria-label="Title" placeholder="Title" className={phoneTall} />
          </div>
          {more && (
            <div className="grid grid-cols-2 gap-2">
              <Input name="linkedinUrl" type="url" aria-label="LinkedIn" placeholder="LinkedIn URL" className={phoneTall} />
              <Input name="email" type="email" aria-label="Work email" placeholder="Work email" className={phoneTall} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select name="relationship" aria-label="Relationship" defaultValue="cold" className={cn(phoneTall, 'w-32')}>
              {RELATIONSHIPS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" pending={pending}>
              Add person
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <FieldError>{state.error}</FieldError>
          </div>
          {!more && (
            <Button type="button" variant="link" onClick={() => setMore(true)}>
              More: LinkedIn and work email
            </Button>
          )}
        </form>
      ) : (
        <AddTrigger label="Add a person" onClick={() => setAdding(true)} />
      )}
      {contacts.length === 0 ? (
        !adding && <EmptyState size="inline" title="Nobody recorded here yet." className="mt-2" />
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {contacts.map((contact) => (
            <li key={contact.id} className="row-pad flex flex-wrap items-baseline gap-2">
              <Link
                href={`/jobs/contacts/${contact.id}`}
                className="press-area text-ui font-medium text-ink transition-colors duration-quick hover:text-accent"
                title="See details, notes and logged sends"
              >
                {contact.fullName}
              </Link>
              {contact.title && <span className="text-small text-ink-muted">{contact.title}</span>}
              <Chip>{contact.relationship.replace(/_/g, ' ')}</Chip>
              <span className="text-small text-ink-muted">{contact.status.replace(/_/g, ' ')}</span>
              {contact.linkedinUrl && (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(linkVariants(), 'press-area text-small')}
                >
                  LinkedIn
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-small leading-relaxed text-ink-muted">
        Name, title, public professional URL and work email only. This is other people&rsquo;s data,
        and it has no product value beyond contacting them.
      </p>
    </Card>
  );
}

/** A field drawn at a phone's 44px press height below sm, at the control height above. */
const phoneTall = 'min-h-11 sm:min-h-0';

type CompanyContact = {
  id: string;
  fullName: string;
  title: string | null;
  relationship: string;
  status: string;
  linkedinUrl: string | null;
  email: string | null;
  howWeConnect: string | null;
};

function Touches({
  touches,
  timezone,
}: {
  touches: Array<{
    id: string;
    channel: string;
    direction: string;
    sentAt: string;
    respondedAt: string | null;
    message: string | null;
    contactName: string;
  }>;
  timezone: string;
}) {
  const outbound = touches.filter((t) => t.direction === 'outbound');
  const answered = outbound.filter((t) => t.respondedAt !== null);

  return (
    // No heading of its own: the Outreach tab above already names it (law 9).
    <Card padding="dense" data-slot="section">
      {outbound.length > 0 && (
        <p className="tabular text-small text-ink-muted">
          {answered.length} of {outbound.length} answered
        </p>
      )}
      {touches.length === 0 ? (
        <p className="text-ui text-ink-muted">
          No sends recorded. Response rate is only computable if the sends are recorded from the
          start, which is why logging them is in the MVP and drafting them is not.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {touches.map((touch) => (
            <li key={touch.id} className="row-pad">
              <div className="flex flex-wrap items-baseline gap-2 text-ui">
                <span className="font-medium text-ink">{touch.contactName}</span>
                <span className="text-ink-muted">{touch.channel.replace(/_/g, ' ')}</span>
                <span className="tabular text-small text-ink-muted">
                  {formatDate(touch.sentAt, timezone)}
                </span>
                {touch.respondedAt ? (
                  <span className="text-micro text-ink">replied</span>
                ) : (
                  <span className="text-small text-ink-muted">no reply yet</span>
                )}
              </div>
              {touch.message && (
                <p className="mt-0.5 line-clamp-2 text-small text-ink-muted">{touch.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Notes({
  companyId,
  notes,
  timezone,
}: {
  companyId: string;
  notes: Array<{ id: string; body: string; createdAt: string }>;
  timezone: string;
}) {
  const [body, setBody] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The notes are the section; the box that adds one is not. It was open on
  // arrival above them, so a panel whose job is to show what you have written
  // led with an empty box (law 14). It opens when there is something to add.
  return (
    // No heading of its own: the Notes tab above already names it (law 9).
    <Card padding="dense" data-slot="section">
      {adding ? (
        <div className="space-y-2">
          <Textarea
            rows={3}
            autoFocus
            value={body}
            aria-label="A note"
            onChange={(event) => setBody(event.target.value)}
            placeholder="Something you heard, someone worth talking to, a reason to move faster."
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !body.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await addNote({ companyId, body });
                  setError(result.error);
                  if (!result.error) {
                    setBody('');
                    setAdding(false);
                  }
                })
              }
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setBody('');
                setError(null);
                setAdding(false);
              }}
            >
              Cancel
            </Button>
            <FieldError>{error}</FieldError>
          </div>
        </div>
      ) : (
        <AddTrigger label="Add a note" onClick={() => setAdding(true)} />
      )}

      <ul className="mt-3 space-y-2">
        {notes.map((note) => (
          <li key={note.id}>
            <Note>
              <FoldingMarkdown markdown={note.body} className="text-ui text-ink" />
              <p className="tabular mt-1 text-small text-ink-muted">
                {formatDate(note.createdAt, timezone)}
              </p>
            </Note>
          </li>
        ))}
      </ul>
    </Card>
  );
}
