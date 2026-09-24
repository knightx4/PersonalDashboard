/**
 * The options of a question, rendered: the recommended letter is the one
 * drawn with the green ring (note 3a57b12f), and no other is.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TheOptions } from '@/components/dev/question';

describe('TheOptions', () => {
  it('rings the recommended letter and only that one', () => {
    const html = renderToStaticMarkup(
      <TheOptions detail={'A. Keep it.\nB. Drop it.\nRecommend B: it is cheaper.'} />,
    );
    expect(html.match(/ring-positive/g)).toHaveLength(1);
    expect(html).toMatch(/ring-positive[^>]*>B</);
    expect(html).toContain('(recommended)');
  });

  it('rings nothing when no option is recommended', () => {
    const html = renderToStaticMarkup(<TheOptions detail={'A. Keep it.\nB. Drop it.'} />);
    expect(html).not.toContain('ring-positive');
  });
});
