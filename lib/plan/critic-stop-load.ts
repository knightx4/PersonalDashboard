import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UI_SHOTS_BUCKET } from '@/lib/preview/ui-checks';
import {
  isCriticStopAsk,
  readStopFixes,
  shotName,
  stopBranch,
  stoppedSurfaces,
  type CriticStopView,
} from './ui-check-stop';

/** How long a shot's link stays good: long enough to read the page. */
const SHOT_LINK_SECONDS = 60 * 60;

type Row = {
  step: number;
  surface: string;
  round: number;
  verdict: string;
  fixes: unknown;
  shots: string[] | null;
};

/**
 * The last round of each surface the critic stopped on, for every blocked
 * step whose ask says the critic stopped it (plan #1610), by step id.
 *
 * The shots are read from the private `ui-shots` bucket as signed links; a
 * round recorded where they could not be uploaded has none, and the page says
 * so. Nothing is read when no step is stopped, which is nearly every load.
 */
export async function loadCriticStops(
  supabase: SupabaseClient,
  userId: string,
  nodes: readonly { id: string; number: number; status: string; blockAsk: string | null }[],
): Promise<Record<string, CriticStopView>> {
  const stopped = nodes.filter((n) => n.status === 'blocked' && isCriticStopAsk(n.blockAsk));
  if (stopped.length === 0) return {};

  const { data, error } = await supabase
    .from('ui_checks')
    .select('step, surface, round, verdict, fixes, shots')
    .eq('user_id', userId)
    .in(
      'step',
      stopped.map((n) => n.number),
    );
  if (error) {
    console.error(`Could not read the design checks: ${error.message}`);
    return {};
  }
  const rows = (data ?? []) as Row[];

  const paths = rows.flatMap((r) => r.shots ?? []);
  const links = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(UI_SHOTS_BUCKET)
      .createSignedUrls(paths, SHOT_LINK_SECONDS);
    if (signError) console.error(`Could not open the design shots: ${signError.message}`);
    for (const s of signed ?? []) if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
  }

  const out: Record<string, CriticStopView> = {};
  for (const node of stopped) {
    const own = rows.filter((r) => r.step === node.number);
    const surfaces = stoppedSurfaces(
      own.map((r) => ({ ...r, fixes: readStopFixes(r.fixes), shots: r.shots ?? [] })),
    ).map((s) => {
      const last = own.find((r) => r.surface === s.surface && r.round === s.round);
      return {
        surface: s.surface,
        round: s.round,
        fixes: readStopFixes(last?.fixes),
        shots: (last?.shots ?? []).map((path) => ({
          name: shotName(path),
          url: links.get(path) ?? null,
        })),
      };
    });
    out[node.id] = { surfaces, branch: stopBranch(node.blockAsk) };
  }
  return out;
}
