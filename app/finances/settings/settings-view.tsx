import { SettingsPage } from '@/components/patterns/settings-page';
import type { AccountSummary } from '@/lib/finances/accounts';
import { ImportsProvider, ImportStatementButton, KeptAccounts, type ImportPhase } from './imports';
import {
  LinkAccountMenu,
  LinkedAccountsList,
  LinkingProvider,
  type LinkedInstitution,
  type LinkPhase,
} from './linked-accounts';

/**
 * Finances settings on the settings page pattern (plan #1937.10), drawn
 * from props so the gallery can draw it from fixtures (plan #1603).
 *
 * Two sections. The institutions linked through Plaid (plan #2593.3), each
 * with its accounts, with Link account on the section's heading line and how
 * many of the Trial plan's links are used after the rows. Then the accounts
 * Plaid cannot reach (plan #2593.5), anchored `#imports`: Import statement on
 * the heading line for Apple Card's Wallet export, the imported and manual
 * accounts with their balances' age, and Add an account by hand.
 */
export function FinancesSettingsView({
  links,
  itemsUsed,
  configured,
  initialPhase,
  menuOpen,
  rowMenuOpen,
  kept = [],
  today,
  importPhase,
  addOpen,
}: {
  links: LinkedInstitution[];
  itemsUsed: number;
  configured: boolean;
  initialPhase?: LinkPhase;
  /** Gallery only: draw the Link account menu open. */
  menuOpen?: boolean;
  /** Gallery only: draw this link's row menu open. */
  rowMenuOpen?: string;
  /** Imported and manual accounts, summarised. */
  kept?: readonly AccountSummary[];
  today: string;
  /** Gallery only: an import part way through. */
  importPhase?: ImportPhase;
  /** Gallery only: draw the add-account popover open. */
  addOpen?: boolean;
}) {
  return (
    <LinkingProvider
      links={links}
      itemsUsed={itemsUsed}
      configured={configured}
      initialPhase={initialPhase}
    >
      <ImportsProvider initialPhase={importPhase}>
        <SettingsPage
          title="Finances settings"
          href="/finances/settings"
          sections={[
            {
              id: 'accounts',
              title: 'Linked accounts',
              action: <LinkAccountMenu menuOpen={menuOpen} />,
              content: <LinkedAccountsList rowMenuOpen={rowMenuOpen} />,
            },
            {
              id: 'imports',
              title: 'Other accounts',
              action: <ImportStatementButton />,
              content: <KeptAccounts accounts={kept} today={today} addOpen={addOpen} />,
            },
          ]}
        />
      </ImportsProvider>
    </LinkingProvider>
  );
}
