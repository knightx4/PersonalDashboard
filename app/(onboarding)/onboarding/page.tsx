import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { markOnboardingComplete, onboardingNeeded } from '@/lib/onboarding';
import { OnboardingSteps, parseStep } from './onboarding-steps';

export const metadata = { title: 'Welcome' };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; inbox?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;
  const step = parseStep(params.step);
  const configured = isGmailOAuthConfigured();

  // Returning from a successful Gmail connect finishes onboarding.
  if (params.inbox === 'connected') {
    await markOnboardingComplete(supabase, user.id);
  } else if (step === 'done' && params.inbox && params.inbox !== 'connected') {
    // Failed connect while aiming for "done" — send them back to the consent step.
    redirect(`/onboarding?step=gmail&inbox=${encodeURIComponent(params.inbox)}`);
  } else if (!(await onboardingNeeded(supabase, core, user)) && step !== 'done' && !params.inbox) {
    redirect('/home');
  }

  return <OnboardingSteps step={step} inbox={params.inbox} configured={configured} />;
}
