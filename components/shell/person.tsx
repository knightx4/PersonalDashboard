'use client';

import { createContext, useContext } from 'react';

/**
 * The signed-in person as a row draws them: the name for the tooltip, the
 * photo for the assignee circle, and the initial when there is no photo.
 *
 * Provided by the app shell, which already holds the name, so a step row
 * deep in a client tree can show whose it is without every page handing the
 * photo down. Outside a shell (a test, the gallery) the circle falls back to
 * "You" and an initial.
 */
export type Person = { name: string; avatarUrl: string | null };

const PersonContext = createContext<Person>({ name: 'You', avatarUrl: null });

export function PersonProvider({ person, children }: { person: Person; children: React.ReactNode }) {
  return <PersonContext.Provider value={person}>{children}</PersonContext.Provider>;
}

export function usePerson(): Person {
  return useContext(PersonContext);
}
