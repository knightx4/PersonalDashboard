'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Link2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { APPLICATION_SOURCES, SOURCE_LABELS } from '@/lib/jobs/pipeline';
import { createRole, fetchJobDescription, type RoleFormState } from '../actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
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
      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-body font-semibold text-ink">Start from a link</h2>
        <p className="mt-1 text-ui text-ink-muted">
          Greenhouse, Lever and Ashby come back complete. Most other career pages work too.
          LinkedIn and Workday do not, and will say so.
        </p>
        <form action={fetchAction} className="mt-3 flex flex-wrap gap-2">
          <Input
            name="jdUrl"
            type="url"
            value={jdUrl}
            onChange={(event) => setJdUrl(event.target.value)}
            placeholder="https://boards.greenhouse.io/company/jobs/1234567"
            className="min-w-64 flex-1"
          />
          <Button type="submit" variant="secondary">
            <Link2 className="size-4" strokeWidth={1.75} />
            Fetch
          </Button>
        </form>

        {fetchState.notice && (
          <p className="mt-3 flex gap-2 rounded-lg bg-caution-tint px-3 py-2 text-ui text-ink">
            <Info className="mt-0.5 size-4 shrink-0 text-caution" strokeWidth={1.75} />
            {fetchState.notice}
          </p>
        )}
        {fetchState.error && (
          <p role="alert" className="mt-3 text-ui text-status-rejected">
            {fetchState.error}
          </p>
        )}
        {fetched && (
          <p className="mt-3 rounded-lg bg-status-offer-tint px-3 py-2 text-ui text-status-offer">
            Read the posting from {fetched.vendor}
            {fetched.questionCount > 0 &&
              ` — and ${fetched.questionCount} application questions`}
            .
          </p>
        )}
      </section>

      <form
        key={fieldsKey}
        action={createAction}
        className="space-y-4 rounded-card border border-border bg-surface p-5"
      >
        <input type="hidden" name="jdUrl" value={jdUrl} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="companyName">Company</Label>
            <Input
              id="companyName"
              name="companyName"
              list="known-companies"
              required
              placeholder="Ramp"
            />
            <datalist id="known-companies">
              {companies.map((company) => (
                <option key={company.name} value={company.name} />
              ))}
            </datalist>
          </div>

          <div>
            <Label htmlFor="title">Role</Label>
            <Input
              id="title"
              name="title"
              required
              defaultValue={fetched?.title ?? ''}
              placeholder="Strategic Finance Analyst"
            />
          </div>

          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              name="location"
              defaultValue={fetched?.location ?? ''}
              placeholder="New York, NY"
            />
          </div>

          <div>
            <Label htmlFor="source">How you found it</Label>
            <Select id="source" name="source" defaultValue="portal">
              {APPLICATION_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-micro text-ink-muted">
              This drives the by-channel funnel, which is where the diagnosis lives.
            </p>
          </div>

          <div>
            <Label htmlFor="submittedAt">Date applied</Label>
            <Input id="submittedAt" name="submittedAt" type="date" />
          </div>

          <div>
            <Label htmlFor="excitement">Excitement</Label>
            <Select id="excitement" name="excitement" defaultValue="">
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((level) => (
                <option key={level} value={level}>
                  {'★'.repeat(level)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="jdText">Job description</Label>
          <Textarea
            id="jdText"
            name="jdText"
            rows={12}
            defaultValue={fetched?.text ?? ''}
            placeholder="Paste the description here if the link could not be read. This is always available and always works."
          />
          <p className="mt-1 text-micro text-ink-muted">
            Kept in full, unlike email. It is public text you fetched from a public page, it is
            what the requirement map reads, and refetching it later usually fails because the
            posting is gone.
          </p>
        </div>

        <label className="flex items-center gap-2 text-ui text-ink">
          <input type="checkbox" name="saveAsLead" className="size-4 rounded border-border" />
          Save as a lead — I have not applied yet
        </label>

        {createState.error && (
          <p role="alert" className="text-ui text-status-rejected">
            {createState.error}
          </p>
        )}

        <Submit label="Add role" />
      </form>
    </div>
  );
}
