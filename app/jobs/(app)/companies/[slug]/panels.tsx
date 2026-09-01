'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { formatDate } from '@/lib/jobs/applications/load';
import { addNote } from '@/app/jobs/(app)/roles/[id]/actions';
import {
  applyCompanyEnrichment,
  proposeCompanyEnrichment,
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

function Research({
  companyId,
  research,
}: {
  companyId: string;
  research: string;
}) {
  const [text, setText] = useState(research);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-[13px] font-semibold text-ink">What you know about this place</h2>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        The one long-form field. It outlives every posting.
      </p>
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
        {saved && <span className="text-[12px] text-ink-muted">{saved}</span>}
      </div>
    </section>
  );
}

function Details({
  companyId,
  domains,
  industry,
  hqLocation,
  careersUrl,
  linkedinUrl,
  priority,
}: {
  companyId: string;
  domains: string;
  industry: string;
  hqLocation: string;
  careersUrl: string;
  linkedinUrl: string;
  priority: string;
}) {
  const [form, setForm] = useState({
    domains,
    industry,
    hqLocation,
    careersUrl,
    linkedinUrl,
    priority,
  });
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-[13px] font-semibold text-ink">Details</h2>

      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="domains">Email domains</Label>
          <Input
            id="domains"
            value={form.domains}
            onChange={(event) => set('domains')(event.target.value)}
            placeholder="ramp.com, ramp.co"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
            This is what lets a recruiter&rsquo;s personal work address find this company. It is
            also the list the second inbox query searches, which is how direct outreach gets
            caught at all.
          </p>
        </div>

        <div>
          <Label htmlFor="priority">Priority</Label>
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
        </div>

        <div>
          <Label htmlFor="industry">Industry</Label>
          <Input
            id="industry"
            value={form.industry}
            onChange={(event) => set('industry')(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="hqLocation">HQ</Label>
          <Input
            id="hqLocation"
            value={form.hqLocation}
            onChange={(event) => set('hqLocation')(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="careersUrl">Careers page</Label>
          <Input
            id="careersUrl"
            value={form.careersUrl}
            onChange={(event) => set('careersUrl')(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="linkedinUrl">LinkedIn</Label>
          <Input
            id="linkedinUrl"
            value={form.linkedinUrl}
            onChange={(event) => set('linkedinUrl')(event.target.value)}
          />
        </div>
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
                priority: form.priority as 'target' | 'interested' | 'backup' | 'passed',
              });
              setSaved(result.error ?? 'Saved.');
            })
          }
        >
          Save
        </Button>
        {saved && <span className="text-[12px] text-ink-muted">{saved}</span>}
      </div>

      <Enrichment companyId={companyId} />
    </section>
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
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={lookUp}>
          {pending ? 'Looking up…' : 'Look up on Wikidata'}
        </Button>
        {message && <span className="text-[12px] text-ink-muted">{message}</span>}
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        Fills blank fields only — anything you have typed is left exactly as it is.
      </p>

      {proposal && (
        <div className="mt-3 rounded-card border border-border bg-canvas p-3">
          <p className="text-[13px] font-medium text-ink">{proposal.label}</p>
          {proposal.description && (
            <p className="text-[12px] text-ink-muted">{proposal.description}</p>
          )}

          <p className="mt-1 text-[11px] text-ink-faint">
            {proposal.verified
              ? 'Matched on the company’s own website, so this is the right one.'
              : 'Matched on name only — no website on the record to check it against. Have a look before applying.'}
          </p>

          <ul className="mt-2 space-y-0.5">
            {proposal.changes.map((change) => (
              <li key={change} className="text-[12px] text-ink-muted">
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

function Contacts({ contacts }: { contacts: CompanyContact[] }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-[13px] font-semibold text-ink">People</h2>
      {contacts.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-faint">
          Nobody recorded here yet. Add people from the contacts page.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-baseline gap-2 py-2">
              <Link
                href={`/jobs/contacts#contact-${contact.id}`}
                className="text-[13px] font-medium text-ink hover:underline"
                title="Add or edit their details"
              >
                {contact.fullName}
              </Link>
              {contact.title && <span className="text-[12px] text-ink-muted">{contact.title}</span>}
              <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-ink-muted">
                {contact.relationship.replace(/_/g, ' ')}
              </span>
              <span className="text-[11px] text-ink-faint">{contact.status.replace(/_/g, ' ')}</span>
              {contact.linkedinUrl && (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[12px] text-brand underline underline-offset-2"
                >
                  LinkedIn
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Name, title, public professional URL and work email only. This is other people&rsquo;s
        data, and it has no product value beyond contacting them.
      </p>
    </section>
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
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-ink">Outreach</h2>
        {outbound.length > 0 && (
          <span className="tabular text-[12px] text-ink-muted">
            {answered.length} of {outbound.length} answered
          </span>
        )}
      </div>
      {touches.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-faint">
          No sends recorded. Response rate is only computable if the sends are recorded from the
          start, which is why logging them is in the MVP and drafting them is not.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {touches.map((touch) => (
            <li key={touch.id} className="py-2">
              <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <span className="font-medium text-ink">{touch.contactName}</span>
                <span className="text-ink-muted">{touch.channel.replace(/_/g, ' ')}</span>
                <span className="tabular text-[12px] text-ink-faint">
                  {formatDate(touch.sentAt, timezone)}
                </span>
                {touch.respondedAt ? (
                  <span className="text-[11px] text-status-offer">replied</span>
                ) : (
                  <span className="text-[11px] text-ink-faint">no reply yet</span>
                )}
              </div>
              {touch.message && (
                <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-muted">{touch.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-[13px] font-semibold text-ink">Notes</h2>
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
        {error && <span className="text-[12px] text-status-rejected">{error}</span>}
      </div>

      <ul className="mt-3 space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg bg-canvas p-2.5">
            <p className="whitespace-pre-wrap text-[13px] text-ink">{note.body}</p>
            <p className="tabular mt-1 text-[11px] text-ink-faint">
              {formatDate(note.createdAt, timezone)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
