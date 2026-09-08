'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { CardSection, cardVariants } from '@/components/ui/card';
import { Field, FieldError, Input, Select, Textarea } from '@/components/ui/field';
import { APPLICATION_SOURCES, SOURCE_LABELS } from '@/lib/jobs/pipeline';
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
export function RoleForm({ companies }: { companies: Array<{ name: string }> }) {
  const [fetchState, fetchAction] = useActionState<RoleFormState, FormData>(
    fetchJobDescription,
    {},
  );
  const [createState, createAction] = useActionState<RoleFormState, FormData>(createRole, {});

  const [jdUrl, setJdUrl] = useState('');

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

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field id="companyName" label="Company">
              <Input name="companyName" list="known-companies" required placeholder="Ramp" />
            </Field>
            <datalist id="known-companies">
              {companies.map((company) => (
                <option key={company.name} value={company.name} />
              ))}
            </datalist>
          </div>

          <Field id="title" label="Role">
            <Input
              name="title"
              required
              defaultValue={fetched?.title ?? ''}
              placeholder="Strategic Finance Analyst"
            />
          </Field>

          <Field id="location" label="Location">
            <Input
              name="location"
              defaultValue={fetched?.location ?? ''}
              placeholder="New York, NY"
            />
          </Field>

          <Field
            id="source"
            label="How you found it"
            hint="This drives the by-channel funnel, which is where the diagnosis lives."
          >
            <Select name="source" defaultValue="portal">
              {APPLICATION_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </Select>
          </Field>

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

        <Field
          id="jdText"
          label="Job description"
          hint="Kept in full, unlike email. It is public text you fetched from a public page, it is what the requirement map reads, and refetching it later usually fails because the posting is gone."
        >
          <Textarea
            name="jdText"
            rows={12}
            defaultValue={fetched?.text ?? ''}
            placeholder="Paste the description here if the link could not be read. This is always available and always works."
          />
        </Field>

        <label className="flex items-center gap-2 text-ui text-ink">
          <input type="checkbox" name="saveAsLead" className="size-4 rounded border-border" />
          Save as a lead — I have not applied yet
        </label>

        <FieldError>{createState.error}</FieldError>

        <Submit label="Add role" />
      </form>
    </div>
  );
}
