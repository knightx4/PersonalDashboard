/**
 * Whether the person has asked for reduced motion, read once at the moment of
 * the call. For the pieces in this folder that animate with the Web Animations
 * API or append elements of their own: the reduced-motion block in
 * app/globals.css cannot reach either, so each checks here first. False
 * outside a browser. A component re-rendering on a change wants
 * useReducedMotion in components/ui/motion.ts instead.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
