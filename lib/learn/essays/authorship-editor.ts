import { Annotation, StateEffect, StateField, Transaction, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { invertedEffects } from '@codemirror/commands';
import { buttonVariants } from '@/components/ui/button';
import { mapMarks, normaliseMarks, type AuthorMark, type MarkAuthor } from './authorship';

/**
 * Who wrote what, inside the essay editor (plan #1868; docs/LEARN-ESSAYS-SPEC.md,
 * "Who wrote what" and rung 4 of the ladder).
 *
 * A StateField holds the runs that are not the person's and maps them
 * through every change. Text arrives as Dash's only from a transaction that
 * says so with the `insertedBy` annotation, which only accepting a
 * suggestion sends, so nothing is guessed from pastes. Text a change removes
 * is remembered through the history's inverted effects, so undo puts back
 * the author the text had, and redo does the same for Dash's text.
 *
 * The suggestion is a second field: the text you selected struck through,
 * Dash's wording after it, and Accept and Reject under the line. An edit
 * that touches the selected text withdraws it.
 */

/** On a transaction that inserts text which is not the person's. */
export const insertedBy = Annotation.define<{ author: MarkAuthor; name: string }>();

/** Replace the marks outright: a draft opened with its marks, or the marks cleared. */
export const setMarks = StateEffect.define<AuthorMark[]>();

/** Marks put back on undo or redo, in the coordinates of the text after it. */
const restoreMarks = StateEffect.define<AuthorMark[]>({
  map: (marks, change) =>
    marks
      .map((mark) => ({ ...mark, from: change.mapPos(mark.from, 1), to: change.mapPos(mark.to, -1) }))
      .filter((mark) => mark.to > mark.from),
});

export const authorMarks = StateField.define<AuthorMark[]>({
  create: () => [],
  update(marks, tr) {
    let next = tr.docChanged ? mapMarks(marks, tr.changes, tr.annotation(insertedBy) ?? null) : marks;
    for (const effect of tr.effects) {
      if (effect.is(setMarks)) next = normaliseMarks(effect.value, tr.newDoc.length);
      else if (effect.is(restoreMarks)) next = normaliseMarks([...next, ...effect.value], tr.newDoc.length);
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (marks) => {
      const dash = Decoration.mark({ class: 'cm-essay-dash' });
      return Decoration.set(marks.filter((mark) => mark.author === 'dash').map((mark) => dash.range(mark.from, mark.to)));
    }),
});

/**
 * What undoing a change has to put back: the marked text it removed, at
 * the positions it had before the change, which is the text after the undo.
 */
const rememberRemoved = invertedEffects.of((tr) => {
  if (!tr.docChanged) return [];
  const marks = tr.startState.field(authorMarks, false) ?? [];
  if (marks.length === 0) return [];
  const removed: AuthorMark[] = [];
  tr.changes.iterChangedRanges((fromA, toA) => {
    for (const mark of marks) {
      const from = Math.max(mark.from, fromA);
      const to = Math.min(mark.to, toA);
      if (to > from) removed.push({ ...mark, from, to });
    }
  });
  return removed.length > 0 ? [restoreMarks.of(removed)] : [];
});

/** Dash's wording for the selected text, waiting for Accept or Reject. */
export type Suggestion = { from: number; to: number; text: string; name: string };

export const showSuggestion = StateEffect.define<Suggestion | null>();

class SuggestedText extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: SuggestedText) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement('ins');
    span.className = 'cm-essay-suggested';
    span.textContent = this.text;
    return span;
  }
}

class SuggestionBar extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const bar = document.createElement('div');
    bar.className = 'cm-essay-suggestion-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Dash’s suggestion');
    const label = document.createElement('span');
    label.className = 'cm-essay-suggestion-label';
    label.textContent = 'Dash’s suggestion';
    const button = (text: string, primary: boolean, run: (view: EditorView) => boolean) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = text;
      el.className = buttonVariants({ variant: primary ? 'primary' : 'secondary', size: 'sm' });
      // Keep the editor's selection and focus where they are.
      el.addEventListener('mousedown', (event) => event.preventDefault());
      el.addEventListener('click', () => {
        run(view);
        view.focus();
      });
      return el;
    };
    bar.append(label, button('Accept', true, acceptSuggestion), button('Reject', false, rejectSuggestion));
    return bar;
  }
  ignoreEvent() {
    return true;
  }
}

function suggestionDecorations(state: EditorState, suggestion: Suggestion | null): DecorationSet {
  if (!suggestion) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  if (suggestion.to > suggestion.from) {
    ranges.push(Decoration.mark({ class: 'cm-essay-struck', tagName: 'del' }).range(suggestion.from, suggestion.to));
  }
  ranges.push(Decoration.widget({ widget: new SuggestedText(suggestion.text), side: 1 }).range(suggestion.to));
  const lineEnd = state.doc.lineAt(suggestion.to).to;
  ranges.push(Decoration.widget({ widget: new SuggestionBar(), block: true, side: 1 }).range(lineEnd));
  return Decoration.set(ranges, true);
}

export const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(showSuggestion)) return effect.value;
    if (!value || !tr.docChanged) return value;
    let touched = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= value.to && toA >= value.from) touched = true;
    });
    if (touched) return null;
    return { ...value, from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) };
  },
  provide: (field) => EditorView.decorations.compute([field], (state) => suggestionDecorations(state, state.field(field))),
});

/** Put Dash's wording in place of the selected text, marked as Dash's. */
export function acceptSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField, false);
  if (!suggestion) return false;
  view.dispatch({
    changes: { from: suggestion.from, to: suggestion.to, insert: suggestion.text },
    selection: { anchor: suggestion.from + suggestion.text.length },
    effects: showSuggestion.of(null),
    annotations: [insertedBy.of({ author: 'dash', name: suggestion.name }), Transaction.userEvent.of('rephrase')],
  });
  return true;
}

export function rejectSuggestion(view: EditorView): boolean {
  if (!view.state.field(suggestionField, false)) return false;
  view.dispatch({ effects: showSuggestion.of(null) });
  return true;
}

/** The look: Dash's text a shade lighter, the suggestion as a change you can read. */
export const authorshipTheme = EditorView.theme({
  '.cm-essay-dash': { color: 'var(--color-ink-muted)' },
  '.cm-essay-struck': { textDecoration: 'line-through', color: 'var(--color-ink-muted)' },
  '.cm-essay-suggested': {
    textDecoration: 'none',
    backgroundColor: 'var(--color-accent-tint)',
    color: 'var(--color-ink)',
    borderRadius: '2px',
    padding: '0 2px',
  },
  '.cm-essay-suggestion-bar': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    margin: '8px 0 12px',
    fontFamily: 'var(--font-sans)',
    fontSize: '14px',
    lineHeight: '1.4',
  },
  '.cm-essay-suggestion-label': { color: 'var(--color-ink-muted)', marginRight: 'auto' },
});

/** Everything the editor needs for authorship and rung 4; `suggestion` is for the gallery. */
export function authorship(initial: readonly AuthorMark[], suggestion: Suggestion | null = null): Extension {
  return [
    authorMarks.init((state) => normaliseMarks(initial, state.doc.length)),
    rememberRemoved,
    suggestion ? suggestionField.init(() => suggestion) : suggestionField,
    authorshipTheme,
  ];
}
