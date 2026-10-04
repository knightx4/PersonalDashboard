import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { OnboardingFrame } from './frame';

/** First-run onboarding, behind sign-in, in its own minimal chrome. */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect('/login?next=/onboarding');

  return <OnboardingFrame>{children}</OnboardingFrame>;
}
