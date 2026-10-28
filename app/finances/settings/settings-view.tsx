import { SettingsPage } from '@/components/patterns/settings-page';

/**
 * Finances settings on the settings page pattern (plan #1937.10), drawn
 * from props so the gallery can draw it from fixtures (plan #1603).
 *
 * One section for now: the accounts linked through Plaid, which plan
 * #2593.3 fills. Until it does, the section says what will appear in it.
 */
export function FinancesSettingsView() {
  return (
    <SettingsPage
      title="Finances settings"
      href="/finances/settings"
      sections={[
        {
          id: 'accounts',
          title: 'Linked accounts',
          // Straight on the card, which is already the section's frame.
          content: (
            <div className="space-y-1">
              <p className="text-ui font-medium text-ink">No accounts linked yet</p>
              <p className="text-ui text-ink-muted">
                Bank, card, brokerage and loan accounts you link appear here, each with when its
                balance was last read.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}
