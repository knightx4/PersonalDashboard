import { describe, expect, it } from 'vitest';
import { quoteFragment, renderedText } from './fragment';

describe('renderedText', () => {
  it('drops the markup rendering removes', () => {
    expect(renderedText('- **Cities** are for _people_, not `cars`.')).toBe(
      'Cities are for people, not cars.',
    );
    expect(renderedText('## A heading')).toBe('A heading');
    expect(renderedText('> quoted [[Urbanism/Parking|parking]] and [[Urbanism/Streets#Width]]')).toBe(
      'quoted parking and Streets',
    );
    expect(renderedText('see [the paper](https://example.com)')).toBe('see the paper');
    expect(renderedText('- [x] done it')).toBe('done it');
  });

  it('keeps an underscore inside a word', () => {
    expect(renderedText('snake_case stays')).toBe('snake_case stays');
  });
});

describe('quoteFragment', () => {
  it('uses a short line whole', () => {
    expect(quoteFragment('Parking is a subsidy.')).toBe('#:~:text=Parking%20is%20a%20subsidy.');
  });

  it('uses a start and an end for a long line', () => {
    expect(
      quoteFragment('one two three four five six seven eight nine ten'),
    ).toBe('#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten');
  });

  it('escapes the directive syntax', () => {
    expect(quoteFragment('cost-benefit, & more')).toBe('#:~:text=cost%2Dbenefit%2C%20%26%20more');
  });

  it('reads the first line with text in it', () => {
    expect(quoteFragment('\n## Why\nbecause')).toBe('#:~:text=Why');
    expect(quoteFragment('  \n ')).toBe('');
  });
});
