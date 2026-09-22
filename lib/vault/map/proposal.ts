import { z } from 'zod';
import type { NoteChunk, NoteSkip } from '@/lib/learn/graph/note-chunks';
import {
  MAP_EDGE_TYPES,
  POSITION_KINDS,
  type MapEdgeType,
  type PositionKind,
} from '@/lib/learn/graph/position-prompt';
import { quoteInNote, type MapVerdict } from '@/lib/vault/map/rules';

/**
 * What one note's reading proposes for the map, before anybody accepts it.
 *
 * Built from one report per chunk. Every position's quote is checked against
 * the whole note body here, and a position whose quote is not there is moved
 * to `dropped` with the reason, so the screen can say how many went. Nothing
 * in this file writes anything: a proposal is a value, and it reaches the map
 * only through `acceptNoteMap`.
 *
 * Themes, positions and edges refer to each other by `key` ("t0", "p3"),
 * never by name, so unticking one on a screen cannot leave an edge pointing
 * at a different position that happens to share its name.
 */

// ------------------------------------------------------------ one chunk's report

/** Stance as a reader can judge it. `generated` comes from the note's callout. */
export const READ_STANCES = ['held', 'encountered'] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

const reportedTheme = z.object({ name: text(120), about: text(400) });

const reportedPosition = z.object({
  name: text(200),
  statement: text(1200),
  kind: z.enum(POSITION_KINDS),
  stance: z.enum(READ_STANCES),
  quote: z.string().max(4000),
  basis: text(400),
  themes: z.array(z.string()).default([]),
});

const reportedEdge = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(MAP_EDGE_TYPES),
  description: z.string().trim().max(400).optional(),
});

/**
 * A chunk's report, read item by item. One malformed position loses that
 * position, not the chunk.
 */
export type ChunkReport = {
  themes: z.infer<typeof reportedTheme>[];
  positions: z.infer<typeof reportedPosition>[];
  edges: z.infer<typeof reportedEdge>[];
};

