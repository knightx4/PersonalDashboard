/**
 * The ideas page, rendered: the "Suggested by Dash" fold groups what a session
 * suggested by the workspace it is about, each group folding on its own
 * (note 6158d2c0).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IdeaRow } from '@/lib/ideas/load';

vi.mock('@/app/dev/ideas/actions', () => {
  const noop = async () => ({});
  return {
    addIdea: noop,
    submitIdea: noop,
    updateIdea: noop,
    dismissIdea: noop,
    restoreIdea: noop,
    deleteIdea: noop,
    shapeIdea: noop,
  };
});
vi.mock('@/app/dev/comment-actions', () => {
  const noop = async () => ({});
  return { addComment: noop, deleteComment: noop };
});

const { IdeasView } = await import('@/app/dev/ideas/ideas-view');

function idea(id: string, module: IdeaRow['module'], body: string): IdeaRow {
  return {
    id,
    body,
    module,
    createdAt: '2026-09-30T09:00:00.000Z',
    planItem: null,
    source: 'claude',
    from: null,
    dismissedAt: null,
    thread: [],
  };
}

describe('the ideas page', () => {
  it('groups the suggested ideas by workspace, each group foldable', () => {
    const html = renderToStaticMarkup(
      <IdeasView
        ideas={{
          mine: [],
          suggested: [
            idea('s1', 'vault', 'Vault follow-on'),
            idea('s2', 'todo', 'Todo follow-on'),
            idea('s3', 'vault', 'Another vault follow-on'),
          ],
          shaped: [],
          dismissed: [],
        }}
        grouping="workspace"
        sort="newest"
      />,
    );

    expect(html).toContain('Suggested by Dash');
    const suggested = html.slice(html.indexOf('Suggested by Dash'));
    expect(suggested).toMatch(/Vault\s*<span[^>]*>\(2\)<\/span>/);
    expect(suggested).toMatch(/Todo\s*<span[^>]*>\(1\)<\/span>/);
    // The outer fold and one per workspace.
    expect(suggested.match(/<details/g)?.length).toBe(2);
    expect(html.match(/<details/g)?.length).toBe(3);
  });
});
