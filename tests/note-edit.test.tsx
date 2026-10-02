/**
 * Editing a note in place on its page (#1425).
 *
 * The runner has no DOM, so the press itself is not exercised here (it was
 * checked in a browser at phone and laptop width). What is pinned is what each
 * state renders: the note at rest with its Edit button, the editor posting the
 * three fields `saveNoteEdit` reads, and the two refusals that each carry a way
 * forward.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock('@/app/vault/n/[...path]/actions', () => ({ saveNoteEdit: async () => ({}) }));

const { NoteEdit, EditForm, SaveError } = await import('@/app/vault/n/[...path]/note-edit');

const nothing = () => {};

describe('the note at rest', () => {
  const html = renderToStaticMarkup(
    <NoteEdit
      notePath="Work/Close.md"
      body="The close took six hours."
      blobSha="abc"
      heading={<h1>Close</h1>}
      properties={<dl>props</dl>}
    >
      <p>rendered note</p>
    </NoteEdit>,
  );

  it('shows the rendered note, its properties and an Edit button', () => {
    expect(html).toContain('<p>rendered note</p>');
    expect(html).toContain('<dl>props</dl>');
    expect(html).toMatch(/<button[^>]*>.*Edit<\/button>/);
    expect(html).not.toContain('<textarea');
  });
});

describe('the editor', () => {
  const html = renderToStaticMarkup(
    <EditForm
      notePath="Work/Close.md"
      body="The close took six hours."
      blobSha="abc"
      onDone={nothing}
      onReload={nothing}
    />,
  );

  it('holds the note body and posts the fields the save action reads', () => {
    expect(html).toMatch(/<textarea[^>]*name="text"[^>]*>The close took six hours\.<\/textarea>/);
    expect(html).toContain('name="notePath" value="Work/Close.md"');
    expect(html).toContain('name="blobSha" value="abc"');
  });

  it('offers Save and Cancel', () => {
    expect(html).toMatch(/type="submit"[^>]*>Save</);
    expect(html).toContain('Cancel');
  });
});

describe('a refused save', () => {
  it('says a note changed in Obsidian, and offers a reload', () => {
    const html = renderToStaticMarkup(
      <SaveError state={{ reason: 'changed', error: 'x' }} onReload={nothing} />,
    );
    expect(html).toContain('changed in Obsidian since you opened it');
    expect(html).toContain('Reload the note');
  });

  it.each(['read-only', 'reconnect'] as const)('sends a %s token to vault settings', (reason) => {
    const html = renderToStaticMarkup(
      <SaveError state={{ reason, error: 'x' }} onReload={nothing} />,
    );
    expect(html).toContain('href="/vault/settings"');
    expect(html).toContain('your edit was not saved');
  });

  it('shows any other failure as the sentence the action gave', () => {
    const html = renderToStaticMarkup(
      <SaveError
        state={{ reason: 'error', error: 'The note could not be saved. Try again in a moment.' }}
        onReload={nothing}
      />,
    );
    expect(html).toContain('The note could not be saved. Try again in a moment.');
  });

  it('shows nothing once a save has gone through', () => {
    expect(
      renderToStaticMarkup(<SaveError state={{ savedBlobSha: 'def' }} onReload={nothing} />),
    ).toBe('');
  });
});