export function readChunkReport(input: unknown): ChunkReport {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const each = <T>(value: unknown, schema: z.ZodType<T>): T[] =>
    (Array.isArray(value) ? value : []).flatMap((item) => {
      const parsed = schema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  return {
    themes: each(raw.themes, reportedTheme),
    positions: each(raw.positions, reportedPosition),
    edges: each(raw.edges, reportedEdge),
  };
}

// ------------------------------------------------------------------ the proposal

export type ProposedTheme = { key: string; name: string; about: string; basis: string };

export type ProposedStance = 'held' | 'encountered' | 'generated';

export type ProposedPosition = {
  key: string;
  name: string;
  statement: string;
  kind: PositionKind;
  stance: ProposedStance;
  basis: string;
  /** Verified present in the note body. */
  quote: string;
  /** Keys of the themes it sits under. Never empty. */
  themes: string[];
};

export type ProposedEdge = {
  from: string;
  to: string;
  type: MapEdgeType;
  description: string | null;
};

export type DroppedCandidate = {
  name: string;
  why: 'quote-missing' | 'no-theme' | 'repeated';
};

/** What is written when a proposal is accepted. */
export type NoteMap = {
  themes: ProposedTheme[];
  positions: ProposedPosition[];
  edges: ProposedEdge[];
};

export type NoteMapProposal = NoteMap & {
  noteId: string;
  /** The version of the note that was read. Accepting against another refuses. */
  blobSha: string;
  verdict: MapVerdict;
  dropped: DroppedCandidate[];
  chunks: { read: number; failed: { title: string; detail: string }[] };
  /** What the chunker did not read. Empty for every note in the vault today. */
  skipped: NoteSkip[];
};

const norm = (value: string) => value.trim().toLowerCase();

/**
 * Put the chunks' reports together into one note's map.
 *
 * Themes are merged across chunks by name, ignoring case. A position is kept
 * only if its quote is in `body`, it has a theme to sit under, and no earlier
 * chunk proposed the same statement. A position naming no theme its chunk
 * reported goes under that chunk's first theme. Edges are resolved inside
 * their own chunk, and an edge whose end was dropped goes with it.
 */
export function mergeChunkReports(input: {
  body: string;
  generated: boolean;
  reports: { chunk: Pick<NoteChunk, 'title'>; report: ChunkReport }[];
}): Pick<NoteMapProposal, 'themes' | 'positions' | 'edges' | 'dropped'> {
  const themes: ProposedTheme[] = [];
  const themeByName = new Map<string, string>();
  const positions: ProposedPosition[] = [];
  const statements = new Set<string>();
  const edges: ProposedEdge[] = [];
  const edgeKeys = new Set<string>();
  const dropped: DroppedCandidate[] = [];

  for (const { chunk, report } of input.reports) {
    const chunkThemes: string[] = [];
    for (const theme of report.themes) {
      let key = themeByName.get(norm(theme.name));
      if (!key) {
        key = `t${themes.length}`;
        themes.push({
          key,
          name: theme.name,
          about: theme.about,
          basis: `Read in the section "${chunk.title}".`,
        });
        themeByName.set(norm(theme.name), key);
      }
      if (!chunkThemes.includes(key)) chunkThemes.push(key);
    }

    const positionByName = new Map<string, string>();
    for (const position of report.positions) {
      const quote = quoteInNote(position.quote, input.body);
      if (!quote) {
        dropped.push({ name: position.name, why: 'quote-missing' });
        continue;
      }
      if (statements.has(norm(position.statement))) {
        dropped.push({ name: position.name, why: 'repeated' });
        continue;
      }

      const named = position.themes
        .map((name) => themeByName.get(norm(name)))
        .filter((key): key is string => key !== undefined);
      const under = [...new Set(named.length > 0 ? named : chunkThemes.slice(0, 1))];
      if (under.length === 0) {
        dropped.push({ name: position.name, why: 'no-theme' });
        continue;
      }

      const key = `p${positions.length}`;
      positions.push({
        key,
        name: position.name,
        statement: position.statement,
        kind: position.kind,
        stance: input.generated ? 'generated' : position.stance,
        basis: position.basis,
        quote,
        themes: under,
      });
      statements.add(norm(position.statement));
      positionByName.set(norm(position.name), key);
    }

    for (const edge of report.edges) {
      const from = positionByName.get(norm(edge.from));
      const to = positionByName.get(norm(edge.to));
      if (!from || !to || from === to) continue;
      const id = `${from}>${to}:${edge.type}`;
      if (edgeKeys.has(id)) continue;
      edgeKeys.add(id);
      edges.push({ from, to, type: edge.type, description: edge.description || null });
    }
  }

  return { themes, positions, edges, dropped };
}

// -------------------------------------------------------------------- accepting

/**
 * An accepted map as it arrives back from a screen, checked again: every
 * position sits under a theme in the map, and every edge joins two positions
 * in it. The quotes are checked by the database, against the note as it is.
 */
export const noteMapSchema = z
  .object({
    themes: z.array(
      z.object({ key: z.string().min(1), name: text(120), about: text(400), basis: text(400) }),
    ),
    positions: z.array(
      z.object({
        key: z.string().min(1),
        name: text(200),
        statement: text(1200),
        kind: z.enum(POSITION_KINDS),
        stance: z.enum(['held', 'encountered', 'generated']),
        basis: text(400),
        quote: z.string().min(1).max(4000),
        themes: z.array(z.string()).min(1),
      }),
    ),
    edges: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        type: z.enum(MAP_EDGE_TYPES),
        description: z.string().trim().max(400).nullable(),
      }),
    ),
  })
  .superRefine((map, ctx) => {
    const themeKeys = new Set(map.themes.map((theme) => theme.key));
    const positionKeys = new Set(map.positions.map((position) => position.key));
    for (const position of map.positions) {
      if (!position.themes.every((key) => themeKeys.has(key))) {
        ctx.addIssue({
          code: 'custom',
          message: `${position.name} sits under a theme not in the map.`,
        });
      }
    }
    for (const edge of map.edges) {
      if (!positionKeys.has(edge.from) || !positionKeys.has(edge.to)) {
        ctx.addIssue({ code: 'custom', message: 'An edge joins a position not in the map.' });
      }
    }
  });
