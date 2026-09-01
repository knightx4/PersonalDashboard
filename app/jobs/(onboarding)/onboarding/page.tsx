import { redirect } from 'next/navigation';
import { Building2, FileText, Inbox, Lock, Shield } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { markOnboardingComplete, onboardingNeeded } from '@/lib/jobs/onboarding';
import { buttonVariants } from '@/components/ui/button';
import { CompaniesForm, FinishForm, SkipForm, WelcomeForm } from './forms';

export const metadata = { title: 'Welcome' };

const STEPS = ['welcome', 'companies', 'gmail', 'done'] as const;
type Step = (typeof STEPS)[number];

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
    redirect('/jobs/today');
  }

  const index = STEPS.indexOf(step);

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-8 flex items-center gap-2" aria-hidden>
        {STEPS.map((entry, position) => (
          <div
            key={entry}
            className={
              position <= index ? 'h-1 flex-1 rounded-full bg-brand' : 'h-1 flex-1 rounded-full bg-border'
            }
          />
        ))}
      </div>

      {step === 'welcome' && (
        <section className="space-y-6">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-wider text-ink-faint">
              Welcome
            </p>
            <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-ink">
              A pipeline that keeps itself current
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Applying creates the record whether or not you remembered to log it. What that buys
              you is a funnel you can actually trust — which is the only way to see where your
              search is losing, and whether that differs by channel.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-ink">
            <li className="flex gap-3">
              <Inbox className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>Confirmations, rejections, interview invites and recruiter mail, read and filed.</span>
            </li>
            <li className="flex gap-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>Paste a job link and the description, requirements and questions come with it.</span>
            </li>
            <li className="flex gap-3">
              <Shield className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>Email bodies are never stored. Never fills in a form or applies for you.</span>
            </li>
          </ul>

          <WelcomeForm />
        </section>
      )}

      {step === 'companies' && (
        <section className="space-y-6">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-wider text-ink-faint">
              Step 2
            </p>
            <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-ink">
              Who are you going after?
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Three to five is enough. This is not busywork: linking scores inbound mail against
              the companies you track, so the first inbox scan has something to match against
              rather than holding everything for review.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-card border border-border bg-surface p-4">
            <Building2 className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
            <p className="text-[13px] leading-relaxed text-ink-muted">
              You can skip this and add companies as you go — every role you add creates its
              company automatically.
            </p>
          </div>

          <CompaniesForm />
          <a
            href="/jobs/onboarding?step=gmail"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Skip for now
          </a>
        </section>
      )}

      {step === 'gmail' && (
        <section className="space-y-6">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-wider text-ink-faint">
              Step 3
            </p>
            <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-ink">
              Let it read your job-search mail
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              This is a separate permission from signing in, asked for separately, because it is a
              genuinely bigger ask. Here is exactly what it does.
            </p>
          </div>

          {/*
            The pre-consent screen matters more here than in a commerce app: the
            Gmail query is broader and less well-bounded, so the explanation has
            to be specific rather than reassuring.
          */}
          <ul className="space-y-3 rounded-card border border-border bg-surface p-4 text-[13px] text-ink">
            <li className="flex gap-3">
              <Lock className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>
                <strong className="font-medium">Read-only.</strong> It cannot send, delete, or
                change anything in your mailbox.
              </span>
            </li>
            <li className="flex gap-3">
              <Inbox className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>
                <strong className="font-medium">Scoped to a search.</strong> It looks at mail
                matching a recruiting query — applicant tracking systems, application-shaped
                subjects, and the domains of companies you track. Not your whole inbox.
              </span>
            </li>
            <li className="flex gap-3">
              <Shield className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>
                <strong className="font-medium">Bodies are never stored.</strong> A message is
                read, turned into structured facts, and discarded. Subjects and senders are kept
                only for the messages that turn out to be about your search; everything else keeps
                nothing but an id and a date so the next scan can skip it.
              </span>
            </li>
          </ul>

          <p className="text-[13px] leading-relaxed text-ink-muted">
            Google will show an &ldquo;unverified app&rdquo; warning if this deployment has not
            been through their review. That is about the review, not about what the app does. The
            full detail is in the{' '}
            <a href="/privacy" className="text-brand underline underline-offset-2">
              privacy policy
            </a>
            .
          </p>

          <div className="flex flex-wrap gap-2">
            {configured ? (
              <a
                href="/api/auth/gmail/connect?return_to=/jobs/onboarding%3Fstep%3Ddone"
                className={buttonVariants()}
              >
                Connect Gmail
              </a>
            ) : (
              <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] text-ink-muted">
                Gmail is not configured on this deployment. Everything else works.
              </p>
            )}
            <SkipForm />
          </div>
        </section>
      )}

      {step === 'done' && (
        <section className="space-y-6">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              You are set up
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Start the first inbox scan from settings whenever you are ready — it reads the last
              ninety days and can take a few minutes. After that it checks once a day on its own,
              and there is a Check now button for when you are expecting something. Anything it
              cannot match confidently lands in the review queue rather than being guessed at.
            </p>
          </div>
          <FinishForm />
        </section>
      )}
    </div>
  );
}
