import type { ComponentProps } from 'react';
import { Heart } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-heading';
import { SettingsPage } from '@/components/patterns/settings-page';
import { signOut } from '@/app/(auth)/actions';
import type { Person } from '@/lib/people/load';
import type { MerchantPolicyRow } from '@/lib/returns/policies';
import type { TabAddress } from '@/lib/tabs';
import { CategoriesSection, type SettingsCategory } from './categories-section';
import { DeletedOrdersSection, type DeletedOrderRow } from './deleted-orders-section';
import { InboxSection } from './inbox-section';
import type { InboxSyncProgress } from './inbox-sync-button';
import { ListsSection, type SettingsList } from './lists-section';
import { MutedMerchantsSection, type MutedMerchant } from './muted-merchants';
import { PeopleSection } from './people-section';
import { ReturnPoliciesSection } from './return-policies-section';
import { TagsSection, type SettingsTag } from './tags-section';

/** Stripe Payment Link — customers choose what to pay. Override via env if needed. */
const DONATE_URL =
  process.env.NEXT_PUBLIC_DONATE_URL ?? 'https://buy.stripe.com/28E14nbwB7fX3Ys4Nrbo400';

/**
 * Links written before the page had tabs pointed at a card's anchor, such as
 * Returns' `#return-policies`. The strip moves each onto the tab holding it.
 */
const SHOPPING_SETTINGS_ADDRESS = {
  anchors: {
    inboxes: 'inboxes',
    'return-policies': 'return-policies',
    'deleted-orders': 'deleted-orders',
  },
} as const satisfies TabAddress;

/**
 * Shopping settings on the settings page pattern (plan #1937.11), drawn from
 * what the page read (page.tsx), so the gallery can draw it from fixtures
 * (plan #1604). Eleven cards became seven tabs, one open at a time: the
 * inboxes first, since connecting one is what the workspace needs before
 * anything else and where Gmail's sign-in returns (`?inbox=`).
 *
 * The copy of name, timezone and currency that sat here moved to a line
 * pointing at Account, where they are kept for every workspace.
 */
export function ShoppingSettingsView({
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
  tab,
}: {
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
  /** `searchParams.tab`: the open tab. */
  tab?: string | string[];
}) {
  return (
    <SettingsPage
      title="Shopping settings"
      href="/shopping/settings"
      tab={tab}
      address={SHOPPING_SETTINGS_ADDRESS}
      sections={[
        {
          id: 'inboxes',
          title: 'Inboxes',
          content: () => (
            <InboxSection
              accounts={accounts}
              bannerCode={bannerCode}
              latestJobs={latestJobs}
              people={people}
            />
          ),
        },
        {
          id: 'people',
          title: 'People',
          hint: 'Who this account shops for. Each inbox, and the orders from it, belongs to one of them.',
          content: () => <PeopleSection people={people} />,
        },
        {
          id: 'return-policies',
          title: 'Returns',
          hint: 'How many days each shop gives you to send something back, which sets the dates on Returns.',
          content: () => <ReturnPoliciesSection policies={returnPolicies} />,
        },
        {
          id: 'muted',
          title: 'Muted',
          hint: 'Senders skipped when orders are imported.',
          content: () => <MutedMerchantsSection exclusions={mutedMerchants} />,
        },
        {
          id: 'sorting',
          title: 'Sorting',
          content: () => (
            <div className="space-y-6">
              <div>
                <SectionLabel as="h3" className="mb-2">
                  Categories
                </SectionLabel>
                <CategoriesSection categories={categories} />
              </div>
              <div>
                <SectionLabel as="h3" className="mb-2">
                  Tags
                </SectionLabel>
                <TagsSection tags={itemTags} />
              </div>
              <div>
                <SectionLabel as="h3" className="mb-2">
                  Lists
                </SectionLabel>
                <ListsSection lists={lists} />
              </div>
            </div>
          ),
        },
        {
          id: 'deleted-orders',
          title: 'Deleted',
          content: () => <DeletedOrdersSection orders={deletedOrders} />,
        },
        {
          id: 'data',
          title: 'Your data',
          content: () => <DataSection />,
        },
      ]}
    />
  );
}

/** What is kept, signing out, and the tip jar. */
function DataSection() {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="text-body text-ink-muted">
          We never store the contents of your email. Deleting your account revokes our access to
          your inbox and removes every row we hold. Your name, timezone and currency are kept
          under{' '}
          <Link href="/account" className={linkVariants()}>
            Account
          </Link>
          , for every workspace.
        </p>
        <form action={signOut}>
          <Button variant="secondary" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="max-w-md text-body text-ink-muted">
          Shopping Manager is free. If it helps you spend less or lose less stuff, a tip keeps the
          lights on.
        </p>
        <a
          href={DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <Heart className="size-3.5" strokeWidth={1.75} aria-hidden />
          Donate
        </a>
      </div>
    </div>
  );
}
