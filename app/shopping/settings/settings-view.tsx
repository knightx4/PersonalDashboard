import type { ComponentProps } from 'react';
import Link from 'next/link';
import { Heart, ListChecks, Mail, RotateCcw, ShieldCheck, Tag, Tags, User } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { signOut } from '@/app/(auth)/actions';
import type { Person } from '@/lib/people/load';
import type { MerchantPolicyRow } from '@/lib/returns/policies';
import { CategoriesSection, type SettingsCategory } from './categories-section';
import {
  DeletedOrdersSection,
  DeletedOrdersTitle,
  type DeletedOrderRow,
} from './deleted-orders-section';
import { InboxSection } from './inbox-section';
import type { InboxSyncProgress } from './inbox-sync-button';
import { ListsSection, type SettingsList } from './lists-section';
import { MutedMerchantsSection, MutedMerchantsTitle, type MutedMerchant } from './muted-merchants';
import { PeopleSection, PeopleTitle } from './people-section';
import { ReturnPoliciesSection } from './return-policies-section';
import { TagsSection, type SettingsTag } from './tags-section';

/** Stripe Payment Link — customers choose what to pay. Override via env if needed. */
const DONATE_URL =
  process.env.NEXT_PUBLIC_DONATE_URL ??
  'https://buy.stripe.com/28E14nbwB7fX3Ys4Nrbo400';

/**
 * Shopping settings, drawn from what the page read (page.tsx), so the gallery
 * can draw it from fixtures (plan #1604).
 */
export function ShoppingSettingsView({
  email,
  settings,
  people,
  accounts,
  bannerCode,
  latestJobs,
  mutedMerchants,
  deletedOrders,
  categories,
  itemTags,
  lists,
  returnPolicies,
}: {
  email: string | undefined;
  settings: { displayName: string | null; timezone: string; displayCurrency: string };
  people: Person[];
  accounts: ComponentProps<typeof InboxSection>['accounts'];
  bannerCode: string | undefined;
  latestJobs: Record<string, InboxSyncProgress | null>;
  mutedMerchants: MutedMerchant[];
  deletedOrders: DeletedOrderRow[];
  categories: SettingsCategory[];
  itemTags: SettingsTag[];
  lists: SettingsList[];
  returnPolicies: MerchantPolicyRow[];
}) {
  return (
    <div className="mx-auto max-w-3xl [&_a]:press-area max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11">
      <PageHeader title="Settings" />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="size-4 text-ink-muted" strokeWidth={1.75} />
              Support the project
            </CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-body text-ink-muted">
              Shopping Manager is free. If it helps you spend less or lose less stuff, a tip
              keeps the lights on.
            </p>
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              <Heart className="size-3.5" strokeWidth={1.75} />
              Donate
            </a>
          </CardBody>
        </Card>

        {/* Name, timezone and display currency moved to /account: they hold
            across every workspace, and having a copy of the timezone here was
            how the shopping side ended up silently on UTC while the job side
            was not. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="size-4 text-ink-muted" strokeWidth={1.75} />
              Account
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-body text-ink-muted">
            <p>{settings.displayName ?? '—'}</p>
            <p>{email}</p>
            <p>
              {settings.timezone} · {settings.displayCurrency}
            </p>
            <p className="pt-1">
              <Link
                href="/account"
                className="text-ui font-medium text-accent underline underline-offset-2"
              >
                Change these under Account
              </Link>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <PeopleTitle />
            </CardTitle>
          </CardHeader>
          <CardBody>
            <PeopleSection people={people} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4 text-ink-muted" strokeWidth={1.75} />
              Connected inboxes
            </CardTitle>
          </CardHeader>
          <CardBody>
            <InboxSection
              accounts={accounts}
              bannerCode={bannerCode}
              latestJobs={latestJobs}
              people={people}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <MutedMerchantsTitle />
            </CardTitle>
          </CardHeader>
          <CardBody>
            <MutedMerchantsSection exclusions={mutedMerchants} />
          </CardBody>
        </Card>

        <Card id="deleted-orders">
          <CardHeader>
            <CardTitle>
              <DeletedOrdersTitle />
            </CardTitle>
          </CardHeader>
          <CardBody>
            <DeletedOrdersSection
              orders={deletedOrders}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="size-4 text-ink-muted" strokeWidth={1.75} />
              Categories
            </CardTitle>
          </CardHeader>
          <CardBody>
            <CategoriesSection categories={categories} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="size-4 text-ink-muted" strokeWidth={1.75} />
              Tags
            </CardTitle>
          </CardHeader>
          <CardBody>
            <TagsSection tags={itemTags} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-ink-muted" strokeWidth={1.75} />
              Lists
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ListsSection lists={lists} />
          </CardBody>
        </Card>

        <Card id="return-policies">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="size-4 text-ink-muted" strokeWidth={1.75} />
              Return policies
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ReturnPoliciesSection policies={returnPolicies} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-ink-muted" strokeWidth={1.75} />
              Your data
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-body text-ink-muted">
              We never store the contents of your email. Deleting your account revokes our
              access to your inbox and removes every row we hold. Arrives with build step 15.
            </p>
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
