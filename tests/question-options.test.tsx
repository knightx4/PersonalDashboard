/**
 * The options of a question, rendered: the recommended letter is the one
 * drawn with the green ring (note 3a57b12f), and no other is.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TheOptions } from '@/components/dev/question';

describe('TheOptions with pictures', () => {
  const detail = 'A. Keep it.\nB. Drop it.\nRecommend B: it is cheaper.';
  const pic = (letter: string | null, width: 390 | 1280) => ({
    letter,
    width,
    url: `https://files.example/${letter ?? 'q'}-${width}.png`,
    link: 'https://claude.ai/artifact/x',
  });

  it('shows no picture control for a question without any', () => {
    const html = renderToStaticMarkup(<TheOptions detail={detail} mockups={[]} />);
    expect(html).not.toContain('Enlarge the mockup');
  });

  it('puts each option picture under its own option', () => {
    const html = renderToStaticMarkup(
      <TheOptions detail={detail} mockups={[pic('A', 390), pic('A', 1280), pic('B', 390)]} />,
    );
    expect(html.match(/Enlarge the mockup for Option A/g)).toHaveLength(1);
    expect(html.match(/Enlarge the mockup for Option B/g)).toHaveLength(1);
    expect(html).toContain('A-390.png');
  });

  it('puts a whole-question picture above the options when no option has one', () => {
    const html = renderToStaticMarkup(<TheOptions detail={detail} mockups={[pic(null, 390)]} />);
    expect(html.match(/Enlarge the mockup for The mockup/g)).toHaveLength(1);
    expect(html.indexOf('Enlarge the mockup')).toBeLessThan(html.indexOf('Keep it'));
  });

  it('keeps the whole-question picture off when an option has its own', () => {
    const html = renderToStaticMarkup(
      <TheOptions detail={detail} mockups={[pic(null, 390), pic('A', 390)]} />,
    );
    expect(html).not.toContain('Enlarge the mockup for The mockup');
  });
});

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
