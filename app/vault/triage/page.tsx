import { redirect } from 'next/navigation';

/**
 * Quick note triage moved onto the Vault's Now page (plan #1496.9), where the
 * deck sits under the quick notes row. Old links and bookmarks land there.
 */
export default function QuickNoteTriagePage() {
  redirect('/vault#triage');
}
