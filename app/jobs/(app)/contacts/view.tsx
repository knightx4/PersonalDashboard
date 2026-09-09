'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldError, Input, Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/jobs/applications/load';
import { createContact } from './actions';

const RELATIONSHIPS = [
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
  const [state, action] = useActionState(createContact, {});

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Below the list on a phone, beside it on a laptop.
        *
        * `lg:order-2` moved it to the right on a wide screen and said nothing
        * about a narrow one, so at 390px an empty eight-field form was the
        * first thing on the Contacts page and the contacts were under it. The
        * form is what you came here to use second. */}
      <CardSection id="add-contact" title="Add someone" className="order-last lg:order-2">
        <form action={action} className="space-y-3">
          <Field id="fullName" label="Name">
            <Input id="fullName" name="fullName" required />
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

          {/* The action returns one error for the whole form, not one per field,
              so it sits under the fields rather than beside one of them. */}
          <FieldError>{state.error}</FieldError>
          {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}

          <Button type="submit" size="sm">
            Add contact
          </Button>
          <p className="text-small leading-relaxed text-ink-muted">
            Name, title, public professional URL, work email. Nothing else, and nothing scraped —
            this is the part of the app most worth being careful with.
          </p>
        </form>
      </CardSection>

      <div className="lg:col-span-2">
        {contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nobody yet"
            description="The people you reach out to, and where each conversation stands. Add the first one with the form on this page."
            action={{ label: 'Add someone', href: '#add-contact' }}
          />
        ) : (
          <Card padding="none" className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Company</TH>
                  <TH>Relationship</TH>
                  <TH>Status</TH>
                  <TH>Last touch</TH>
                </TR>
              </THead>
              <TBody>
                {contacts.map((contact) => (
                  <TR key={contact.id} href={`/jobs/contacts/${contact.id}`}>
                    <TD primary>
                      {contact.fullName}
                      {contact.title && (
                        <span className="ml-1.5 font-normal text-ink-muted">{contact.title}</span>
                      )}
                    </TD>
                    <TD label="Company" muted>
                      {contact.companySlug ? (
                        // `relative` lifts this above the row link the primary
                        // cell stretches, so the company is still its own destination.
                        <Link
                          href={`/jobs/companies/${contact.companySlug}`}
                          className="relative transition-colors duration-150 hover:text-accent hover:underline"
                        >
                          {contact.companyName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD label="Relationship" muted>
                      {contact.relationship.replace(/_/g, ' ')}
                    </TD>
                    <TD label="Status" muted>
                      {contact.status.replace(/_/g, ' ')}
                      {contact.pendingReplies > 0 && (
                        <span className="ml-1.5 text-micro">({contact.pendingReplies} unanswered)</span>
                      )}
                    </TD>
                    <TD label="Last touch" num muted>
                      {contact.lastTouchAt ? formatDate(contact.lastTouchAt, timezone) : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
