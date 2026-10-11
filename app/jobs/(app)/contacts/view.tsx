'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldError, Input, Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/jobs/applications/load';
import { createContact } from './actions';

export const RELATIONSHIPS = [
  'cold',
  'alum',
  'second_degree',
  'former_colleague',
  'friend',
  'recruiter',
  'interviewer',
] as const;

export interface ContactRow {
  id: string;
  fullName: string;
  title: string | null;
  relationship: string;
  status: string;
  linkedinUrl: string | null;
  email: string | null;
  howWeConnect: string | null;
  notes: string | null;
  companyName: string | null;
  companySlug: string | null;
  touches: Array<{
    id: string;
    channel: string;
    direction: string;
    sentAt: string;
    respondedAt: string | null;
    message: string | null;
  }>;
}

/** A row's place in the table: who they are, and where a send to them stands. */
export interface ContactListRow {
  id: string;
  fullName: string;
  title: string | null;
  relationship: string;
  status: string;
  companyName: string | null;
  companySlug: string | null;
  lastTouchAt: string | null;
  pendingReplies: number;
}

export function ContactsView({
  contacts,
  companies,
  timezone,
}: {
  contacts: ContactListRow[];
  companies: Array<{ id: string; name: string }>;
  timezone: string;
}) {
  // Adding someone starts with one press (taste:add-is-one-press). The
  // seven-field form used to stand open beside the list, longer than the list
  // itself, and filled the right column on a laptop.
  const [adding, setAdding] = useState(false);

  const addButton = (
    <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
      Add someone
    </Button>
  );

  return (
    <div className="space-y-4">
      {contacts.length === 0 ? (
        adding ? null : (
          <EmptyState
            icon={Users}
            title="Nobody yet"
            description="The people you reach out to, and where each conversation stands."
          >
            {addButton}
          </EmptyState>
        )
      ) : (
        <>
          {/* A phone gets two lines a person: who they are, then where things
            * stand as plain values (law 9). Labelling each value again on
            * every row took five lines a person. */}
          <Card padding="none" className="md:hidden">
            <ul className="divide-y divide-border">
              {contacts.map((contact) => (
                <li key={contact.id} className="relative card-pad-x row-pad hover:bg-sunken">
                  <p className="min-w-0 truncate text-ui">
                    <Link
                      href={`/jobs/contacts/${contact.id}`}
                      className="font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-accent"
                    >
                      {contact.fullName}
                    </Link>
                    {contact.title && <span className="ml-1.5 text-ink-muted">{contact.title}</span>}
                  </p>
                  {/* The date keeps its place at the right end; what comes
                    * before it is what shortens when the line runs out. */}
                  <p className="mt-0.5 flex items-baseline gap-3 text-small text-ink-muted">
                    <span className="min-w-0 flex-1 truncate">
                      {[contact.companyName, contact.relationship.replace(/_/g, ' '), shortStatus(contact)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {contact.lastTouchAt && (
                      <span className="tabular shrink-0">{shortDate(contact.lastTouchAt, timezone)}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card padding="none" className="overflow-hidden max-md:hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Company</TH>
                  <TH>Relationship</TH>
                  <TH>Status</TH>
                  <TH num>Last touch</TH>
                </TR>
              </THead>
              <TBody>
                {contacts.map((contact) => (
                  <TR key={contact.id} href={`/jobs/contacts/${contact.id}`}>
                    <TD primary>
                      {contact.fullName}
                      {/* Under the name, so the name column does not crowd
                        * the date off the table's edge (law 18). */}
                      {contact.title && (
                        <span className="block font-normal text-small text-ink-muted">
                          {contact.title}
                        </span>
                      )}
                    </TD>
                    <TD muted>
                      {contact.companySlug ? (
                        // `relative` lifts this above the row link the primary
                        // cell stretches, so the company is still its own destination.
                        <Link
                          href={`/jobs/companies/${contact.companySlug}`}
                          className="relative transition-colors duration-quick hover:text-accent hover:underline"
                        >
                          {contact.companyName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD muted>{contact.relationship.replace(/_/g, ' ')}</TD>
                    <TD muted className="whitespace-nowrap">
                      {statusText(contact)}
                    </TD>
                    <TD num muted>
                      {contact.lastTouchAt ? formatDate(contact.lastTouchAt, timezone) : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          {!adding && addButton}
        </>
      )}

      {adding && (
        <CardSection id="add-contact" title="Add someone">
          <AddContactForm companies={companies} onCancel={() => setAdding(false)} />
        </CardSection>
      )}
    </div>
  );
}

/** "21 Aug", with the year only when it is not this one, so the subline keeps its room. */
function shortDate(iso: string, timezone: string): string {
  const full = formatDate(iso, timezone);
  const year = String(new Date().getFullYear());
  return full.endsWith(` ${year}`) ? full.slice(0, -year.length - 1) : full;
}

/** On a phone a send still waiting says the whole of it: "1 unanswered" means contacted. */
function shortStatus(contact: ContactListRow): string {
  return contact.pendingReplies > 0
    ? `${contact.pendingReplies} unanswered`
    : contact.status.replace(/_/g, ' ');
}

/** The status, with the count of sends still waiting on an answer kept beside it. */
function statusText(contact: ContactListRow): string {
  const status = contact.status.replace(/_/g, ' ');
  return contact.pendingReplies > 0 ? `${status} (${contact.pendingReplies} unanswered)` : status;
}

function AddContactForm({
  companies,
  onCancel,
}: {
  companies: Array<{ id: string; name: string }>;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(createContact, {});

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="fullName" label="Name">
          <Input id="fullName" name="fullName" required autoFocus />
        </Field>
        <Field id="title" label="Title">
          <Input id="title" name="title" placeholder="Head of Finance" />
        </Field>
        <Field id="companyId" label="Company">
          <Select id="companyId" name="companyId" defaultValue="">
            <option value="">Not attached</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="relationship" label="Relationship">
          <Select id="relationship" name="relationship" defaultValue="cold">
            {RELATIONSHIPS.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="howWeConnect" label="How you connect">
          <Input id="howWeConnect" name="howWeConnect" placeholder="Same university, 2016" />
        </Field>
        <Field id="linkedinUrl" label="LinkedIn">
          <Input id="linkedinUrl" name="linkedinUrl" type="url" />
        </Field>
        <Field id="email" label="Work email">
          <Input id="email" name="email" type="email" />
        </Field>
      </div>

      {/* The action returns one error for the whole form, not one per field,
          so it sits under the fields rather than beside one of them. */}
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          Add contact
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-small leading-relaxed text-ink-muted">
        Name, title, public professional URL, work email. Nothing else, and nothing scraped.
      </p>
    </form>
  );
}
