/**
 * Scoring research against a gold list (docs/LEARN-ESSAYS-SPEC.md, "Measuring
 * the tool"): the sources a serious essay on a question must engage with,
 * each recognised by its address or title, and the recall and precision of
 * a set of sources against them.
 *
 * The first gold list is for the test essay (applying a SOX/ICFR control
 * mindset to AI in Finance), built on 15 October 2026 from the primary
 * documents themselves; see fixtures/gold-sox-ai.json for each entry's
 * reason. Nothing here touches the network.
 */

export type GoldSource = {
  id: string;
  name: string;
  why: string;
  /** Lower-case fragments; a source matches when its address or title contains every fragment of any one group. */
  match: string[][];
  /** True for a source an expert would expect but not require. */
  optional?: boolean;
  /** Superseded guidance: citing it as current is an error, not a hit. */
  stale?: boolean;
};

export type ScoredSource = { url: string; title: string };

function matches(source: ScoredSource, gold: GoldSource): boolean {
  const hay = `${source.url} ${source.title}`.toLowerCase();
  return gold.match.some((group) => group.every((fragment) => hay.includes(fragment)));
}

export type GoldScore = {
  /** Required gold entries found, by id. */
  hits: string[];
  /** Required gold entries missed, by id. */
  misses: string[];
  recall: number;
  /** Share of the sources that are on the gold list, required or optional. */
  precision: number;
  /** Sources that are superseded guidance. */
  stale: string[];
};

export function scoreAgainstGold(
  sources: readonly ScoredSource[],
  gold: readonly GoldSource[],
): GoldScore {
  const required = gold.filter((g) => !g.optional && !g.stale);
  const hits = required.filter((g) => sources.some((s) => matches(s, g))).map((g) => g.id);
  const live = gold.filter((g) => !g.stale);
  const onList = sources.filter((s) => live.some((g) => matches(s, g))).length;
  const stale = sources.filter((s) => gold.some((g) => g.stale && matches(s, g))).map((s) => s.url);
  return {
    hits,
    misses: required.map((g) => g.id).filter((id) => !hits.includes(id)),
    recall: required.length ? hits.length / required.length : 0,
    precision: sources.length ? onList / sources.length : 0,
    stale,
  };
}
