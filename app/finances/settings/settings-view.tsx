import { SettingsPage } from '@/components/patterns/settings-page';
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
 * One section: the institutions linked through Plaid (plan #2593.3), each
 * with its accounts, with Link account on the section's heading line and how
 * many of the Trial plan's links are used after the rows.
 */
export function FinancesSettingsView({
  links,
  itemsUsed,
  configured,
  initialPhase,
  menuOpen,
  rowMenuOpen,
}: {
  links: LinkedInstitution[];
  itemsUsed: number;
  configured: boolean;
  initialPhase?: LinkPhase;
  /** Gallery only: draw the Link account menu open. */
  menuOpen?: boolean;
  /** Gallery only: draw this link's row menu open. */
  rowMenuOpen?: string;
}) {
  return (
    <LinkingProvider links={links} itemsUsed={itemsUsed} configured={configured} initialPhase={initialPhase}>
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
        ]}
      />
    </LinkingProvider>
  );
}
