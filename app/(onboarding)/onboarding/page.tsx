import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Mail, Package, Shield } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { markOnboardingComplete, onboardingNeeded } from '@/lib/onboarding';
import { buttonVariants } from '@/components/ui/button';
import { FinishOnboardingForm, SkipGmailForm, WelcomeForm } from './forms';

export const metadata = { title: 'Welcome' };

const STEPS = ['welcome', 'gmail', 'done'] as const;
type Step = (typeof STEPS)[number];

function parseStep(raw: string | undefined): Step {
  if (raw && STEPS.includes(raw as Step)) return raw as Step;
  return 'welcome';
}

function inboxBanner(code: string | undefined): { tone: 'ok' | 'warn' | 'err'; text: string } | null {
  switch (code) {
    case 'schema':
      return {
        tone: 'err',
        text: 'Google connected, but the inbox could not be saved: the database schema that stores it is not exposed by the API. In Supabase open Settings → API → Exposed schemas and include public, job_search and core.',
      };
    case 'connected':
      return {
        tone: 'ok',
        text: 'Gmail connected. You can import order confirmations from Settings whenever you are ready.',
      };
    case 'denied':
      return { tone: 'warn', text: 'Google access was not granted. You can try again or skip.' };
    case 'scope_denied':
      return {
        tone: 'warn',
        text: 'Gmail read access was not granted. Connect again and leave “See and download your email” checked.',
      };
    case 'unconfigured':
      return {
        tone: 'err',
        text: 'Gmail OAuth is not configured on this deployment yet. You can skip and add orders by hand.',
      };
    case 'state':
    case 'exchange':
    case 'error':
    case 'missing_code':
      return { tone: 'err', text: 'Something went wrong connecting Gmail. Try again or skip for now.' };
    default:
      return null;
  }
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
  const banner = inboxBanner(params.inbox);
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

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((entry, index) => {
          const active = entry === step;
          const done =
            STEPS.indexOf(step) > index || (step === 'done' && entry === 'done');
          return (
            <div key={entry} className="flex flex-1 items-center gap-2">
              <div
                className={
                  active || done
                    ? 'h-1 flex-1 rounded-full bg-brand'
                    : 'h-1 flex-1 rounded-full bg-border'
                }
                aria-hidden
              />
            </div>
          );
        })}
      </div>

      {step === 'welcome' && (
        <section className="space-y-6">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-wider text-ink-faint">
              Welcome
            </p>
            <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-ink">
              Know what you own before you buy it again
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Personal Dashboard turns order confirmations into inventory and a spending picture.
              It is not a delivery tracker and never handles payment.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-ink">
            <li className="flex gap-3">
              <Package className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>Every purchase lands as something you own, searchable later.</span>
            </li>
            <li className="flex gap-3">
              <Mail className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>Optional Gmail import finds confirmations so you do not type them all.</span>
            </li>
            <li className="flex gap-3">
              <Shield className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>Email bodies are never stored — only structured order facts.</span>
            </li>
          </ul>

          <WelcomeForm />
        </section>
      )}

      {step === 'gmail' && (
        <section className="space-y-6">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-wider text-ink-faint">
              Connect inbox
            </p>
            <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-ink">
              Before you grant Gmail access
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Google sign-in and Gmail read access are separate. This step asks only for
              read-only mail access, and only if you want automatic imports.
            </p>
          </div>

          {banner && (
            <p
              className={
                banner.tone === 'ok'
                  ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
                  : banner.tone === 'warn'
                    ? 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950'
                    : 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900'
              }
            >
              {banner.text}
            </p>
          )}

          <div className="space-y-4 rounded-card border border-border bg-surface px-4 py-4 text-sm">
            <div>
              <h2 className="font-medium text-ink">What we read</h2>
              <p className="mt-1 text-ink-muted">
                Purchase-related messages only — order confirmations, shipping and delivery
                notices, cancellations, returns and refunds — inside a time window you choose
                later (180 days by default).
              </p>
            </div>
            <div>
              <h2 className="font-medium text-ink">What we keep</h2>
              <p className="mt-1 text-ink-muted">
                Structured facts: merchant, order number, dates, line items, totals, tracking,
                and refund amounts. Plus the message id, subject, and sender so you can check
                our work.
              </p>
            </div>
            <div>
              <h2 className="font-medium text-ink">What we never keep</h2>
              <p className="mt-1 text-ink-muted">
                The body of any email. Content is held in memory while parsing, then discarded.
                We cannot send, modify, or delete anything in your mailbox.
              </p>
            </div>
            <p className="text-[13px] text-ink-faint">
              Full detail in the{' '}
              <Link href="/privacy" className="text-brand hover:underline">
                privacy policy
              </Link>
              .
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {configured ? (
              <Link
                href="/api/auth/gmail/connect?return_to=%2Fonboarding%3Fstep%3Ddone"
                className={buttonVariants({ size: 'md' })}
              >
                <Mail className="size-4" strokeWidth={1.75} />
                Connect Gmail
              </Link>
            ) : (
              <p className="text-sm text-amber-900">
                Gmail OAuth is not configured on this server yet. Skip and add orders manually.
              </p>
            )}
            <SkipGmailForm />
          </div>
        </section>
      )}

      {step === 'done' && (
        <section className="space-y-6">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-wider text-ink-faint">
              Ready
            </p>
            <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-ink">
              {params.inbox === 'connected' ? 'Inbox connected' : 'You are set'}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              {params.inbox === 'connected'
                ? 'Import order confirmations from Settings when you want to fill inventory. You can also add orders by hand anytime.'
                : 'Add orders by hand, save product URLs to your queue, and connect Gmail later from Settings if you change your mind.'}
            </p>
          </div>

          {banner && params.inbox === 'connected' && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {banner.text}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            {params.inbox === 'connected' ? (
              <>
                <Link href="/shopping/settings#inboxes" className={buttonVariants()}>
                  Import from Settings
                </Link>
                <Link href="/home" className={buttonVariants({ variant: 'secondary' })}>
                  Go to dashboard
                </Link>
              </>
            ) : (
              <FinishOnboardingForm />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
