import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Public homepage. Google requires a working homepage on a verified domain
 * before a restricted-scope app can be brand-verified, and a human reviewer
 * reads this page, so it has to describe what the app actually does.
 */
export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <span
            className="size-6 rounded-md"
            style={{
              backgroundImage:
                'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent-pink) 100%)',
            }}
            aria-hidden
          />
          <span className="font-display text-[15px] font-semibold tracking-tight">
            Shopping Manager
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

      <main className="mx-auto max-w-[1100px] px-6">
        <section className="py-20 sm:py-28">
          <h1 className="font-display max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            You already own two of these.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted">
            Shopping Manager reads your order confirmations and turns them into a picture of
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

        <section className="grid gap-4 pb-24 sm:grid-cols-3">
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
            <div key={feature.title} className="rounded-card border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-ink">{feature.title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{feature.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-2 px-6 py-6 text-[13px] text-ink-muted">
          <span>Shopping Manager</span>
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
