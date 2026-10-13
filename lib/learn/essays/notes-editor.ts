import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter } from '@codemirror/view';

/**
 * Margin notes inside the essay editor (plan #1869; docs/LEARN-ESSAYS-SPEC.md,
 * "Margin notes and checks").
 *
 * A StateField holds the range of text each note is about and maps it
 * through every edit, so a note stays on its sentence while the person
 * writes above it or inside it. Each open note puts a small marker in a
 * gutter on the right of the text, on the line its range starts; pressing
 * it opens the note in the rail. The note open or hovered in the rail has
 * its text highlighted. A range whose text is all deleted closes up to
 * nothing and loses its marker; the next load marks the note detached.
 */

/** One note's place in the text. Only an open note shows a marker. */
export type NoteRange = { id: string; from: number; to: number; open: boolean };

type NotesState = { ranges: NoteRange[]; active: string | null };

/** Replace the ranges outright: the notes after a check, a Help, a Done. */
export const setNoteRanges = StateEffect.define<NoteRange[]>();

/** The note whose text is highlighted, or null for none. */
export const setActiveNote = StateEffect.define<string | null>();

export const noteRanges = StateField.define<NotesState>({
  create: () => ({ ranges: [], active: null }),
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      next = {
        ...next,
        ranges: next.ranges.map((range) => {
          const from = tr.changes.mapPos(range.from, 1);
          const to = Math.max(from, tr.changes.mapPos(range.to, -1));
          return { ...range, from, to };
        }),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(setNoteRanges)) next = { ...next, ranges: effect.value };
      else if (effect.is(setActiveNote)) next = { ...next, active: effect.value };
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, ({ ranges, active }) => {
      const range = ranges.find((r) => r.id === active && r.to > r.from);
      return range ? Decoration.set([Decoration.mark({ class: 'cm-essay-note-active' }).range(range.from, range.to)]) : Decoration.none;
    }),
});

/** One marker per paragraph: a dot, or the count when it holds more than one open note. */
class NoteMarker extends GutterMarker {
  constructor(readonly id: string, readonly count: number, readonly active: boolean) {
    super();
  }
  eq(other: NoteMarker) {
    return other.id === this.id && other.count === this.count && other.active === this.active;
  }
  toDOM() {
    const dot = document.createElement('span');
    dot.className = this.active ? 'cm-essay-note-dot cm-essay-note-dot-active' : 'cm-essay-note-dot';
    dot.dataset.note = this.id;
    dot.title = this.count > 1 ? `${this.count} notes on this paragraph` : 'Open this note';
    dot.textContent = this.count > 1 ? String(this.count) : '';
    return dot;
  }
}

/**
 * The notes field, the right-hand gutter of markers and their look.
 * `onOpen` is called with a note's id when its marker is pressed.
 */
export function essayNotes(initial: NoteRange[], onOpen: (id: string) => void): Extension {
  return [
    noteRanges.init(() => ({ ranges: initial, active: null })),
    gutter({
      class: 'cm-essay-margin',
      side: 'after',
      markers(view) {
        const { ranges, active } = view.state.field(noteRanges);
        // A line here is a paragraph, since the editor wraps; its marker
        // opens the active note when that is on it, or else the first.
        const lines = new Map<number, { id: string; count: number; active: boolean }>();
        for (const range of ranges) {
          if (!range.open || range.to <= range.from) continue;
          const line = view.state.doc.lineAt(range.from).from;
          const now = lines.get(line);
          const isActive = range.id === active;
          lines.set(line, {
            id: !now || isActive ? range.id : now.id,
            count: (now?.count ?? 0) + 1,
            active: (now?.active ?? false) || isActive,
          });
        }
        return RangeSet.of(
          [...lines]
            .sort(([a], [b]) => a - b)
            .map(([at, m]) => new NoteMarker(m.id, m.count, m.active).range(at)),
        );
      },
      lineMarkerChange: (update) =>
        update.startState.field(noteRanges) !== update.state.field(noteRanges),
      domEventHandlers: {
        mousedown(view, line, event) {
          const target = event.target as HTMLElement | null;
          const id = target?.closest<HTMLElement>('[data-note]')?.dataset.note;
          if (!id) return false;
          event.preventDefault();
          onOpen(id);
          return true;
        },
      },
    }),
    EditorView.theme({
      '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
      '.cm-essay-margin': { width: '1.75rem', paddingLeft: '0.5rem' },
      // The marker sits level with the paragraph's first line.
      '.cm-essay-margin .cm-gutterElement': { display: 'flex', justifyContent: 'center', paddingTop: '0.5em' },
      '.cm-essay-note-dot': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '0.75rem',
        height: '0.75rem',
        padding: '0 0.25rem',
        borderRadius: '9999px',
        backgroundColor: 'var(--c-accent)',
        color: 'var(--c-fill-ink)',
        fontSize: '11px',
        fontWeight: '600',
        lineHeight: '1',
        cursor: 'pointer',
      },
      '.cm-essay-note-dot:empty': { padding: '0', width: '0.75rem' },
      '.cm-essay-note-dot:not(:empty)': { height: '1.125rem', minWidth: '1.125rem' },
      '.cm-essay-note-dot-active': { outline: '2px solid var(--c-accent)', outlineOffset: '2px' },
      '.cm-essay-note-active': {
        backgroundColor: 'var(--c-accent-tint)',
        borderRadius: '2px',
      },
    }),
  ];
}
