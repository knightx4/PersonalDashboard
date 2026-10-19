'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { CheckRow, Field, FieldError, Input, Select } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { CONTACT_RELATIONSHIPS } from '@/lib/jobs/contacts-view';
import { createContact } from './actions';

/**
 * Adding someone, on the Contacts page. Opened from the header's Add someone,
 * which sets `add=1` on the address, so the form sits above the leads where
 * the eye starts, and a long list does not push it out of sight. Adding or
 * cancelling goes back to the page as it was.
 */
export function AddContact({
  companies,
  closeHref,
}: {
  companies: Array<{ id: string; name: string }>;
  closeHref: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createContact, {});

  useEffect(() => {
    if (state.message) router.replace(closeHref);
  }, [state, router, closeHref]);

  return (
    <CardSection id="add-contact" title="Add someone" className="mb-6">
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
              {CONTACT_RELATIONSHIPS.map((entry) => (
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
        <CheckRow name="potentialLead" title="Potential lead" hint="Someone who could lead to a job." />
        <CheckRow
          name="foundByDash"
          title="Found by Dash"
          hint="Dash or an agent found them, rather than you knowing them."
        />

        {/* The action returns one error for the whole form, not one per field,
            so it sits under the fields rather than beside one of them. */}
        <FieldError>{state.error}</FieldError>

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" pending={pending}>
            Add contact
          </Button>
          <Link href={closeHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
        </div>
        <p className="text-small leading-relaxed text-ink-muted">
          Name, title, public professional URL, work email. Nothing else, and nothing scraped.
        </p>
      </form>
    </CardSection>
  );
}
