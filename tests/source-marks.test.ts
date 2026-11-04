import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CommentBody } from '@/components/dev/comment-body';
import { namedAt, namesFor, sourceMarks, type SourceMark } from '@/components/talk/source-marks';

function draw(body: string, marks: SourceMark[]): string {
  return renderToStaticMarkup(
    createElement(CommentBody, { body, refs: 'outlines', remarkPlugins: [sourceMarks(marks)] }),
  );
}

/** The answer's words with each mark written as [n]. */
function marked(html: string): string {
  return html.replace(/<a[^>]*>(\d+)<\/a>/g, '[$1]').replace(/<[^>]+>/g, '');
}

describe('namesFor and namedAt', () => {
  it('names a row by its title and by the title up to its first comma', () => {
    expect(namesFor('Catan lot,  eBay')).toEqual(['Catan lot, eBay', 'Catan lot']);
    expect(namedAt('the Catan lot ($186)', 'Catan lot, eBay')).toBe('the Catan lot'.length);
    expect(namedAt('nothing here', 'Catan lot, eBay')).toBeNull();
  });
});

describe('sourceMarks', () => {
  it('puts each mark right after the words that name its row', () => {
    const html = draw(
      'You spent $412 on the Catan lot ($186) and the Penguin Classics bundle ($142). Your todo to list the Catan lot is overdue.',
      [
        { n: 1, title: 'Catan lot, eBay', href: '/shopping/orders/o1' },
        { n: 2, title: 'Penguin Classics bundle, eBay', href: '/shopping/orders/o2' },
        { n: 3, title: 'List the Catan lot', href: '/todo/t/t1' },
      ],
    );
    expect(marked(html)).toBe(
      'You spent $412 on the Catan lot[1] ($186) and the Penguin Classics bundle[2] ($142). Your todo to list the Catan lot[3] is overdue.',
    );
    expect(html).toContain('href="/shopping/orders/o1"');
    expect(html).toContain('aria-label="Source 2: Penguin Classics bundle, eBay"');
  });

  it('marks a row the words never name at the end of the last paragraph', () => {
    const html = draw('First.\n\nSecond.', [{ n: 4, title: 'Budget 2026', href: '/vault/n1' }]);
    expect(marked(html)).toBe('First.\nSecond.[4]');
  });

  it('leaves the words inside a link alone', () => {
    const html = draw('See [Budget 2026](/vault/n1).', [{ n: 1, title: 'Budget 2026', href: '/vault/n1' }]);
    expect(marked(html)).toBe('See Budget 2026.[1]');
  });
});
