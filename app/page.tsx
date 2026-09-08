import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';

/**
 * Public homepage. Google requires a working homepage on a verified domain
 * before a restricted-scope app can be brand-verified, and a human reviewer
 * reads this page, so it has to describe what the app actually does.
 */
export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <ModuleMark module={null} size="md" />
          <span className="text-lead font-semibold tracking-tight">
            Personal Dashboard
          </span>
        </div>
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Sign in
          </Link>
          <Link href="/signup" className={buttonVariants({ size: 'sm' })}>
            Get started
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-20 sm:py-28">
          <h1 className="font-display max-w-2xl text-figure font-semibold tracking-[-0.03em] text-ink sm:text-figure-lg">
            You already own two of these.
          </h1>
          <p className="mt-5 max-w-xl text-lead leading-relaxed text-ink-muted">
            Personal Dashboard reads your order confirmations and turns them into a picture of
            what you own and what you spend. Not a delivery tracker — a way to stop buying the
            same thing twice.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
              Get started
            </Link>
            <Link
              href="/privacy"
              className={buttonVariants({ variant: 'secondary', size: 'lg' })}
            >
              How we handle your email
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-12 sm:grid-cols-3">
          {[
            {
              title: 'Everything you own, in one place',
              body: 'Each item from each order becomes its own entry, so you can search what you have before you buy it again.',
            },
            {
              title: 'What you actually spent',
              body: 'Monthly totals net of refunds, with the gross and refunded amounts shown underneath so the number is auditable.',
            },
            {
              title: 'A queue instead of a cart',
              body: 'Save things you want by pasting a link. If you buy it later, from any store, we notice and tick it off.',
            },
          ].map((feature) => (
            <div key={feature.title} className={cardVariants({ padding: 'standard' })}>
              <h2 className="text-body font-semibold text-ink">{feature.title}</h2>
              <p className="mt-1.5 text-ui leading-relaxed text-ink-muted">{feature.body}</p>
            </div>
          ))}
        </section>

        {/*
          The job search half is stated here on purpose. This page and the
          privacy policy are read together during Google's brand verification,
          and the policy describes storing job descriptions and contact details
          -- which reads as a discrepancy if the homepage only ever mentions
          shopping.
        */}
        <section className="pb-24">
          <div className={cardVariants({ padding: 'standard' })}>
            <h2 className="font-display text-title tracking-tight text-ink">
              The same account also tracks a job search
            </h2>
            <p className="mt-2 max-w-2xl text-ui leading-relaxed text-ink-muted">
              Applications from first lead to offer on one board, with the roles and companies
              behind them, interviews, an answer bank, and the funnel maths over all of it. Job
              postings are kept in full, because they are usually taken down before you need them
              again; contacts hold professional details you enter yourself and nothing more. Both
              are set out in the{' '}
              <Link href="/privacy" className="text-accent hover:underline">
                privacy policy
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-ui text-ink-muted">
          <span>Personal Dashboard</span>
          <nav className="flex gap-4">
            <Link href="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-ink">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
