import { loadVaultBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor } from '@/lib/shell/tabs';

/**
 * Shell for the vault workspace.
 *
 * The proxy already blocks unauthenticated requests; the shell's loader
 * checks again, as a second line rather than the first.
 *
 * Unlike the other two workspaces this one has no onboarding gate. Neither
 * workspace's onboarding says anything about a vault, and bouncing someone to
 * a Gmail consent screen because they wanted to read their own notes would be
 * the wrong app answering the question.
 */
export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'vault',
    /**
     * The notes, the quick notes to triage, the map drawn from them (#758),
     * Maya's threads on them (#1286), and your transcripts (#1308). Settings moved to the
     * gear, where every other workspace keeps it -- it was a nav tab here only
     * because this shell was written on its own.
     */
    sections: ({ owner }) => tabsFor('vault', owner),
    settingsHref: '/vault/settings',
    settingsLabel: 'Vault settings',
    brief: () => loadVaultBrief(),
    children,
  });
}
