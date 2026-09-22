import type { NoteMap, ProposedEdge, ProposedPosition } from '@/lib/vault/map/proposal';

/**
 * What is left of a proposed map once some of it is unticked.
 *
 * The review screen and the accept action both run this, so the counts on
 * the button are the rows that will be written. Every item is ticked by its
 * key: a theme's and a position's `key`, and an edge's `edgeKey`.
 *
 * Unticking a theme takes it off every position under it. A position left
 * under no ticked theme is not written, because obsidian.accept_note_map
 * refuses a position without a theme; it is returned in `unplaced` so the
 * screen can say so before the button is pressed. An edge goes when either
 * end goes.
 */

export function edgeKey(edge: Pick<ProposedEdge, 'from' | 'to' | 'type'>): string {
  return `${edge.from}>${edge.to}:${edge.type}`;
}

/** Every key in the map, for a review that starts with everything ticked. */
export function allKeys(map: NoteMap): string[] {
  return [
    ...map.themes.map((theme) => theme.key),
    ...map.positions.map((position) => position.key),
    ...map.edges.map(edgeKey),
  ];
}

export function keepTickedMap(
  map: NoteMap,
  ticked: ReadonlySet<string>,
): { map: NoteMap; unplaced: ProposedPosition[] } {
  const themes = map.themes.filter((theme) => ticked.has(theme.key));
  const themeKeys = new Set(themes.map((theme) => theme.key));

  const positions: ProposedPosition[] = [];
  const unplaced: ProposedPosition[] = [];
  for (const position of map.positions) {
    if (!ticked.has(position.key)) continue;
    const under = position.themes.filter((key) => themeKeys.has(key));
    if (under.length === 0) unplaced.push(position);
    else positions.push({ ...position, themes: under });
  }

  const positionKeys = new Set(positions.map((position) => position.key));
  const edges = map.edges.filter(
    (edge) =>
      ticked.has(edgeKey(edge)) && positionKeys.has(edge.from) && positionKeys.has(edge.to),
  );

  return { map: { themes, positions, edges }, unplaced };
}
