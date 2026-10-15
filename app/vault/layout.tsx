import { loadVaultBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';

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
    sections: [
      // Now and Inbox first, as in every workspace (plan #1937.6). Now is the
      // notes, where the vault opens.
      { href: '/vault', label: 'Now', icon: 'notes', exact: true, alsoMatches: ['/vault/n/'] },
      { href: '/vault/inbox', label: 'Inbox', icon: 'inbox' },
      // The quick notes waiting in the Inbox folder, on a tab of their own (note
      // aee95195). The Inbox also lists them as one row that opens this page.
      { href: '/vault/triage', label: 'Triage', icon: 'triage' },
      { href: '/vault/map', label: 'Map', icon: 'vaultMap' },
      // Maya's threads on your notes (plan #1286).
      { href: '/vault/maya', label: 'Maya', icon: 'maya' },
    ],
    settingsHref: '/vault/settings',
    settingsLabel: 'Vault settings',
    brief: () => loadVaultBrief(),
    children,
  });
}
