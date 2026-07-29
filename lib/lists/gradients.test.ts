import { describe, expect, it } from 'vitest';
import {
  LIST_GRADIENTS,
  isListGradient,
  listSwatchStyle,
  pickListGradient,
} from './gradients';

describe('pickListGradient', () => {
  it('returns a known gradient', () => {
    const picked = pickListGradient([]);
    expect(isListGradient(picked)).toBe(true);
  });

  it('avoids gradients already in use when possible', () => {
    const used = LIST_GRADIENTS.slice(0, LIST_GRADIENTS.length - 1);
    const leftover = LIST_GRADIENTS[LIST_GRADIENTS.length - 1]!;
    expect(pickListGradient(used)).toBe(leftover);
  });

  it('still returns a gradient when every option is taken', () => {
    expect(isListGradient(pickListGradient([...LIST_GRADIENTS]))).toBe(true);
  });
});

describe('listSwatchStyle', () => {
  it('uses backgroundImage for gradients', () => {
    const gradient = LIST_GRADIENTS[0]!;
    expect(listSwatchStyle(gradient)).toEqual({ backgroundImage: gradient });
  });

  it('uses backgroundColor for legacy hex', () => {
    expect(listSwatchStyle('#6A82FB')).toEqual({ backgroundColor: '#6A82FB' });
  });

  it('falls back when color is missing', () => {
    expect(listSwatchStyle(null)).toEqual({ backgroundColor: '#cfcfc8' });
  });
});
