import { redirect } from 'next/navigation';

/**
 * The Vault's Inbox moved onto its Now page (plan #1496.9): what is on you
 * there sits above the quick notes. Old links and bookmarks land there.
 */
export default function VaultInboxPage() {
  redirect('/vault#inbox');
}
