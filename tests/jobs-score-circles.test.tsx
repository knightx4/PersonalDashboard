import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreCircles } from '@/components/jobs/ui/score-figures';

describe('ScoreCircles', () => {
  it('draws fit and chance as numbers, tinted by how good each is', () => {
    const html = renderToStaticMarkup(
      <ScoreCircles
        note={{
          fit: { value: 82, unsure: false, reason: 'Strong evidence' },
          chance: { value: 12, unsure: true, reason: null, band: 'low' },
        }}
      />,
    );
    expect(html).toMatch(/aria-label="Fit 82"[^>]*bg-positive-tint text-positive[^>]*>82</);
    expect(html).toMatch(
      /aria-label="Chance of an interview 12, and Dash is not sure of it"[^>]*bg-danger-tint text-danger[^>]*>12</,
    );
  });

  it('draws a middling fit in caution and nothing for an unscored row', () => {
    expect(
      renderToStaticMarkup(<ScoreCircles note={{ fit: { value: 55, unsure: false, reason: null }, chance: null }} />),
    ).toContain('bg-caution-tint text-caution');
    expect(renderToStaticMarkup(<ScoreCircles note={null} />)).toBe('');
  });
});
