'use client';

import type { ReactNode } from 'react';
import { rememberPrediction } from '@/components/learn/lesson-predict';

/**
 * Draws the lessons inside it as already guessed (plan #2522.6), for the
 * gallery's answered state. Set while rendering, before the lessons below
 * read it, on the server and again in the browser.
 */
export function GuessedAlready({ id, guess, children }: { id: string; guess: string | null; children: ReactNode }) {
  rememberPrediction(id, guess);
  return <>{children}</>;
}
