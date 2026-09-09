'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { Field, FieldError, Input, Select, Textarea } from '@/components/ui/field';
import { formatDate } from '@/lib/jobs/applications/load';
import { addNote } from '@/app/jobs/(app)/roles/[id]/actions';
import {
  applyAiCompanyEnrichment,
  applyCompanyEnrichment,
  proposeAiCompanyEnrichment,
  proposeCompanyEnrichment,
  type AiEnrichmentProposal,
  type EnrichmentProposal,
} from '../actions';
import { updateCompany } from '../actions';

export function CompanyPanels(props: {
  companyId: string;
  research: string;
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
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Research {...props} />
        <Contacts {...props} />
        <Touches {...props} />
      </div>
      <div className="space-y-4">
        <Details {...props} />
        <Notes {...props} />
      </div>
    </div>
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

function Research({
  companyId,
  research,
}: {
  companyId: string;
  research: string;
}) {
  const [form, setForm] = useServerSeeded({ research });
  const text = form.research;
  const setText = (value: string) => setForm(() => ({ research: value }));
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <CardSection
      title="What you know about this place"
      hint="The one long-form field. It outlives every posting."
    >
      <Textarea
        rows={8}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="mt-2"
        placeholder="Funding, who runs the team, what the last two people you spoke to said, why you would or would not go."
      />
      <div className="mt-2 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateCompany({ companyId, research: text });
              setSaved(result.error ?? 'Saved.');
            })
          }
        >
          Save
        </Button>
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
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
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

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
              className="mt-1 inline-block text-small text-accent underline underline-offset-2"
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
        setMessage(`Found ${result.proposal.label}, but every field it knows is already filled in.`);
      } else setProposal(result.proposal);
    });

  const apply = (wikidataId: string) =>
    startTransition(async () => {
      const result = await applyCompanyEnrichment({ companyId, wikidataId });
      setProposal(null);
      setMessage(
        result.error ??
          (result.applied.length ? `Filled in ${result.applied.length} field(s).` : 'Nothing to fill in.'),
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
        <div className="mt-3 rounded-card bg-canvas p-3">
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
        </div>
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
          (result.applied.length ? `Filled in ${result.applied.join(' and ')}.` : 'Nothing to fill in.'),
      );
    });
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="secondary" pending={pending} onClick={lookUp}>
          {pending ? 'Searching…' : 'Search with AI'}
        </Button>
        {message && <span className="text-small text-ink-muted">{message}</span>}
      </div>

      <p className="mt-1 text-small leading-relaxed text-ink-muted">
        For the companies Wikidata has never heard of. Reads the web for a homepage and a plain
        summary; fills blank fields only.
      </p>

      {proposal && (
        // Same well as the Wikidata proposal above, for the same reason: this
        // is a search result waiting on your yes, not a fact about the company.
        <div className="mt-3 rounded-card bg-canvas p-3">
          {proposal.website && (
            <a
              href={proposal.website}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ui font-medium text-accent underline underline-offset-2"
            >
              {proposal.website}
            </a>
          )}
          {proposal.summary && (
            <p className="mt-1 text-small text-ink-muted">{proposal.summary}</p>
          )}

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
                    className="underline underline-offset-2"
                  >
                    {source.title ?? new URL(source.url).hostname}
                  </a>
                </span>
              ))}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" disabled={pending || !proposal.hasChanges} onClick={apply}>
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
        </div>
      )}
    </div>
  );
}

function Contacts({ contacts }: { contacts: CompanyContact[] }) {
  return (
    <CardSection title="People">
      {contacts.length === 0 ? (
        <p className="mt-2 text-ui text-ink-muted">
          Nobody recorded here yet. Add people from the contacts page.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {contacts.map((contact) => (
            <li key={contact.id} className="row-pad flex flex-wrap items-baseline gap-2">
              <Link
                href={`/jobs/contacts/${contact.id}`}
                className="text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
                title="See details, notes and logged sends"
              >
                {contact.fullName}
              </Link>
              {contact.title && <span className="text-small text-ink-muted">{contact.title}</span>}
              <span className="rounded-full bg-canvas px-1.5 py-0.5 text-small text-ink-muted">
                {contact.relationship.replace(/_/g, ' ')}
              </span>
              <span className="text-small text-ink-muted">{contact.status.replace(/_/g, ' ')}</span>
              {contact.linkedinUrl && (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-small text-accent underline underline-offset-2"
                >
                  LinkedIn
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-small leading-relaxed text-ink-muted">
        Name, title, public professional URL and work email only. This is other people&rsquo;s
        data, and it has no product value beyond contacting them.
      </p>
    </CardSection>
  );
}

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
    <CardSection
      title="Outreach"
      action={
        outbound.length > 0 ? (
          <span className="tabular text-small text-ink-muted">
            {answered.length} of {outbound.length} answered
          </span>
        ) : undefined
      }
    >
      {touches.length === 0 ? (
        <p className="mt-2 text-ui text-ink-muted">
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
    </CardSection>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <CardSection title="Notes">
      <Textarea
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="mt-2"
        placeholder="Something you heard, someone worth talking to, a reason to move faster."
      />
      <div className="mt-2 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || !body.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await addNote({ companyId, body });
              setError(result.error);
              if (!result.error) setBody('');
            })
          }
        >
          Add
        </Button>
        <FieldError>{error}</FieldError>
      </div>

      <ul className="mt-3 space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg bg-canvas p-2.5">
            <p className="whitespace-pre-wrap text-ui text-ink">{note.body}</p>
            <p className="tabular mt-1 text-small text-ink-muted">
              {formatDate(note.createdAt, timezone)}
            </p>
          </li>
        ))}
      </ul>
    </CardSection>
  );
}
