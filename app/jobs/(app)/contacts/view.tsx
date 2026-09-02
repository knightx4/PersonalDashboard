'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
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
      <section className="rounded-card border border-border bg-surface p-4 lg:order-2">
        <h2 className="text-[13px] font-semibold text-ink">Add someone</h2>
        <form action={action} className="mt-3 space-y-3">
          <div>
            <Label htmlFor="fullName">Name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Head of Finance" />
          </div>
          <div>
            <Label htmlFor="companyId">Company</Label>
            <Select id="companyId" name="companyId" defaultValue="">
              <option value="">Not attached</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="relationship">Relationship</Label>
            <Select id="relationship" name="relationship" defaultValue="cold">
              {RELATIONSHIPS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="howWeConnect">How you connect</Label>
            <Input id="howWeConnect" name="howWeConnect" placeholder="Same university, 2016" />
          </div>
          <div>
            <Label htmlFor="linkedinUrl">LinkedIn</Label>
            <Input id="linkedinUrl" name="linkedinUrl" type="url" />
          </div>
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input id="email" name="email" type="email" />
          </div>

          {state.error && (
            <p role="alert" className="text-[13px] text-status-rejected">
              {state.error}
            </p>
          )}
          {state.message && <p className="text-[13px] text-status-offer">{state.message}</p>}

          <Button type="submit" size="sm">
            Add contact
          </Button>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Name, title, public professional URL, work email. Nothing else, and nothing scraped —
            this is the part of the app most worth being careful with.
          </p>
        </form>
      </section>

      <div className="lg:col-span-2">
        {contacts.length === 0 ? (
          <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
            Nobody yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Company</th>
                  <th className="px-3 py-2 font-semibold">Relationship</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Last touch</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className="border-b border-border last:border-0 hover:bg-canvas">
                    <td className="px-3 py-2">
                      <Link
                        href={`/jobs/contacts/${contact.id}`}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {contact.fullName}
                      </Link>
                      {contact.title && (
                        <span className="ml-1.5 text-ink-muted">{contact.title}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {contact.companySlug ? (
                        <Link
                          href={`/jobs/companies/${contact.companySlug}`}
                          className="hover:text-brand hover:underline"
                        >
                          {contact.companyName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {contact.relationship.replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {contact.status.replace(/_/g, ' ')}
                      {contact.pendingReplies > 0 && (
                        <span className="ml-1.5 text-[11px] text-ink-faint">
                          ({contact.pendingReplies} unanswered)
                        </span>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-ink-faint">
                      {contact.lastTouchAt ? formatDate(contact.lastTouchAt, timezone) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
