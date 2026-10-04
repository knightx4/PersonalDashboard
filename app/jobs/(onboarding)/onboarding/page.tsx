import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { markOnboardingComplete, onboardingNeeded } from '@/lib/jobs/onboarding';
import { JobsOnboardingSteps, STEPS, type Step } from './onboarding-steps';

export const metadata = { title: 'Welcome' };

function parseStep(raw: string | undefined): Step {
  return STEPS.includes(raw as Step) ? (raw as Step) : 'welcome';
}

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

  if (params.inbox === 'connected') {
    await markOnboardingComplete(supabase, user.id);
  } else if (!(await onboardingNeeded(supabase, core, user)) && step !== 'done' && !params.inbox) {
    redirect('/jobs');
  }

  return <JobsOnboardingSteps step={step} configured={configured} />;
}
