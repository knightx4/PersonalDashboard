import { describe, expect, it } from 'vitest';
import { withHeap } from '../scripts/ui-guard-compare';

describe('withHeap', () => {
  it('adds the heap to whatever NODE_OPTIONS holds', () => {
    expect(withHeap(undefined)).toBe('--max-old-space-size=8192');
    expect(withHeap('--use-openssl-ca')).toBe('--use-openssl-ca --max-old-space-size=8192');
  });

  it('leaves a heap that is already named', () => {
    expect(withHeap('--max-old-space-size=4096')).toBe('--max-old-space-size=4096');
  });
});
