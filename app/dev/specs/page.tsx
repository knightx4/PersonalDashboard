import { createClient, requireUser } from '@/lib/auth/server';
import { SPECS } from '@/lib/specs/registry';
import { loadOpenSpecChanges } from '@/lib/specs/changes';
import { loadLatestFindings } from '@/lib/specs/findings';
import { MODULE_IDS } from '@/lib/modules';
import { specCommentCounts } from '@/lib/specs/load';
import { loadModuleVisions } from '@/lib/specs/vision';
import { loadPendingVisionEdits } from '@/lib/specs/vision-review';
import { loadSpecInterviews } from '@/lib/specs/interviews';
import { interviewCards } from '@/lib/specs/interview-view';
import { SpecsView } from './specs-view';

export const metadata = { title: 'Specs' };

// An interview's last answer has Dash draft the vision and a spec, one or two
// model calls of up to a minute, inside the answer's server action
// (app/dev/specs/interview-actions.ts). The page's limit is the action's.
export const maxDuration = 300;

/**
 * The documents that argue for what got built, with somewhere to argue back.
 *
 * They already existed in `docs/`, which is the right place for them: a
 * document making the case for a design belongs in the commit that makes the
 * design, reviewed in the same diff. What it could not do there is take a
 * comment. A reply to a paragraph went into a chat window and was gone by the
 * next session, so the reasoning and the objections to it lived in different
 * places and only one of them survived.
 *
 * So the text stays in the repository and is read from it, and only the
 * comments are stored. Nothing here can write a word of a spec, which is what
 * keeps the document and the code honest about each other.
 *
 * The one thing on this page that is written here is the vision at the head of
 * each group: what the workspace, or the app as a whole, is for, above every
 * document under it, and the person's rather than the repository's. That is the layer a session
 * reads first, and it is edited in place because a paragraph that needs a
 * commit to change is one that goes stale.
 */

/**
 * Workspaces the audit files findings under by their own id: those with no
 * spec in the registry. A workspace id that is also a spec's slug ('learn')
 * belongs to that spec's page.
 */
const UNSPECCED = MODULE_IDS.filter(
  (id) => !SPECS.some((spec) => spec.module === id || spec.slug === id),
);

export default async function SpecsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [counts, visions, edits, changes, audit, interviews] = await Promise.all([
    specCommentCounts(supabase, user.id),
    loadModuleVisions(supabase, user.id),
    loadPendingVisionEdits(supabase, user.id),
    loadOpenSpecChanges(supabase, user.id),
    loadLatestFindings(supabase, user.id, UNSPECCED),
    loadSpecInterviews(supabase, user.id).catch((error: unknown) => {
      console.error('The interviews were not read', error);
      return [];
    }),
  ]);
  const cards = interviewCards(interviews, {
    visionEditIds: new Set(Object.values(edits).flatMap((edit) => (edit ? [edit.id] : []))),
    specChangeIds: new Set(changes.map((change) => change.id)),
  });
  return (
    <SpecsView
      counts={counts}
      visions={visions}
      edits={edits}
      changes={changes}
      audit={audit}
      interviews={cards}
    />
  );
}
