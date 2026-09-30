import { notFound } from 'next/navigation';
import { parseWeek, weekShortLabel } from '@/lib/week-review/view';
import { WeekPage } from '../week-page';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const parsed = parseWeek(week);
  return { title: parsed ? weekShortLabel(parsed) : 'The week in review' };
}

/** One week's review by the Sunday that starts it, as /home/week/2026-09-20. */
export default async function PastWeekPage({ params }: { params: Promise<{ week: string }> }) {
  const week = parseWeek((await params).week);
  if (!week) notFound();
  return <WeekPage week={week} />;
}
