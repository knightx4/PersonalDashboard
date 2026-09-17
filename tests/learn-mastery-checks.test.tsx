/**
 * The checks under a claim, marked at each rung of the ladder.
 *
 * Rendered rather than asserted about, because what matters is what the page
 * says out loud: a check got right out of four options and never applied has
 * to read as two different things, or the gap the applied rung exists to show
 * is invisible on the one page that is about a single idea.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import type { AskedRung } from '@/lib/learn/graph/probe-payload';

const picked = (check: string, right: boolean): AskedRung => ({
  rung: 'recognise',
  masteryCheck: check,
  chosenIndex: 0,
  correctIndex: right ? 0 : 1,
  responseCorrect: null,
});

const written = (check: string, right: boolean): AskedRung => ({
  rung: 'apply',
  masteryCheck: check,
  chosenIndex: null,
  correctIndex: null,
  responseCorrect: right,
});

describe('the checks list on a concept page', () => {
  it('marks a check at both rungs that can be asked', () => {
    const html = renderToStaticMarkup(
      <MasteryChecks
        checks={['can spot it in a new case']}
        answers={[picked('can spot it in a new case', true)]}
      />,
    );

    expect(html).toContain('Multiple choice');
    expect(html).toContain('Applied case');
    expect(html).toContain('Got it right');
    expect(html).toContain('Not asked about yet');
  });

  it('keeps the two rungs apart when one went badly', () => {
    const check = 'can say why it fails';
    const html = renderToStaticMarkup(
      <MasteryChecks checks={[check]} answers={[picked(check, true), written(check, false)]} />,
    );

    expect(html).toContain('Got it right');
    expect(html).toContain('Missed it');
    expect(html).not.toContain('Not asked about yet');
  });

  it('says nothing about the defence rung until something is asked there', () => {
    const check = 'can hold it against the obvious objection';
    const plain = renderToStaticMarkup(
      <MasteryChecks checks={[check]} answers={[picked(check, true)]} />,
    );
    expect(plain).not.toContain('Defence');

    const defended = renderToStaticMarkup(
      <MasteryChecks
        checks={[check]}
        answers={[picked(check, true), { ...written(check, true), rung: 'defend' }]}
      />,
    );
    expect(defended).toContain('Defence');
  });

  it('draws the plain list where nothing has been asked yet', () => {
    const html = renderToStaticMarkup(<MasteryChecks checks={['can do the thing']} />);

    expect(html).toContain('can do the thing');
    expect(html).not.toContain('Multiple choice');
    expect(html).not.toContain('Not asked about yet');
  });
});
