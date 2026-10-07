'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { CardSection, cardVariants } from '@/components/ui/card';
import { Field, FieldError, Input, Select, Textarea } from '@/components/ui/field';
import { APPLICATION_SOURCES, SOURCE_LABELS, type ApplicationSource } from '@/lib/jobs/pipeline';
import { referrerLabel, type ReferrerOption } from '@/lib/jobs/contacts/referrers';
import { createRole, fetchJobDescription, type RoleFormState } from '../actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending}>
      {pending ? 'One moment…' : label}
    </Button>
  );
}

/**
 * Paste a link, or paste the description. Both paths are given equal visual
 * weight on purpose: the fetch tiers fail often enough — LinkedIn and Workday
 * never work — that burying the paste box as a fallback would be dishonest
 * about how the feature actually behaves.
 */
export function RoleForm({
  companies,
  contacts = [],
  defaultSource = 'portal',
}: {
  companies: Array<{ name: string }>;
  /** The people you know, for naming who referred you. */
  contacts?: ReferrerOption[];
  /** The channel the form opens on; the gallery opens it on Referral. */
  defaultSource?: ApplicationSource;
}) {
  const [fetchState, fetchAction] = useActionState<RoleFormState, FormData>(
    fetchJobDescription,
    {},
  );
  const [createState, createAction] = useActionState<RoleFormState, FormData>(createRole, {});

  const [jdUrl, setJdUrl] = useState('');
  const [source, setSource] = useState<ApplicationSource>(defaultSource);

  /*
   * The fetched posting fills the fields by REMOUNTING them, not by syncing
   * into state from an effect. Same result, no cascading render, and a second
   * fetch cleanly replaces what the first one put there.
   */
  const fetched = fetchState.fetched;
  const fieldsKey = fetched ? `${fetched.vendor}:${fetched.title}` : 'empty';

  return (
    <div className="space-y-6">
      <CardSection
        padding="standard"
        title="Start from a link"
        hint="Greenhouse, Lever and Ashby come back complete. Most other career pages work too. LinkedIn and Workday do not, and will say so."
      >
        <form action={fetchAction} className="mt-3 flex flex-wrap gap-2">
          <Input
            name="jdUrl"
            type="url"
            aria-label="Posting link"
            value={jdUrl}
            onChange={(event) => setJdUrl(event.target.value)}
            placeholder="https://boards.greenhouse.io/company/jobs/1234567"
            className="min-w-64 flex-1"
          />
          <Button type="submit" variant="secondary">
            <Link2 className="size-4" strokeWidth={1.75} aria-hidden />
            Fetch
          </Button>
        </form>

        {fetchState.notice && (
          <Banner tone="warn" className="mt-3">
            {fetchState.notice}
          </Banner>
        )}
        <FieldError>{fetchState.error}</FieldError>
        {/* Plain ink: a fetch that worked is a fact, not an achievement, and
            the offer hue belongs to the pipeline stage alone. */}
        {fetched && (
          <p className="mt-3 text-ui text-ink">
            Read the posting from {fetched.vendor}
            {fetched.questionCount > 0 &&
              ` — and ${fetched.questionCount} application questions`}
            .
          </p>
        )}
      </CardSection>

      <form
        key={fieldsKey}
        action={createAction}
        className={cn(cardVariants({ padding: 'standard' }), 'space-y-4')}
      >
        <input type="hidden" name="jdUrl" value={jdUrl} />

        {/* Company, role and location carry their names in the placeholder and
          * the accessible name, not in a label above each box, so each is one
          * row at 390 (law 9). They fill whole rows together, so the labelled
          * selects after them pair with each other and line up at a laptop. */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <Input
              id="companyName"
              name="companyName"
              list="known-companies"
              required
              aria-label="Company"
              placeholder="Company, such as Ramp"
            />
            <datalist id="known-companies">
              {companies.map((company) => (
                <option key={company.name} value={company.name} />
              ))}
            </datalist>
          </div>

          <Input
            id="title"
            name="title"
            required
            aria-label="Role"
            defaultValue={fetched?.title ?? ''}
            placeholder="Role, such as Strategic Finance Analyst"
            className="col-span-2 sm:col-span-1"
          />

          <Input
            id="location"
            name="location"
            aria-label="Location"
            defaultValue={fetched?.location ?? ''}
            placeholder="Location, such as New York, NY"
            className="col-span-2"
          />

          <Field id="source" label="How you applied" className="col-span-2 sm:col-span-1">
            <Select
              name="source"
              value={source}
              onChange={(event) => setSource(event.target.value as ApplicationSource)}
            >
              {APPLICATION_SOURCES.map((option) => (
                <option key={option} value={option}>
                  {SOURCE_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          {source === 'referral' && (
            <Field
              id="referralContactId"
              label="Who referred you"
              hint={contacts.length === 0 ? 'Add them under Contacts to name them here.' : undefined}
              className="col-span-2 sm:col-span-1"
            >
              <Select name="referralContactId" defaultValue="" className="max-sm:min-h-11">
                <option value="">Not named</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {referrerLabel(contact)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field id="submittedAt" label="Date applied">
            <Input name="submittedAt" type="date" />
          </Field>

          <Field id="excitement" label="Excitement">
            <Select name="excitement" defaultValue="">
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((level) => (
                <option key={level} value={level}>
                  {'★'.repeat(level)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Kept in full, unlike email: it is public text from a public page,
          * the requirement map reads it, and refetching later usually fails
          * because the posting is gone. */}
        <Field id="jdText" label="Job description">
          {/* ui-ok: composer-always-open -- this whole page is the create.
            * Law 14 permits landing in edit mode for a new thing; there is
            * nothing here to read yet. */}
          <Textarea
            name="jdText"
            rows={8}
            defaultValue={fetched?.text ?? ''}
            placeholder="Paste the description here if the link could not be read."
          />
        </Field>

        <FieldError>{createState.error}</FieldError>

        {/* Pinned above the dock while the form scrolls on a phone, so Add
          * role is always in reach (taste:forward-action-in-reach). The lead
          * box rides with it, since it changes what the press does. */}
        <div className="card-pad-x sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] -mx-(--card-p) flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Submit label="Add role" />
          <label className="flex items-center gap-2 text-ui text-ink">
            <input type="checkbox" name="saveAsLead" className="size-4 rounded border-border" />
            Save as a lead, not applied yet
          </label>
        </div>
      </form>
    </div>
  );
}
