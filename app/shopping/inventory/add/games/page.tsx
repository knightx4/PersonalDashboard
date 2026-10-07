import { requireUser } from '@/lib/auth/server';
import { AddGamesView, type GameMode } from './games-view';

export const metadata = { title: 'Add board games' };

/**
 * Reading forty boxes out of one photo, then looking each one up, runs well
 * past a default serverless limit. Server actions invoked from this page
 * inherit this ceiling.
 */
export const maxDuration = 300;

function parseMode(raw: string | string[] | undefined): GameMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'scan' || value === 'search' || value === 'manual') return value;
  return 'photo';
}

export default async function AddGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireUser();
  return <AddGamesView mode={parseMode((await searchParams).mode)} />;
}
